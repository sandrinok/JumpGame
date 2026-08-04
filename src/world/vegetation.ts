import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetRegistry } from './registry';
import type { Level } from './types';
import type { QualitySettings } from '../render/quality';

/**
 * The jungle.
 *
 * Foliage is generated alpha cards on crossed planes rather than the modelled
 * plants in the asset library. That library's foliage is 8-52 triangle crossed
 * planes with low-resolution textures — the *geometry* was never the problem,
 * and crossed planes are still the right answer at this scale. The problem was
 * that the texture on them had no detail to give, so blown up to tree size they
 * read as torn paper. These cards are the same cheap geometry carrying a
 * 1024px painted cutout instead.
 *
 * Everything is instanced. Triangle count is irrelevant here — a card is four
 * triangles — and the entire cost is draw calls and overdraw. Several thousand
 * individual meshes would be several thousand draw calls; as instances it is
 * one call per species.
 *
 * Placement obeys the standing readability rule: growth is confined to the
 * outer margin of a foothold and kept short, so it draws the edge of a ledge
 * rather than hiding it. The centre of every landing stays bare.
 */

const FOLIAGE_DIR = '/assets/foliage';

interface CardSpec {
  /** Card size in metres at instance scale 1. Square, matching the source PNG. */
  size: number;
  /** How many planes to cross. More is rounder and costs more overdraw. */
  planes: number;
  /** Sink into the ground, to bury the bit of soil some cutouts include. */
  sink?: number;
  castShadow?: boolean;
}

const CARDS: Record<string, CardSpec> = {
  jungle_tree: { size: 24, planes: 2, sink: 0.6, castShadow: true },
  canopy_broadleaf: { size: 7, planes: 3, sink: 0.2 },
  canopy_palm: { size: 8, planes: 3, sink: 0.2 },
  fern_large: { size: 2.8, planes: 2 },
  elephant_ear: { size: 3.2, planes: 2 },
  undergrowth_bush: { size: 2.6, planes: 3 },
  vine_hanging: { size: 4.5, planes: 2 },
};

/**
 * The ceiling. `canopy_broadleaf` is a top-down rosette, which is exactly what
 * a canopy looks like from underneath and from above; `elephant_ear` breaks up
 * its regularity.
 */
const CANOPY_LAYER = ['canopy_broadleaf', 'canopy_palm', 'elephant_ear'];
/** The forest silhouette. */
const TREES = ['jungle_tree'];
/** Mid layer, between trunk height and knee height. */
const MIDSTORY = ['canopy_broadleaf', 'canopy_palm'];
/** Knee height and below. */
const UNDERGROWTH = ['fern_large', 'elephant_ear', 'undergrowth_bush'];
/** Hung off the ruin. */
const VINES = ['vine_hanging'];

/**
 * Rubble scattered over the ruin. Real modelled meshes rather than cards, so
 * unlike foliage they hold up close to the camera — which is where they get
 * used, on the slab the player is standing on. Chosen by measured size
 * (0.45-1.8m wide, under 1.5m tall) so nothing can hide a landing.
 */
const DEBRIS = [
  'apoc_prop_90', 'apoc_prop', 'apoc_prop_6', 'apoc_prop_12', 'apoc_prop_67',
  'apoc_prop_71', 'apoc_prop_36', 'apoc_prop_80', 'apoc_prop_79', 'apoc_prop_24',
  'apoc_prop_3', 'apoc_prop_65', 'apoc_prop_56', 'apoc_prop_73',
];

/** Only the debris comes from the registry; the cards are loaded here. */
export const VEGETATION_IDS = DEBRIS;

const FOREST_RADIUS = 190;
/** Nothing large inside this, so the tower and spawn stay legible. */
const CLEARING_RADIUS = 24;
/** Height of the overhead canopy, and how wide a hole the climb keeps in it. */
const CANOPY_Y = 30;
const CANOPY_CLEAR = 38;

const WIND_GLSL = /* glsl */ `
  // Sway grows with height up the plant, so trunks stay put and canopies move.
  // Two frequencies beaten against each other so the motion never reads as a
  // single sine, plus a per-instance phase from world position so a whole
  // forest does not breathe in unison.
  float phase = instWorld.x * 0.21 + instWorld.z * 0.17;
  float sway = sin(uTime * 0.9 + phase) * 0.6 + sin(uTime * 1.63 + phase * 1.7) * 0.4;
  float h = max(transformed.y, 0.0);
  transformed.x += sway * h * uWindStrength;
  transformed.z += sway * h * uWindStrength * 0.45;
`;

