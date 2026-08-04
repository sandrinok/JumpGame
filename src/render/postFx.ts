import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createAdaptiveResolution, type QualitySettings } from './quality';
import { createGodRays, type GodRays } from './godRays';

/**
 * Bloom runs on the raw linear HDR buffer, before exposure and tone mapping.
 * The sky shader emits radiance well above 1 across its whole surface, so a
 * threshold near 1 makes the entire sky glow and washes out anything in front
 * of it. This has to sit above the sky's general brightness so only the sun
 * and genuine speculars are picked up.
 *
 * The margin above the sky is the whole game, and it used to be far too thin.
 * This was 4.0, which on three 0.169 sat *just* under the sky's radiance — near
 * enough that the three 0.185 upgrade, which nudges the Sky shader's output up
 * slightly, dropped the sky above the line and made every pixel of it a
 * highlight. The symptom was a white band bleeding across the horizon and a
 * washed-out, desaturated frame; the cause was a knife-edge constant, not the
 * effect itself.
 *
 * Bisected against the actual frame after the upgrade: the sky reads clean at a
 * threshold of 6 and blooms wholesale at 4, so its radiance sits between the
 * two. The threshold has to keep real margin over that while staying orders of
 * magnitude below the sun disc, which is what bloom is here to catch. If the
 * sky, exposure or tone mapping is ever retuned — S5 will retune all three —
 * re-bisect this rather than assuming the old number still clears.
 *
 * Strength is set by taste rather than by measurement, and the taste here is
 * restraint: this is a game about reading a surface and judging a jump, so
 * anything that lifts black level or softens an edge costs the player
 * information. Bloom earns its place on the sun and on wet speculars, and
 * nowhere else. Threshold raised further and strength cut hard after the first
 * pass still read as too much in play.
 *
 * Tunable live while the game runs, which is the only sane way to judge it:
 *
 *     __jg.postFx.bloom.strength = 0.05
 *     __jg.postFx.bloom.threshold = 16
 */
const BLOOM_THRESHOLD = 12.0;
const BLOOM_STRENGTH = 0.12;
const BLOOM_RADIUS = 0.4;

/** Colour grading constants; see GRADE_GLSL for what each one does. */
const SATURATION = 1.13;
/**
 * Contrast, applied around a mid-grey pivot in linear space.
 *
 * The grade had saturation and a warm/cool split but nothing that touched
 * contrast, which meant the one control that actually removes a washed-out look
 * did not exist. Saturation cannot fix low contrast — it pushes colours further
 * from grey without moving the values apart, so a milky image just becomes a
 * more colourful milky image.
 *
 * The pivot is 0.18, the usual mid-grey in linear space. Above it highlights
 * open up, below it shadows close down, and the black point finally reaches
 * something near black.
 */
const CONTRAST = 1.16;
const CONTRAST_PIVOT = 0.18;
/** Tint multiplied into highlights; the sun already reads warm. */
const WARMTH = new THREE.Color(1.03, 1.0, 0.96);
/** Tint added to shadows, pushing them towards the sky's blue. */
const COOL_SHADOW = new THREE.Color(0.96, 0.99, 1.06);
const VIGNETTE = 0.22;

/**
 * Chromatic aberration, in the same pass as everything else.
 *
 * A real lens focuses red, green and blue at slightly different distances, so
 * the further a detail is from the optical axis the further apart the three
 * channels land. Reproducing that means three texture reads at three slightly
 * different offsets — which is why it belongs *here*, spliced into the output
 * pass, and not in a pass of its own: as a separate pass it would be a full
 * read and write of the frame for two extra samples.
 *
 * The offset scales with distance from centre squared, because the real effect
 * does: the middle of the frame — where the player and the ledge they are
 * aiming at almost always are — stays exactly sharp, and only the corners
 * fringe. Anything that put dispersion on the centre of the frame would be
 * costing the player information about where an edge is, which is the one thing
 * this game cannot spend.
 *
 * Only compiled in when the tier asks for it, so lower tiers do not pay two
 * texture reads for an amount of zero.
 */
const ABERRATION_GLSL = /* glsl */ `
  uniform float aberration;

  vec3 sampleDispersed( sampler2D tex, vec2 uv ) {
    vec2 d = uv - 0.5;
    // Squared falloff, and scaled by the offset direction rather than a
    // constant, so the fringe runs radially outward the way a lens's does.
    vec2 offset = d * dot( d, d ) * aberration * 4.0;
    return vec3(
      texture2D( tex, uv + offset ).r,
      texture2D( tex, uv ).g,
      texture2D( tex, uv - offset ).b
    );
  }
`;

