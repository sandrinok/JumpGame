import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Screen-space light shafts.
 *
 * The single most recognisable thing about rainforest footage is the shafts of
 * sun coming down through gaps in the canopy. It is not really a lighting
 * effect — it is sunlight scattering off humidity between the leaves and the
 * ground — and it is what makes air look like it is *there* rather than empty.
 *
 * This is the classic radial-blur approach: march from each pixel towards the
 * sun's screen position, accumulate whatever is bright along the way, and add
 * it back. It is a cheap approximation and it has one very visible failure mode
 * — anything bright smears towards the sun whether it is occluding light or
 * not — which is handled by only accumulating pixels well above the scene's
 * general brightness, so it picks up sky seen through canopy gaps and ignores a
 * lit slab.
 *
 * Runs before bloom, so the shafts themselves get to bloom rather than being
 * added on top of an already-bloomed image.
 */

const GOD_RAYS_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    /** Sun position in screen space, 0..1. */
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    /** How far along the ray to march, as a fraction of the distance. */
    uDensity: { value: 0.72 },
    /** Brightness falloff per step: how quickly a shaft fades with distance. */
    uDecay: { value: 0.972 },
    /*
     * Weight and exposure tuned down hard from a first pass at 0.06/0.5, which
     * was spectacular in a still and unusable in play: the shafts summed to
     * more than the surfaces behind them and the whole lower frame went white.
     * The effect only works when it reads as air between you and the geometry;
     * once it is brighter than the geometry it *is* the geometry.
     */
    uWeight: { value: 0.03 },
    uExposure: { value: 0.12 },
    /** Only radiance above this contributes; see the note about smearing. */
    uThreshold: { value: 3.6 },
    /**
     * Fades the whole effect out as the sun leaves the frame.
     *
     * Without it the shafts snap off the instant the sun crosses the screen
     * edge, which is far more noticeable than the effect appearing — the eye
     * ignores light arriving and catches light vanishing.
     */
    uFalloff: { value: 1 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uDensity;
    uniform float uDecay;
    uniform float uWeight;
    uniform float uExposure;
    uniform float uThreshold;
    uniform float uFalloff;
    varying vec2 vUv;

    const int SAMPLES = 48;

    void main() {
      vec4 scene = texture2D( tDiffuse, vUv );

      if ( uFalloff <= 0.001 ) {
        gl_FragColor = scene;
        return;
      }

      vec2 delta = ( vUv - uSun ) * ( uDensity / float( SAMPLES ) );
      vec2 coord = vUv;
      float illum = 1.0;
      vec3 accum = vec3( 0.0 );

      for ( int i = 0; i < SAMPLES; i++ ) {
        coord -= delta;
        // Marching off the edge of the buffer clamps, which drags the border
        // pixel into a long streak. Stop instead.
        if ( coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 ) break;
        vec3 s = texture2D( tDiffuse, coord ).rgb;
        // Only genuinely bright things cast a shaft. Without this every lit
        // surface smears sunward and the frame looks greasy rather than hazy.
        s = max( s - uThreshold, vec3( 0.0 ) );
        accum += s * illum * uWeight;
        illum *= uDecay;
      }

      gl_FragColor = vec4( scene.rgb + accum * uExposure * uFalloff, scene.a );
    }
  `,
};

export interface GodRays {
  pass: ShaderPass;
  /** Point the shafts at the sun. Call once per rendered frame. */
  update(camera: THREE.Camera, sunWorldDirection: THREE.Vector3): void;
}

export function createGodRays(): GodRays {
  const pass = new ShaderPass(GOD_RAYS_SHADER);
  const sunWorld = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const uniforms = pass.uniforms as Record<string, THREE.IUniform>;

  return {
    pass,
    update(camera, sunDirection) {
      // The sun is directional and effectively at infinity, so project a point
      // a long way along its direction rather than a real position.
      sunWorld.copy(sunDirection).multiplyScalar(4000);
      camera.getWorldDirection(forward);

      // Behind the camera the projection wraps around and produces a phantom
      // sun in the opposite corner, dragging shafts the wrong way across the
      // frame. Kill it before it can.
      const facing = forward.dot(sunDirection);
      if (facing <= 0.02) {
        uniforms.uFalloff.value = 0;
        return;
      }

      sunWorld.project(camera);
      const sx = sunWorld.x * 0.5 + 0.5;
      const sy = sunWorld.y * 0.5 + 0.5;
      uniforms.uSun.value.set(sx, sy);

      const edge = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
      const onScreen = 1 - THREE.MathUtils.smoothstep(edge, 0.5, 1.15);

      /*
       * Pulled *down* again as the sun approaches the centre of the frame.
       *
       * Every ray converges on the sun, so with it dead centre the shafts stack
       * on top of each other over the whole screen and the frame goes white —
       * looking straight at the sun cost the player the ability to see the next
       * foothold. Physically that is what staring at the sun does; it is also
       * unplayable, and the readability rule wins.
       *
       * The effect is strongest with the sun just off to one side, which is
       * where shafts read as shafts rather than as glare anyway.
       */
      const centred = 1 - THREE.MathUtils.smoothstep(edge, 0.04, 0.3);
      const glare = 1 - centred * 0.72;

      uniforms.uFalloff.value =
        THREE.MathUtils.smoothstep(facing, 0.02, 0.35) * onScreen * glare;
    },
  };
}
