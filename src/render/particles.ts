import * as THREE from 'three';

/**
 * Two particle systems, both deliberately small.
 *
 * **Motes** are the drifting specks of dust and pollen that hang in humid air.
 * They exist to be caught by the light shafts: a shaft with nothing suspended
 * in it is a gradient, and a shaft full of slowly turning specks is *air*. They
 * follow the camera in a moving box rather than filling the world, because the
 * only ones that matter are within a few metres of the eye.
 *
 * **Bursts** are one-shot puffs — dust on a hard landing, spray when the player
 * hits the water. Landing without a puff reads as the character stopping rather
 * than as the ground arriving.
 *
 * Both are single `Points` draws with a shader that does the animation, so the
 * CPU never touches a particle after allocation.
 */

const MOTE_COUNT = 900;
/** Half-size of the box of motes that follows the camera. */
const MOTE_RANGE = 26;
const BURST_COUNT = 340;

const SOFT_SPRITE = /* glsl */ `
  // Round, soft-edged point. The default square is unmistakably a square the
  // moment a particle gets close to the camera.
  float d = length( gl_PointCoord - vec2( 0.5 ) );
  float alpha = smoothstep( 0.5, 0.12, d );
`;

export interface Particles {
  update(elapsed: number, cameraPos: THREE.Vector3): void;
  /** Fire a one-shot puff. `kind` picks dust or water. */
  burst(at: THREE.Vector3, strength: number, kind: 'dust' | 'splash'): void;
  /**
   * Show or hide the drifting motes while the game runs.
   *
   * @returns false where the tier never built them, so the caller can say a
   *   reload is needed rather than flipping a switch that does nothing.
   */
  setMotesVisible(on: boolean): boolean;
}

/**
 * @param moteScale multiplier on the drifting mote count. 0 skips the system
 *   entirely — the motes exist to be caught by the light shafts, and the tiers
 *   that switch the shafts off have nothing for them to hang in. They are also
 *   900 additively blended sprites in a box around the camera, which is to say
 *   900 overlapping fullscreen-ish quads of pure overdraw on exactly the
 *   hardware least able to pay for it. Bursts are always built: they are one
 *   allocation, fire once per drowning, and are the only thing that marks it.
 */
