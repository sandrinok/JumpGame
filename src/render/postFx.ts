import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createAdaptiveResolution, type QualitySettings } from './quality';

/**
 * Bloom runs on the raw linear HDR buffer, before exposure and tone mapping.
 * The sky shader emits radiance well above 1 across its whole surface, so a
 * threshold near 1 makes the entire sky glow and washes out anything in front
 * of it. This has to sit above the sky's general brightness so only the sun
 * and genuine speculars are picked up.
 */
const BLOOM_THRESHOLD = 4.0;
const BLOOM_STRENGTH = 0.4;
const BLOOM_RADIUS = 0.6;

/** Colour grading constants; see GRADE_GLSL for what each one does. */
const SATURATION = 1.12;
/** Tint multiplied into highlights; the sun already reads warm. */
const WARMTH = new THREE.Color(1.03, 1.0, 0.96);
/** Tint added to shadows, pushing them towards the sky's blue. */
const COOL_SHADOW = new THREE.Color(0.96, 0.99, 1.06);
const VIGNETTE = 0.22;

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
  uniform vec3 warmth;
  uniform vec3 coolShadow;
  uniform float vignette;

  vec3 applyGrade( vec3 c, vec2 uv ) {

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
  constructor() {
    super();

    const uniforms = this.uniforms as Record<string, THREE.IUniform>;
    uniforms.saturation = { value: SATURATION };
    uniforms.warmth = { value: WARMTH };
    uniforms.coolShadow = { value: COOL_SHADOW };
    uniforms.vignette = { value: VIGNETTE };

    const material = this.material as THREE.ShaderMaterial;
    if (!material.fragmentShader.includes(OUTPUT_ANCHOR)) {
      // Better to fail loudly at startup than to ship a build where the grade
      // silently stopped being applied after a three.js upgrade.
      throw new Error('postFx: three.js OutputShader changed; grade injection anchor not found');
    }
    material.fragmentShader = material.fragmentShader
      .replace('varying vec2 vUv;', `${GRADE_GLSL}\n\t\tvarying vec2 vUv;`)
      .replace(OUTPUT_ANCHOR, `${OUTPUT_ANCHOR}\n\t\t\tgl_FragColor.rgb = applyGrade( gl_FragColor.rgb, vUv );`);
    material.needsUpdate = true;
  }
}

export interface PostFx {
  render(camera: THREE.Camera): void;
  setSize(width: number, height: number): void;
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

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  // The composer sizes every pass to the frame. Bloom is a wide blur that gets
  // upsampled anyway, so it can run on a fraction of that and still look the
  // same — this is where most of its cost goes.
  const sizeBloom = bloom.setSize.bind(bloom);
  bloom.setSize = (width: number, height: number): void => {
    sizeBloom(
      Math.max(2, Math.round(width * quality.bloomScale)),
      Math.max(2, Math.round(height * quality.bloomScale)),
    );
  };
  composer.addPass(bloom);

  // Last: grade, tone map, convert to sRGB. Without it the composer output
  // stays linear and the picture looks washed out.
  composer.addPass(new GradedOutputPass());

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
    get renderScale() {
      return adaptive.scale;
    },
    get bufferSize() {
      return { width: composer.renderTarget1.width, height: composer.renderTarget1.height };
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