/**
 * Saturation, a warm/cool split, and a vignette.
 *
 * Injected into the output pass rather than run as a pass of its own. As a
 * separate pass this cost a full-resolution read and write of the HDR buffer
 * for three multiplies — the bandwidth to move the image, not the arithmetic,
 * was the entire expense. Folded in here it is a handful of instructions on
 * pixels the output pass was already touching.
 *
 * It still runs in linear space, before tone mapping, so the grade behaves like
 * a filter on the lens rather than a layer on the finished picture.
 */
const GRADE_GLSL = /* glsl */ `
  uniform float saturation;
  uniform float contrast;
  uniform float contrastPivot;
  uniform vec3 warmth;
  uniform vec3 coolShadow;
  uniform float vignette;

  vec3 applyGrade( vec3 c, vec2 uv ) {

    // Contrast first, before saturation: pushing values apart and then
    // saturating gives a cleaner result than saturating a flat image and
    // trying to rescue it afterwards. Clamped at zero because the pivot
    // subtraction can go negative on near-black pixels, and a negative
    // radiance turns into a NaN the moment anything takes its square root.
    c = max( ( c - contrastPivot ) * contrast + contrastPivot, vec3( 0.0 ) );

    // Rec. 709 luma, so saturation does not shift perceived brightness.
    float luma = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    c = mix( vec3( luma ), c, saturation );

    // Split tone: warm where it is bright, cool where it is dark. This is most
    // of what makes a render read as "graded" rather than raw.
    float t = smoothstep( 0.15, 0.85, luma );
    c *= mix( coolShadow, warmth, t );

    // Distance from centre, corrected so the falloff stays round on a
    // widescreen viewport.
    vec2 d = uv - 0.5;
    float r = length( d * vec2( 1.0, 0.62 ) );
    c *= 1.0 - vignette * smoothstep( 0.25, 0.72, r );

    return c;
  }
`;

/** The line in three's OutputShader the grade is spliced into. */
const OUTPUT_ANCHOR = 'gl_FragColor = texture2D( tDiffuse, vUv );';

/**
 * three's OutputPass — tone mapping and sRGB conversion, with its define
 * juggling left intact — plus our grade, in the same fullscreen pass.
 *
 * Subclassed rather than reimplemented on purpose: the tone mapping curve and
 * the colour space transfer have to match what the renderer would have done
 * exactly, and the surest way to guarantee that is to run three's own code.
 */
class GradedOutputPass extends OutputPass {
  /** @param aberration dispersion at the frame edge, in UV units. 0 omits it. */
  constructor(aberration: number) {
    super();

    const uniforms = this.uniforms as Record<string, THREE.IUniform>;
    uniforms.saturation = { value: SATURATION };
    uniforms.contrast = { value: CONTRAST };
    uniforms.contrastPivot = { value: CONTRAST_PIVOT };
    uniforms.warmth = { value: WARMTH };
    uniforms.coolShadow = { value: COOL_SHADOW };
    uniforms.vignette = { value: VIGNETTE };

    const material = this.material as THREE.ShaderMaterial;
    if (!material.fragmentShader.includes(OUTPUT_ANCHOR)) {
      // Better to fail loudly at startup than to ship a build where the grade
      // silently stopped being applied after a three.js upgrade.
      throw new Error('postFx: three.js OutputShader changed; grade injection anchor not found');
    }

    const dispersed = aberration > 0;
    if (dispersed) uniforms.aberration = { value: aberration };

    // Both the plain and the dispersed path replace the same single line: the
    // one read of the incoming frame. Whatever fills it, the grade runs on the
    // result, so there is one anchor to keep working across a three upgrade
    // rather than two that can drift apart.
    const read = dispersed
      ? 'gl_FragColor = vec4( sampleDispersed( tDiffuse, vUv ), 1.0 );'
      : OUTPUT_ANCHOR;

    material.fragmentShader = material.fragmentShader
      .replace(
        'varying vec2 vUv;',
        `${dispersed ? ABERRATION_GLSL : ''}${GRADE_GLSL}\n\t\tvarying vec2 vUv;`,
      )
      .replace(
        OUTPUT_ANCHOR,
        `${read}\n\t\t\tgl_FragColor.rgb = applyGrade( gl_FragColor.rgb, vUv );`,
      );
    material.needsUpdate = true;
  }
}

/**
 * The look, as numbers a map can override.
 *
 * The defaults were tuned against a flooded jungle: saturated, contrasty, and
 * with a deliberate cool push into the shadows so they sit against the sky.
 * That grade is not neutral and was never meant to be — but it is applied to
 * whatever is on screen, so every other map inherited a jungle's colour
 * balance and read blue.
 */