interface Scatter {
  pos: THREE.Vector3;
  scale: number;
  yaw: number;
  /** Lay the card horizontally, for the overhead canopy layer. */
  flat?: boolean;
}

export interface Vegetation {
  update(elapsed: number): void;
  instances: number;
  drawCalls: number;
}

function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Crossed planes, based at the origin.
 *
 * Spread over 180 degrees rather than 360: the planes are double-sided, so a
 * fourth quad at 270 degrees is the same surface as the one at 90 and buys
 * nothing but overdraw.
 */
function cardGeometry(size: number, planes: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < planes; i++) {
    const plane = new THREE.PlaneGeometry(size, size);
    plane.translate(0, size / 2, 0);
    plane.rotateY((i / planes) * Math.PI);
    parts.push(plane);
  }
  return mergeGeometries(parts) ?? parts[0];
}

function cardMaterial(
  map: THREE.Texture,
  uniforms: Record<string, THREE.IUniform>,
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    /*
     * Tint down, hard.
     *
     * The cutouts were generated under "flat even shadowless lighting" — asked
     * for deliberately, so no baked shadow would fight the scene's own sun.
     * The cost is that every leaf texture is high-key studio-bright, and that
     * brightness is in the albedo where no amount of lighting work can reach
     * it. A real canopy leaf reflects maybe 15% of what hits it; these are
     * painted at three or four times that.
     *
     * Multiplying down and pushing green also deepens the colour, which the
     * flat source lighting had drained.
     */
    color: new THREE.Color(0.5, 0.62, 0.42),
    // alphaTest rather than transparent: blended foliage needs back-to-front
    // sorting that instanced geometry cannot do, and gets it wrong in a way
    // that flickers as the camera turns. A hard cutout writes depth normally.
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.92,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uTime;\nuniform float uWindStrength;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec3 instWorld = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
         ${WIND_GLSL}`,
      );
  };
  mat.customProgramCacheKey = () => 'foliage-card-v1';
  return mat;
}

/**
 * Widen a quantized position attribute to plain floats before anything is baked
 * into it.
 *
 * The shipped models are meshopt-compressed, which stores positions as
 * normalized 16-bit integers spanning [-1, 1] with the real size carried in the
 * node's scale. `applyMatrix4` transforms those positions and writes them back
 * into the *same* 16-bit attribute, so any coordinate the scale pushed outside
 * [-1, 1] is clamped at the edge and the mesh is silently crushed towards a
 * plane. It is silent in the worst way: the geometry still loads, still draws,
 * still instances, and is simply the wrong shape.
 *
 * The debris this file uses happens to survive, because those props carry node
 * scales at or below 1 and never leave the representable range — which is luck,
 * not design, and it did not hold elsewhere. The identical pattern in
 * hub/landscape.ts flattened 14m pines to 1.3m against a node scale of 6.96,
 * and cost three rounds of debugging a scatter that was never the problem. One
 * conversion here means the next prop added to DEBRIS cannot inherit that.
 */
function widenPositions(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  if (pos.array instanceof Float32Array && !pos.normalized) return;
  const wide = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // getX/getY/getZ denormalize on the way out; the raw array does not.
    wide[i * 3] = pos.getX(i);
    wide[i * 3 + 1] = pos.getY(i);
    wide[i * 3 + 2] = pos.getZ(i);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(wide, 3));
}

/** Collect every mesh in a loaded template, base-anchored. */
function meshesOf(template: THREE.Object3D): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const out: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  template.updateMatrixWorld(true);
  template.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry.clone();
    widenPositions(geo);
    geo.applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox();
    const minY = geo.boundingBox?.min.y ?? 0;
    if (minY !== 0) geo.translate(0, -minY, 0);
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    out.push({ geo, mat });
  });
  return out;
}

/**
 * @param quality decides how much of this gets built. The counts below are the
 *   reference densities, tuned at `high`; every one of them is multiplied by
 *   `vegetationScale`, and the canopy ceiling and the rubble are dropped
 *   outright on the tier that cannot afford them.
 *
 *   Scaling the *scatter* rather than, say, the draw distance is what actually
 *   moves the frame here. None of this is expensive to submit — it is 24 draw
 *   calls whatever the count — and none of it is expensive in triangles; a card
 *   is four. The whole cost is overdraw: alpha-tested quads stacked between the
 *   camera and the thing behind them, each one shading every pixel it covers.
 *   Fewer cards is the only lever that touches that.
 */
export function createVegetation(
  scene: THREE.Scene,
  registry: AssetRegistry,
  level: Level,
  quality: QualitySettings,
): Vegetation {
  const rand = rngFrom(90210);
  const uniforms = { uTime: { value: 0 }, uWindStrength: { value: 0.012 } };
  const loader = new THREE.TextureLoader();
  const built: THREE.InstancedMesh[] = [];
  const dummy = new THREE.Object3D();

  const density = quality.vegetationScale;
  /**
   * Reference count scaled to this tier.
   *
   * Floored at one wherever the reference asked for anything at all: a species
   * that scales to zero instances is a species that vanishes from the world
   * entirely, and at 18% the low tier would have lost the vines completely
   * rather than thinned them.
   */
  const count = (reference: number): number =>
    reference > 0 ? Math.max(1, Math.round(reference * density)) : 0;

  const slabs = level.placements.filter((p) => p.id === 'box_stone');

  const canopySpots: Scatter[] = [];
  const treeSpots: Scatter[] = [];
  const midSpots: Scatter[] = [];
  const groundSpots: Scatter[] = [];
  const vineSpots: Scatter[] = [];
  const debrisSpots: Scatter[] = [];

  // Ground forest. sqrt keeps areal density even instead of clumping centrally.
  const ring = (n: number, inner: number, outer: number, lo: number, hi: number, into: Scatter[]) => {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = inner + Math.sqrt(rand()) * (outer - inner);
      into.push({
        pos: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
        scale: lo + rand() * (hi - lo),
        yaw: rand() * Math.PI * 2,
      });
    }
  };

  /*
   * The canopy layer: a ceiling of foliage at ~30m.
   *
   * This is the beat the design already called for and the world did not have —
   * below it the climb is enclosed, dappled and green; you break through it
   * around the Canopy band and the sky opens. Without it the player is never
   * *inside* the jungle, only standing next to one, and the sun has nothing to
   * break through.
   *
   * Kept outside the climb's own radius on purpose. Foliage cannot block a jump
   * physically — none of this has colliders — but a leaf card drawn across the
   * platform you are aiming at blocks it just as effectively. The column the
   * route occupies stays clear; the canopy closes everything around it.
   */
  //
  // Dropped whole on low rather than thinned. A canopy is a *ceiling*: at full
  // density it closes over the climb and the sky opens when you break through
  // it, and at a fifth of that it is a scattering of leaves hanging in mid-air
  // with daylight between them, which reads as broken rather than as sparse.
  // Better to have no ceiling than a holed one.
  if (quality.canopy) {
    for (let i = 0; i < count(900); i++) {
      const a = rand() * Math.PI * 2;
      const r = CANOPY_CLEAR + Math.sqrt(rand()) * (FOREST_RADIUS - CANOPY_CLEAR);
      canopySpots.push({
        pos: new THREE.Vector3(Math.cos(a) * r, CANOPY_Y + (rand() - 0.5) * 9, Math.sin(a) * r),
        scale: 2.2 + rand() * 2.6,
        yaw: rand() * Math.PI * 2,
        flat: true,
      });
    }
  }

  ring(count(1100), CLEARING_RADIUS, FOREST_RADIUS, 0.55, 1.15, treeSpots);
  ring(count(900), CLEARING_RADIUS - 6, FOREST_RADIUS, 0.6, 1.3, midSpots);
  ring(count(1800), 7, FOREST_RADIUS, 0.7, 1.5, groundSpots);
  if (quality.debris) ring(count(420), 8, 98, 0.7, 1.5, debrisSpots);

  // Growth and rubble on the ruin, sitting on the slab's top face but confined
  // to its outer margin. An earlier build hung these below the slab to honour
  // the readability rule literally and it looked broken — a 0.5m slab is far
  // thinner than a plant, so foliage floated with nothing holding it up. The
  // rule is about not lying over where the player can land, and knee-high
  // growth on the rim of a ledge does the opposite: it draws the edge.
  for (const p of slabs) {
    const [sx, sy, sz] = p.scale;
    const top = p.pos[1] + sy / 2;
    const yaw = p.rot[1];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const marginX = Math.max(0, sx / 2 - Math.min(0.5, sx * 0.15));
    const marginZ = Math.max(0, sz / 2 - Math.min(0.5, sz * 0.15));

    const place = (into: Scatter[], lo: number, hi: number, n: number, drop = 0): void => {
      for (let i = 0; i < n; i++) {
        const onX = rand() < 0.5;
        const lx = onX ? (rand() < 0.5 ? -marginX : marginX) : (rand() - 0.5) * sx * 0.9;
        const lz = onX ? (rand() - 0.5) * sz * 0.9 : rand() < 0.5 ? -marginZ : marginZ;
        into.push({
          pos: new THREE.Vector3(
            p.pos[0] + lx * c + lz * s,
            top - drop,
            p.pos[2] - lx * s + lz * c,
          ),
          scale: lo + rand() * (hi - lo),
          yaw: rand() * Math.PI * 2,
        });
      }
    };

    /*
     * Slab dressing thins by *skipping slabs*, not by placing fractional
     * plants.
     *
     * There are only ever one or two of each per foothold, so multiplying the
     * count by a density rounds to the same one or two at every tier and the
     * scale does nothing. Rolling against the density instead means low dresses
     * roughly a fifth of the footholds and leaves the rest bare — which is what
     * a fifth of the growth actually looks like.
     */
    const dress = (chance: number): boolean => rand() < chance * density;

    if (dress(1)) place(groundSpots, 0.2, 0.42, rand() < 0.5 ? 2 : 1);
    if (quality.debris && dress(1)) place(debrisSpots, 0.7, 1.4, rand() < 0.65 ? 2 : 1);
    // Vines hang from the underside, so their card is anchored at the slab
    // bottom and grows downward in texture space.
    if (dress(0.45)) place(vineSpots, 0.35, 0.8, 1, sy + 3.4);
  }

  // ---- build ------------------------------------------------------------

  const buildCards = (ids: string[], spots: Scatter[]): void => {
    if (!spots.length) return;
    ids.forEach((id, idx) => {
      const mine = spots.filter((_, i) => i % ids.length === idx);
      if (!mine.length) return;
      const spec = CARDS[id];
      const map = loader.load(`${FOLIAGE_DIR}/${id}.png`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = Math.min(8, quality.anisotropy);
      const inst = new THREE.InstancedMesh(
        cardGeometry(spec.size, spec.planes),
        cardMaterial(map, uniforms),
        mine.length,
      );
      // Only the trees ask to cast, and only above the smallest shadow map.
      // A 24m tree card rendered into 512 texels stretched over the frustum is
      // a shadow with visible stair-stepping the width of the player, which is
      // worse than the tree having no shadow at all.
      inst.castShadow = (spec.castShadow ?? false) && quality.shadowMapSize >= 1024;
      inst.receiveShadow = true;
      mine.forEach((sp, i) => {
        dummy.position.copy(sp.pos);
        if (sp.flat) {
          // Laid flat and pivoted at its middle rather than its base — a canopy
          // card hangs in the air, it does not stand on anything.
          dummy.rotation.set(-Math.PI / 2, 0, sp.yaw);
          dummy.position.y -= (spec.size / 2) * sp.scale;
        } else {
          dummy.position.y -= (spec.sink ?? 0) * sp.scale;
          dummy.rotation.set(0, sp.yaw, 0);
        }
        dummy.scale.setScalar(sp.scale);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.matrixAutoUpdate = false;
      inst.updateMatrix();
      scene.add(inst);
      built.push(inst);
    });
  };

  const buildProps = (ids: string[], spots: Scatter[]): void => {
    ids.forEach((id, idx) => {
      const asset = registry.get(id);
      const mine = spots.filter((_, i) => i % ids.length === idx);
      if (!asset || !mine.length) return;
      for (const { geo, mat } of meshesOf(asset.template)) {
        // No wind on rubble. Sway in a lump of concrete is the kind of detail
        // that reads as "everything here is made of paper".
        const inst = new THREE.InstancedMesh(geo, (mat as THREE.Material).clone(), mine.length);
        inst.castShadow = true;
        inst.receiveShadow = true;
        mine.forEach((sp, i) => {
          dummy.position.copy(sp.pos);
          dummy.rotation.set(0, sp.yaw, 0);
          dummy.scale.setScalar(sp.scale);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.matrixAutoUpdate = false;
        inst.updateMatrix();
        scene.add(inst);
        built.push(inst);
      }
    });
  };

  buildCards(CANOPY_LAYER, canopySpots);
  buildCards(TREES, treeSpots);
  buildCards(MIDSTORY, midSpots);
  buildCards(UNDERGROWTH, groundSpots);
  buildCards(VINES, vineSpots);
  buildProps(DEBRIS, debrisSpots);

  return {
    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
    instances:
      treeSpots.length + midSpots.length + groundSpots.length + vineSpots.length + debrisSpots.length,
    drawCalls: built.length,
  };
}
