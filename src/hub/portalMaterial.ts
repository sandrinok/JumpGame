import * as THREE from 'three';

/**
 * The surface inside a portal ring.
 *
 * A torus on its own reads as a hoop, not a doorway — there is nothing to walk
 * *into*. What sells it is the plane it frames: something moving, bright at the
 * rim and deep in the middle, so the eye reads depth where there is none.
 *
 * Written as a shader rather than a scrolling texture because the motion has to
 * be polar. Anything panning in x or y looks like a screen hung in a hoop; a
 * doorway to somewhere else has to swirl around its own centre and fall into
 * it. That also means no texture to load, no seam to hide, and one draw call.
 *
 * `uCharge` rises while the player stands on the pad. The portal answering the
 * approach is most of what makes walking into it feel like a decision the game
 * noticed, rather than a trigger volume that happened to fire.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uColour;
  uniform float uTime;
  uniform float uCharge;
  varying vec2  vUv;

  // Cheap value noise. Two octaves is enough: this is seen through a swirl and
  // a radial fade, and the third octave was invisible at any distance the
  // player can actually stand.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    // Outside the ring there is nothing. Discarding rather than fading keeps
    // the square geometry from showing as a dark pane against the room.
    if (r > 1.0) discard;

    float a = atan(p.y, p.x);
    float spin = uTime * (0.35 + uCharge * 1.4);

    // Two layers turning at different rates and opposite directions. One layer
    // reads as a rotating picture; two read as depth.
    float n1 = noise(vec2(a * 2.2 + spin, r * 5.0 - uTime * 0.8));
    float n2 = noise(vec2(a * 3.7 - spin * 1.6, r * 8.0 - uTime * 1.3));
    float swirl = n1 * 0.65 + n2 * 0.35;

    // Bright at the rim, falling into the middle: the opposite of a spotlight,
    // and what makes it read as an opening rather than a bulb.
    float rim = smoothstep(0.55, 1.0, r);
    float core = 1.0 - smoothstep(0.0, 0.85, r);
    float body = swirl * (0.35 + rim * 1.5) + core * 0.22;

    // A hard bright edge right at the boundary, so the ring has something to
    // sit against.
    float edge = smoothstep(0.93, 1.0, r) * (1.0 - smoothstep(0.99, 1.0, r));

    vec3 col = uColour * (body * (0.9 + uCharge * 2.6) + edge * 2.2);
    // Toward white as it charges, so the change reads even on a saturated
    // accent colour where "brighter" alone would not.
    col = mix(col, vec3(1.0), uCharge * 0.35 * swirl);

    float alpha = clamp(body * 1.5 + edge, 0.0, 1.0) * (0.72 + uCharge * 0.28);
    gl_FragColor = vec4(col, alpha);
  }
`;

export interface PortalSurface {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export function createPortalSurface(colour: THREE.Color, radius: number): PortalSurface {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColour: { value: colour.clone() },
      uTime: { value: 0 },
      uCharge: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    // Additive: this is light, not a surface. It also means the room behind
    // shows through the thinner parts, which is what stops it looking like a
    // solid disc someone painted.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material);
  return { mesh, material };
}
