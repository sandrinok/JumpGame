import * as THREE from 'three';

/**
 * Procedural weathered-concrete material for the ruin structure.
 *
 * The structural geometry is box primitives scaled non-uniformly — a 7x0.5x2
 * slab and a 3x9x3 column share one unit-cube geometry and one set of UVs. Any
 * texture mapped through those UVs stretches by whatever the scale happened to
 * be, so the surface has to be generated from *world* position instead. That
 * also means neighbouring slabs never tile identically: the noise is continuous
 * through the whole tower, so two slabs meeting at a corner share their grain.
 *
 * World normals come out of `mat3(modelMatrix) * objectNormal` without an
 * inverse-transpose, which is normally wrong under non-uniform scale. It is
 * exact here: a box's normals are axis-aligned unit vectors, so scaling by
 * (sx,sy,sz) only ever stretches a normal along its own axis, and normalizing
 * puts it straight back. Cheap and correct, but only because everything this
 * material touches is a box.
 *
 * The moss is the part that does the thematic work, and it is deliberately
 * driven by `normal.y`: growth accumulates on horizontal surfaces and gives up
 * on vertical ones. That is also a readability win rather than a cost — the
 * faces the player can stand on are the faces that go green, so the material
 * itself signals "this is a foothold" without a single decal being placed.
 */

const NOISE_GLSL = /* glsl */ `
  // Cheap 3D value noise. Hash is the usual sin-fract trick; it bands slightly
  // at large coordinates but the tower is only ~180m tall, well inside where
  // that shows.
  float ruinHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float ruinNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(ruinHash(i + vec3(0,0,0)), ruinHash(i + vec3(1,0,0)), f.x),
          mix(ruinHash(i + vec3(0,1,0)), ruinHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(ruinHash(i + vec3(0,0,1)), ruinHash(i + vec3(1,0,1)), f.x),
          mix(ruinHash(i + vec3(0,1,1)), ruinHash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  float ruinFbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * ruinNoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`;

export interface RuinMaterialOptions {
  /** Base concrete tint. */
  base?: THREE.ColorRepresentation;
  /** 0 = bare stone, 1 = swallowed. */
  moss?: number;
  /** Extra darkening low on the tower, where the canopy keeps everything damp. */
  damp?: number;
}

/**
 * Shared, because every slab in the tower uses them and a texture loaded per
 * material is the same bytes on the GPU several hundred times over.
 *
 * Mirrored-repeat rather than repeat: the source is made seamless by mirroring
 * (see scripts/gen-textures.mjs), so the wrap mode has to agree with how the
 * image was built or the seam it was designed around reappears.
 */
let sharedMaps: { concrete: THREE.Texture; moss: THREE.Texture; concreteN: THREE.Texture } | null =
  null;

interface RuinUniforms {
  uScale: { value: number };
  uMossScale: { value: number };
  [key: string]: { value: unknown };
}

/** Every live ruin material, so the scale can be retuned across all of them. */
const ALL_RUIN_UNIFORMS: RuinUniforms[] = [];

/** Set world-units-per-repeat on every ruin surface at once. */
export function setRuinScale(concrete: number, moss = concrete * 0.8): void {
  for (const u of ALL_RUIN_UNIFORMS) {
    u.uScale.value = concrete;
    u.uMossScale.value = moss;
  }
}