export interface Grade {
  saturation: number;
  contrast: number;
  /** Tint multiplied into highlights. */
  warmth: [number, number, number];
  /** Tint multiplied into shadows. */
  coolShadow: [number, number, number];
  vignette: number;
}

export const JUNGLE_GRADE: Grade = {
  saturation: SATURATION,
  contrast: CONTRAST,
  warmth: [WARMTH.r, WARMTH.g, WARMTH.b],
  coolShadow: [COOL_SHADOW.r, COOL_SHADOW.g, COOL_SHADOW.b],
  vignette: VIGNETTE,
};

/**
 * No split tone at all.
 *
 * A starting point for anywhere that is not a jungle: the contrast and a little
 * saturation are worth keeping everywhere, the colour cast is not.
 */
export const NEUTRAL_GRADE: Grade = {
  saturation: 1.06,
  contrast: 1.12,
  warmth: [1, 1, 1],
  coolShadow: [1, 1, 1],
  vignette: 0.16,
};

export interface PostFxOptions {
  /**
   * Force the light shafts off whatever the tier says.
   *
   * The hub asks for this. Shafts exist for sunlight coming down through a
   * canopy; over an open terrace there is nothing to cast them, so every ray
   * stacks on a bright sky and bleaches the whole view — which is what happened
   * to the mountains the first time the villa was built.
   */
  godRays?: boolean;
}

export interface PostFx {
  render(camera: THREE.Camera): void;
  /** Replace the look. Any field left out keeps its current value. */
  setGrade(grade: Partial<Grade>): void;
  setSize(width: number, height: number): void;
  /**
   * The bloom pass, exposed for live tuning through the debug handle. Null on
   * tiers that do not run it.
   *
   * Threshold and strength are the two settings that have to be re-checked
   * whenever the sky's radiance changes, and the only honest way to pick them
   * is to look at the frame while turning the knob.
   */
  readonly bloom: UnrealBloomPass | null;
  /**
   * Point the light shafts at the sun. Call once per rendered frame; a no-op
   * where the pass was never built.
   */
  aimGodRays(camera: THREE.Camera, sunDirection: THREE.Vector3): void;
  readonly godRays: GodRays | null;
  /**
   * Switch one effect on or off while the game is running.
   *
   * @returns false when this chain cannot honour it — the pass was never built,
   *   because the tier this page started on did not want it. The caller decides
   *   what to do about that; the honest answer is a reload, and lying about it
   *   would mean a switch that visibly flips and changes nothing.
   */
  setEffect(key: 'bloom' | 'godRays' | 'aberration', on: boolean): boolean;
  /** Fraction of the display resolution the chain currently renders at, 0..1. */
  readonly renderScale: number;
  /**
   * Size of the buffer the scene is actually drawn into, in device pixels.
   *
   * Worth surfacing because it is not the canvas size and never was: the chain
   * runs at the device resolution times the adaptive scale, while the canvas
   * only ever receives the upscaled result. Reading the canvas size and calling
   * it the render resolution is how the original chain came to run at a quarter
   * of the pixels on every high-DPI screen without anyone noticing.
   */
  readonly bufferSize: { width: number; height: number };
  /**
   * Report one frame's wall-clock duration, in milliseconds, so the chain can
   * trade resolution for frame rate. Call once per rendered frame.
   */
  tune(frameMs: number): void;
}

/**
 * Bloom + grading in one chain.
 *
 * The composer renders into a half-float target so bloom has real HDR headroom
 * to pick highlights out of; with an 8-bit target everything above white is
 * already clipped and the threshold has nothing to find.
 *
 * Everything the chain does is per-pixel, so its cost depends on the size of
 * the frame and not at all on what is in the scene — on a modest GPU it is the
 * single largest item in the budget, and the only lever that reliably moves it
 * is rendering fewer pixels. Hence the tier settings and the adaptive scale.
 */