export function createParticles(scene: THREE.Scene, moteScale = 1): Particles {
  const uniforms = {
    uTime: { value: 0 },
    uCamera: { value: new THREE.Vector3() },
    uRange: { value: MOTE_RANGE },
  };

  // ---- motes -------------------------------------------------------------

  const moteCount = Math.round(MOTE_COUNT * moteScale);
  const moteGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(moteCount * 3);
    const seed = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i++) {
      pos[i * 3] = Math.random();
      pos[i * 3 + 1] = Math.random();
      pos[i * 3 + 2] = Math.random();
      seed[i] = Math.random() * 100;
    }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    // Positions are 0..1 cell coordinates, not world space, so three cannot
    // derive useful bounds and would cull the whole system the moment the
    // camera left the unit cube.
    moteGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  }

  const moteMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform vec3 uCamera;
      uniform float uRange;
      varying float vFade;

      void main() {
        // Wrap the mote box around the camera. Flooring the camera position to
        // the cell size and adding the particle's offset means each mote has a
        // stable world position that only jumps when the camera crosses a whole
        // cell — and it jumps to somewhere the camera is not looking.
        vec3 cell = floor( uCamera / uRange ) * uRange;
        vec3 world = cell + position * uRange * 2.0 - uRange * 0.5;

        // Slow convection: motes rise, drift, and turn over.
        float t = uTime * 0.08 + aSeed;
        world.x += sin( t * 1.7 ) * 0.9;
        world.y += sin( t * 1.1 + aSeed ) * 0.7 + mod( uTime * 0.15 + aSeed, 6.0 );
        world.z += cos( t * 1.3 ) * 0.9;

        vec4 mv = modelViewMatrix * vec4( world, 1.0 );
        // Fade at the edge of the box, so motes are never seen appearing.
        float dist = length( world - uCamera );
        vFade = smoothstep( uRange, uRange * 0.35, dist ) * smoothstep( 0.6, 3.0, dist );
        gl_PointSize = ( 26.0 / -mv.z ) * ( 0.6 + fract( aSeed ) * 0.9 );
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vFade;
      void main() {
        ${SOFT_SPRITE}
        if ( alpha < 0.01 ) discard;
        gl_FragColor = vec4( vec3( 0.95, 0.98, 0.85 ), alpha * vFade * 0.5 );
      }
    `,
  });

  let motes: THREE.Points | null = null;
  if (moteCount > 0) {
    motes = new THREE.Points(moteGeo, moteMat);
    motes.frustumCulled = false;
    motes.renderOrder = 2;
    scene.add(motes);
  }

  // ---- bursts ------------------------------------------------------------

  const burstUniforms = {
    uTime: { value: 0 },
    uStart: { value: -99 },
    uOrigin: { value: new THREE.Vector3() },
    uStrength: { value: 1 },
    uColour: { value: new THREE.Color(0.72, 0.68, 0.58) },
    uRise: { value: 0.4 },
  };

  const burstGeo = new THREE.BufferGeometry();
  {
    const pos = new Float32Array(BURST_COUNT * 3);
    for (let i = 0; i < BURST_COUNT; i++) {
      // Points on a hemisphere, biased outward and low — a puff spreads along
      // the ground far more than it goes up.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 0.55;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    burstGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    burstGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  }

  const burstMat = new THREE.ShaderMaterial({
    uniforms: burstUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uStart;
      uniform vec3 uOrigin;
      uniform float uStrength;
      uniform float uRise;
      varying float vLife;

      void main() {
        float age = uTime - uStart;
        vLife = clamp( 1.0 - age / 1.1, 0.0, 1.0 );
        // Ease out: a puff throws itself outward and then almost stops, which
        // is what air resistance does to dust and what a linear expansion
        // conspicuously fails to look like.
        float spread = ( 1.0 - pow( 1.0 - clamp( age / 1.1, 0.0, 1.0 ), 3.0 ) );
        vec3 world = uOrigin
          + position * spread * uStrength * 2.4
          + vec3( 0.0, spread * uRise * uStrength - age * age * 0.55, 0.0 );
        vec4 mv = modelViewMatrix * vec4( world, 1.0 );
        gl_PointSize = ( 30.0 / -mv.z ) * uStrength * ( 0.5 + spread );
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour;
      varying float vLife;
      void main() {
        ${SOFT_SPRITE}
        if ( alpha < 0.01 || vLife <= 0.0 ) discard;
        gl_FragColor = vec4( uColour, alpha * vLife * 0.55 );
      }
    `,
  });

  const bursts = new THREE.Points(burstGeo, burstMat);
  bursts.frustumCulled = false;
  bursts.renderOrder = 2;
  scene.add(bursts);

  return {
    setMotesVisible(on) {
      if (!motes) return false;
      motes.visible = on;
      return true;
    },
    update(elapsed, cameraPos) {
      uniforms.uTime.value = elapsed;
      uniforms.uCamera.value.copy(cameraPos);
      burstUniforms.uTime.value = elapsed;
    },
    burst(at, strength, kind) {
      burstUniforms.uStart.value = burstUniforms.uTime.value;
      burstUniforms.uOrigin.value.copy(at);
      burstUniforms.uStrength.value = Math.max(0.35, Math.min(2.2, strength));
      if (kind === 'splash') {
        burstUniforms.uColour.value.setRGB(0.62, 0.74, 0.66);
        // Water throws up, dust throws out.
        burstUniforms.uRise.value = 1.5;
      } else {
        burstUniforms.uColour.value.setRGB(0.72, 0.68, 0.58);
        burstUniforms.uRise.value = 0.4;
      }
    },
  };
}
