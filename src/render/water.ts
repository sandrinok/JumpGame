import * as THREE from 'three';

/**
 * The flooded street level.
 *
 * This exists for a design reason before a visual one. The kill plane sits just
 * above the ground collider, so touching street level ends the run — but until
 * now street level was *grass*, and a fatal lawn is the kind of rule a player
 * learns by dying to it rather than by looking at it. Water reads as lethal
 * without being explained. The rule did not change; it just became visible.
 *
 * Rendered as one plane with a patched MeshStandardMaterial rather than a
 * reflection probe. A real planar reflection means drawing the whole scene a
 * second time, and at the bottom of a 183m tower the thing being reflected is
 * mostly sky and canopy — which the environment map already holds. Fresnel does
 * the rest: water is nearly a mirror at grazing angles and nearly transparent
 * looking straight down, and getting *that* right matters far more than
 * reflecting the correct individual leaf.
 */

const WATER_GLSL = /* glsl */ `
  float waterHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float waterNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x),
      mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), f.x),
      f.y);
  }

  /**
   * Two noise fields scrolling in different directions at different scales.
   * One alone reads as a texture sliding across the surface rather than as
   * moving water — the interference between two is what looks like a swell.
   */
  float waterHeight(vec2 p, float t) {
    float a = waterNoise(p * 0.35 + vec2(t * 0.045, t * 0.02));
    float b = waterNoise(p * 0.9 - vec2(t * 0.03, t * 0.055));
    return a * 0.65 + b * 0.35;
  }
`;

export interface Water {
  mesh: THREE.Mesh;
  /** Advance the ripples. Call once per rendered frame. */
  update(elapsed: number): void;
}

export function createWater(scene: THREE.Scene, surfaceY: number, size = 400): Water {
  const uniforms = { uTime: { value: 0 } };

  const material = new THREE.MeshStandardMaterial({
    // Stagnant water over a rotting city: green-black, not tropical blue.
    color: new THREE.Color(0x0b130d),
    // Not a mirror. At 0.09 the surface returned the sky almost perfectly and
    // the flooded level came out brighter than the ruins standing in it, which
    // reads as mist rather than as water. Stagnant water under a canopy is
    // scattered and slightly turbid; the roughness is what says so.
    roughness: 0.17,
    metalness: 0.02,
    transparent: true,
    opacity: 0.92,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vWaterWorld;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vWaterWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vWaterWorld;
         uniform float uTime;
         ${WATER_GLSL}
         void main() {`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `
        #include <normal_fragment_begin>
        {
          // Finite differences on the height field give the surface slope.
          // Cheaper than carrying a normal map and it animates for free.
          vec2 p = vWaterWorld.xz;
          float e = 0.35;
          float h = waterHeight( p, uTime );
          float hx = waterHeight( p + vec2( e, 0.0 ), uTime );
          float hz = waterHeight( p + vec2( 0.0, e ), uTime );
          vec3 ripple = normalize( vec3( ( h - hx ) * 1.6, 1.0, ( h - hz ) * 1.6 ) );
          // Flatten with distance. Ripples an unresolvable fraction of a pixel
          // across do not read as water, they read as noise — and from the top
          // of the tower the whole surface is exactly that far away.
          float d = length( vWaterWorld - cameraPosition );
          normal = normalize( mix( ripple, vec3( 0.0, 1.0, 0.0 ), smoothstep( 40.0, 160.0, d ) ) );
        }
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        {
          // Fresnel. Looking down, water is dark and you see into it; at a
          // grazing angle it is a mirror. This one term is most of what makes a
          // flat plane read as a liquid rather than as shiny ground.
          vec3 viewDir = normalize( cameraPosition - vWaterWorld );
          float fres = pow( 1.0 - clamp( dot( viewDir, normal ), 0.0, 1.0 ), 4.0 );
          diffuseColor.a = mix( 0.8, 1.0, fres );
          outgoingLight += vec3( 0.05, 0.075, 0.06 ) * fres * 2.6;
        }
        #include <opaque_fragment>
        `,
      );
  };

  material.customProgramCacheKey = () => 'water-v1';

  // Two segments is enough: the surface is displaced in the shader's normal,
  // not in its geometry, so subdividing buys nothing but vertices.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 2, 2), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = surfaceY;
  mesh.receiveShadow = true;
  // Drawn after the opaque world so it blends against it correctly.
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);

  return {
    mesh,
    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
  };
}
