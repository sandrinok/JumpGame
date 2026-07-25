import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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

/**
 * Colour grading: saturation, a warm/cool split, and a vignette.
 *
 * One fullscreen pass covering all three. Applied in linear space before
 * OutputPass does tone mapping, so the grade behaves like a lens filter rather
 * than a Photoshop layer on the final image.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 1.12 },
    /** Tint multiplied into highlights; the sun already reads warm. */
    warmth: { value: new THREE.Color(1.03, 1.0, 0.96) },
    /** Tint added to shadows, pushing them towards the sky's blue. */
    coolShadow: { value: new THREE.Color(0.96, 0.99, 1.06) },
    vignette: { value: 0.22 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform vec3 warmth;
    uniform vec3 coolShadow;
    uniform float vignette;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      // Rec. 709 luma, so saturation does not shift perceived brightness.
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);

      // Split tone: warm where it is bright, cool where it is dark. This is
      // most of what makes a render read as "graded" rather than raw.
      float t = smoothstep(0.15, 0.85, luma);
      c *= mix(coolShadow, warmth, t);

      // Distance from centre, corrected so the falloff stays round on a
      // widescreen viewport.
      vec2 d = vUv - 0.5;
      float r = length(d * vec2(1.0, 0.62));
      c *= 1.0 - vignette * smoothstep(0.25, 0.72, r);

      gl_FragColor = vec4(c, texel.a);
    }
  `,
};

export interface PostFx {
  render(camera: THREE.Camera): void;
  setSize(width: number, height: number): void;
}

/**
 * Bloom + grading in one chain.
 *
 * The composer renders into a half-float target so bloom has real HDR
 * headroom to pick highlights out of; with an 8-bit target everything above
 * white is already clipped and the threshold has nothing to find.
 */
export function createPostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostFx {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    }),
  );

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD),
  );

  composer.addPass(new ShaderPass(GradeShader));

  // Last: applies the renderer's tone mapping and converts to sRGB. Without
  // it the composer output stays linear and the picture looks washed out.
  composer.addPass(new OutputPass());

  return {
    render(activeCamera: THREE.Camera): void {
      // The editor swaps between the game camera and its own fly cameras.
      renderPass.camera = activeCamera;
      composer.render();
    },
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
    },
  };
}