function loadMaps(): NonNullable<typeof sharedMaps> {
  if (sharedMaps) return sharedMaps;
  const loader = new THREE.TextureLoader();
  const load = (file: string, srgb: boolean): THREE.Texture => {
    const t = loader.load(`/assets/textures/${file}`);
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  sharedMaps = {
    concrete: load('concrete_wet.png', true),
    concreteN: load('concrete_wet_n.png', false),
    moss: load('moss_bed.png', true),
  };
  return sharedMaps;
}

export function createRuinMaterial(opts: RuinMaterialOptions = {}): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.base ?? 0x9a958c),
    roughness: 0.95,
    metalness: 0.0,
  });

  const maps = loadMaps();
  const uniforms = {
    uMoss: { value: opts.moss ?? 0.7 },
    uDamp: { value: opts.damp ?? 1.0 },
    uConcrete: { value: maps.concrete },
    uConcreteN: { value: maps.concreteN },
    uMossTex: { value: maps.moss },
    /**
     * World units per texture repeat.
     *
     * Deliberately large — one repeat is wider than most slabs, so the texture
     * is magnified far past the point where its content is readable and what
     * lands on the surface is large soft mottling.
     *
     * Both directions were wrong before. At 3.2m the moss clumps came out about
     * 50cm across, and a field of round green blobs seen from above reads
     * unmistakably as tree canopy. Going the other way to 0.62m fixed that and
     * introduced the opposite problem: enough repeats across a single slab to
     * make the tiling grid plainly visible.
     *
     * Magnifying past legibility solves both at once. A player standing on a
     * platform should read "damp concrete" from the *colour and value*, not
     * identify the photograph it came from — and at this scale there is no
     * period short enough to find.
     */
    uScale: { value: 42 },
    uMossScale: { value: 34 },
  };

  material.userData.uniforms = uniforms;

  /*
   * Every ruin material shares one scale, adjustable live.
   *
   * Texture scale is a pure judgement call — there is no measurement that says
   * how magnified "damp concrete" should be — and the only way to settle one is
   * to look at it while turning the knob. Reloading between guesses turns a
   * thirty-second decision into ten minutes.
   *
   *     __jg.ruinScale(60)          // both
   *     __jg.ruinScale(60, 45)      // concrete, moss
   */
  ALL_RUIN_UNIFORMS.push(uniforms);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMoss = uniforms.uMoss;
    shader.uniforms.uDamp = uniforms.uDamp;
    shader.uniforms.uConcrete = uniforms.uConcrete;
    shader.uniforms.uConcreteN = uniforms.uConcreteN;
    shader.uniforms.uMossTex = uniforms.uMossTex;
    shader.uniforms.uScale = uniforms.uScale;
    shader.uniforms.uMossScale = uniforms.uMossScale;

    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `varying vec3 vRuinWorld;
         varying vec3 vRuinNormal;
         void main() {`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         vRuinNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vRuinWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vRuinWorld;
         varying vec3 vRuinNormal;
         uniform float uMoss;
         uniform float uDamp;
         uniform sampler2D uConcrete;
         uniform sampler2D uConcreteN;
         uniform sampler2D uMossTex;
         uniform float uScale;
         uniform float uMossScale;
         ${NOISE_GLSL}

         /**
          * Triplanar sampling: project the texture down all three world axes
          * and blend by how much the surface faces each one.
          *
          * Required rather than preferred here. The slabs are one unit cube
          * scaled non-uniformly — a 7x0.5x2 platform and a 3x9x3 column share
          * a geometry and a set of UVs — so any UV-mapped texture stretches by
          * whatever the scale happened to be. Projecting from world space makes
          * the aggregate the same size on every surface in the tower, and makes
          * two slabs meeting at a corner share their grain.
          */
         vec3 triplanar( sampler2D tex, vec3 wp, vec3 wn, float scale ) {
           vec3 blend = pow( abs( wn ), vec3( 4.0 ) );
           blend /= max( blend.x + blend.y + blend.z, 0.0001 );
           vec3 x = texture2D( tex, wp.zy / scale ).rgb;
           vec3 y = texture2D( tex, wp.xz / scale ).rgb;
           vec3 z = texture2D( tex, wp.xy / scale ).rgb;
           return x * blend.x + y * blend.y + z * blend.z;
         }

         /**
          * Two samples at incommensurate scales, multiplied together.
          *
          * The source textures are made seamless by mirroring a quarter of
          * themselves, which is seamless by construction and leaves a visible
          * axis of symmetry straight through the middle. One sample shows that
          * axis, and shows the same clump in the same place on every slab in
          * the tower. Two scales whose ratio is not a simple fraction have a
          * combined period far longer than anything in view, so the repeat
          * stops being findable.
          */
         vec3 triplanarBroken( sampler2D tex, vec3 wp, vec3 wn, float scale ) {
           vec3 a = triplanar( tex, wp, wn, scale );
           vec3 b = triplanar( tex, wp + vec3( 37.7, 11.3, 23.1 ), wn, scale * 2.73 );
           return a * ( 0.55 + b * 0.9 );
         }

         void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #include <map_fragment>

        vec3 wp = vRuinWorld;
        vec3 wn = normalize(vRuinNormal);

        // Grain at three scales: broad patchiness, panel-sized mottling, and a
        // fine speckle that keeps the surface from going flat up close.
        float broad = ruinFbm(wp * 0.11);
        float mid   = ruinFbm(wp * 0.55);
        float fine  = ruinNoise(wp * 3.7);

        // Photographic concrete, tinted by the material's base colour. The
        // texture carries the aggregate, the cracks and the staining that noise
        // could never produce — noise has no structure, so nothing it draws
        // runs anywhere or joins up.
        //
        // The multiplier stays under 1. Concrete is a *dark* material — around
        // 0.25 albedo — and letting the surface push above its base colour
        // clips the whole tower to white under a 3.1-intensity sun and throws
        // away every bit of that detail again.
        vec3 tex = triplanarBroken( uConcrete, wp, wn, uScale );
        vec3 concrete = diffuseColor.rgb * tex * 1.35;
        // Broad noise survives as large-scale variation, so the texture's
        // mirror period never reads as a repeat.
        concrete *= 0.72 + 0.5 * broad;

        // Weathering streaks running down vertical faces. Strongest just under
        // an upward face, fading as they run, which is how real staining works.
        //
        // These carry more weight than they look. A vertical face gets no moss
        // by definition, so without staining every side of every slab is one
        // flat value — and since the player mostly sees slabs edge-on, that
        // flat grey was most of the frame. The streaks are what stop the tower
        // reading as untextured blocks.
        float vertical = 1.0 - abs(wn.y);
        float streak = ruinFbm(vec3(wp.x * 2.2, wp.y * 0.16, wp.z * 2.2));
        concrete *= 1.0 - 0.55 * vertical * smoothstep(0.25, 0.78, streak);

        // Growth creeping down from the top edge onto the upper part of a
        // vertical face, which is where it actually takes hold.
        float creep = vertical * smoothstep(0.42, 0.85, mid) * 0.55;
        concrete = mix(concrete, vec3(0.075, 0.115, 0.055), creep);

        // Moss. Driven by how upward-facing the surface is, broken up by noise
        // so the boundary is ragged instead of a clean terminator, and thinned
        // with height because the canopy thins.
        float up = smoothstep(0.15, 0.75, wn.y);
        float damp = mix(1.0, 0.35, clamp(wp.y / 150.0, 0.0, 1.0)) * uDamp;
        float mossMask = up * damp * uMoss;
        // Widened from smoothstep(0.28, 0.72). Four-octave fbm clusters hard
        // around 0.5, so the tighter window only ever passed a thin band of
        // values and the moss came out as occasional dots rather than as
        // coverage. This lets most of an upward face go green and keeps the
        // noise for the ragged boundary, which is what it was there for.
        mossMask *= smoothstep(0.16, 0.58, broad * 0.55 + mid * 0.45);
        mossMask = clamp(mossMask, 0.0, 1.0);

        // Real moss, darkened towards the canopy's own green. The source is a
        // photograph lit far brighter than anything under a closed canopy.
        vec3 moss = triplanarBroken( uMossTex, wp, wn, uMossScale ) * vec3(0.4, 0.52, 0.28);

        // A lighter rim where moss gives out: the worn lip of a slab, which is
        // exactly the edge the player is judging a landing against.
        float lip = smoothstep(0.55, 0.95, up) * (1.0 - mossMask);
        concrete = mix(concrete, concrete * 1.25, lip * 0.5);

        diffuseColor.rgb = mix(concrete, moss, mossMask);

        // Standing water in the hollows of horizontal faces, low down only.
        float pool = up * smoothstep(0.62, 0.28, broad) * (1.0 - smoothstep(6.0, 26.0, wp.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, pool * 0.7);
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        {
          vec3 wn2 = normalize(vRuinNormal);
          float up2 = smoothstep(0.15, 0.75, wn2.y);
          float b2 = ruinFbm(vRuinWorld * 0.11);
          // Moss is matte; wet stone is not. Both are wetter than dry concrete.
          float wet = up2 * smoothstep(0.62, 0.28, b2) * (1.0 - smoothstep(6.0, 26.0, vRuinWorld.y));
          roughnessFactor = clamp(roughnessFactor - 0.55 * wet + 0.05 * b2, 0.18, 1.0);
        }
        `,
      );
  };

  // Distinguishes this program from a plain MeshStandardMaterial in three's
  // shader cache, which keys on the source it builds.
  material.customProgramCacheKey = () => 'ruin-v1';

  return material;
}