export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualitySettings,
  options: PostFxOptions = {},
): PostFx {
  const adaptive = createAdaptiveResolution(quality.minRenderScale);
  const size = renderer.getSize(new THREE.Vector2());
  let cssWidth = size.x;
  let cssHeight = size.y;

  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality.msaaSamples,
    }),
  );

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  /*
   * Passes the tier does not want are not built at all.
   *
   * Zeroing a uniform is not the same saving and never was: an UnrealBloomPass
   * with strength 0 still runs its five-level downsample pyramid and the
   * matching upsample chain, and a god-ray pass with exposure 0 still marches
   * its full sample loop for every pixel on the screen — both write the answer
   * "nothing" at the same price as the answer "something". Low needs the frame
   * to contain fewer *passes*, not weaker ones.
   */
  const godRays = quality.godRays && options.godRays !== false ? createGodRays() : null;
  // Before bloom, so the shafts themselves bloom rather than being pasted on
  // top of an already-bloomed frame.
  if (godRays) composer.addPass(godRays.pass);

  let bloom: UnrealBloomPass | null = null;
  if (quality.bloom) {
    bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    // The composer sizes every pass to the frame. Bloom is a wide blur that
    // gets upsampled anyway, so it can run on a fraction of that and still look
    // the same — this is where most of its cost goes.
    const pass = bloom;
    const sizeBloom = pass.setSize.bind(pass);
    pass.setSize = (width: number, height: number): void => {
      sizeBloom(
        Math.max(2, Math.round(width * quality.bloomScale)),
        Math.max(2, Math.round(height * quality.bloomScale)),
      );
    };
    composer.addPass(pass);
  }

  // Last: grade, tone map, convert to sRGB. Without it the composer output
  // stays linear and the picture looks washed out. This one is not optional at
  // any tier — it is the tone mapping, not an effect.
  const output = new GradedOutputPass(quality.aberration);
  composer.addPass(output);

  // Device pixels are computed here and handed to the composer whole, rather
  // than letting it multiply a CSS size by a pixel ratio. On a display scaled
  // to 175% that multiplication lands on a fraction — 1434 x 1.75 = 2509.5 —
  // and every render target silently truncates to a different size than the
  // canvas, which shifts the final upscale by a fraction of a pixel and softens
  // every edge in the frame.
  const applySize = (): void => {
    // Read the ratio each time rather than capturing it: dragging the window to
    // a monitor with different scaling changes it, and a stale value would size
    // the buffers for the display the game started on.
    const factor = renderer.getPixelRatio() * adaptive.scale;
    composer.setPixelRatio(1);
    // Floor, not round: three sizes the canvas with Math.floor, and a buffer
    // one pixel wider than the canvas rescales the whole image on the way out.
    composer.setSize(
      Math.max(1, Math.floor(cssWidth * factor)),
      Math.max(1, Math.floor(cssHeight * factor)),
    );
  };
  applySize();

  return {
    bloom,
    godRays,
    setEffect(key, on) {
      /*
       * `pass.enabled` rather than a strength of zero.
       *
       * EffectComposer skips a disabled pass entirely, so switching bloom off
       * this way really does remove its downsample pyramid from the frame —
       * where UnrealBloomPass at strength 0 would still run every one of those
       * draws to add nothing. Same for the shafts and their sample loop.
       */
      if (key === 'bloom') {
        if (!bloom) return false;
        bloom.enabled = on;
        return true;
      }
      if (key === 'godRays') {
        if (!godRays) return false;
        godRays.pass.enabled = on;
        return true;
      }
      // Aberration is three texture reads inside the output pass rather than a
      // pass of its own, so it can only be switched where the shader was
      // compiled with the code in it. Zeroing the offset makes the two extra
      // reads sample the same texel the middle one does — identical output, and
      // not worth recompiling every material to avoid.
      const uniforms = output.uniforms as Record<string, THREE.IUniform | undefined>;
      if (!uniforms.aberration) return false;
      uniforms.aberration.value = on ? quality.aberration || 0.0016 : 0;
      return true;
    },
    aimGodRays(activeCamera, sunDirection) {
      godRays?.update(activeCamera, sunDirection);
    },
    get renderScale() {
      return adaptive.scale;
    },
    get bufferSize() {
      return { width: composer.renderTarget1.width, height: composer.renderTarget1.height };
    },
    setGrade(grade: Partial<Grade>): void {
      const u = output.uniforms as Record<string, THREE.IUniform>;
      if (grade.saturation !== undefined) u.saturation.value = grade.saturation;
      if (grade.contrast !== undefined) u.contrast.value = grade.contrast;
      if (grade.vignette !== undefined) u.vignette.value = grade.vignette;
      if (grade.warmth) (u.warmth.value as THREE.Color).setRGB(...grade.warmth);
      if (grade.coolShadow) (u.coolShadow.value as THREE.Color).setRGB(...grade.coolShadow);
    },
    render(activeCamera: THREE.Camera): void {
      // The editor swaps between the game camera and its own fly cameras.
      renderPass.camera = activeCamera;
      composer.render();
    },
    setSize(width: number, height: number): void {
      cssWidth = width;
      cssHeight = height;
      // A resize changes what a frame costs, and on a laptop it often means the
      // window moved to a different display with a different refresh rate.
      adaptive.reset();
      applySize();
    },
    tune(frameMs: number): void {
      if (adaptive.update(frameMs)) applySize();
    },
  };
}
