import * as THREE from 'three';
import type { AssetRegistry } from '../world/registry';
import type { QualitySettings } from '../render/quality';

/**
 * What the villa looks out over.
 *
 * A single displaced plane, coloured per vertex and drawn once. It is scenery in
 * the strictest sense — no collider, never touched after it is built, and the
 * player can never reach any of it.
 *
 * Shaped as a bowl rather than a field: the villa stands on a flat clifftop,
 * the ground falls away around it, and the far rim climbs into peaks. That
 * shape is doing a specific job. A view is not a picture of mountains, it is
 * the drop between you and them — without the cliff the terrace reads as a
 * patio in a field, and no amount of detail on the mountains fixes that.
 *
 * Vertex colours rather than a texture: the whole range is three bands (grass,
 * rock, snow) chosen by height, which is one line of code and no image to load,
 * and at this distance nothing finer would survive the haze anyway.
 */

/** Radius of the flat ground the villa stands on. */
export const PLATEAU_RADIUS = 34;
/** Where the cliff has finished falling and the valley begins. */
const VALLEY_RADIUS = 78;
/**
 * Where the mountains start, and where they reach full height.
 *
 * Both far larger than they look like they need to be, and that is the point. A
 * range that begins just past the valley is not a view, it is a wall: from a
 * terrace fifteen metres up, a two-hundred-metre peak a hundred and fifty
 * metres away fills sixty degrees of the frame. Pushed out to a third of a
 * kilometre the same peak subtends about twenty, which is what a mountain
 * actually looks like from a house.
 */
const RANGE_START = 340;
const RANGE_FULL = 820;
/** Height of the valley floor relative to the villa. */
const VALLEY_Y = -62;
/** How far out the terrain is drawn. */
const EXTENT = 1700;
const SEGMENTS = 140;

function makeNoise(seed: number): (x: number, y: number) => number {
  const hash = (x: number, y: number): number => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453123;
    return s - Math.floor(s);
  };
  return (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return (
      hash(ix, iy) * (1 - u) * (1 - v) +
      hash(ix + 1, iy) * u * (1 - v) +
      hash(ix, iy + 1) * (1 - u) * v +
      hash(ix + 1, iy + 1) * u * v
    );
  };
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Trees, biggest first.
 *
 * All from the same low-poly pack, and all absurdly cheap — 8 to 16 triangles
 * each, because they are crossed billboards with a trunk rather than modelled
 * canopies. That is what makes planting hundreds of them affordable: the entire
 * forest is one instanced draw call per species and about six thousand
 * triangles, which is a seventh of what the villa's furniture costs.
 *
 * Pines dominate deliberately. A conifer silhouette is what reads as *altitude*
 * on a hillside — broadleaf trees on a mountainside read as parkland — and the
 * two rounder species are here to break up the skyline, not to share it.
 */
const TREE_SPECIES = [
  { id: 'trees_and_bush_pack_pine1', weight: 4, tall: true },
  { id: 'trees_and_bush_pack_pine2', weight: 4, tall: true },
  { id: 'trees_and_bush_pack_tree2', weight: 2, tall: false },
  { id: 'trees_and_bush_pack_tree_small', weight: 3, tall: false },
] as const;

/** Everything the landscape wants loaded before it can be planted. */
export const LANDSCAPE_ASSET_IDS = TREE_SPECIES.map((t) => t.id);

/**
 * Above this the ground is rock and snow, and nothing grows.
 *
 * A real treeline is not a straight contour, so this one is not either — the
 * scatter jitters it per tree. A hard line at a fixed height across a whole
 * range looks like the mountains were dipped in something.
 */
const TREELINE_Y = 120;
/**
 * Steepest ground a tree will stand on, as a gradient (rise over run).
 *
 * Trees are placed upright, and the cliff below the villa drops sixty metres
 * over forty — so without this the face would be studded with pines growing
 * sideways out of it, half their trunks buried and half hanging in the air. On
 * ground this steep real trees do not grow either, so refusing the placement is
 * both the cheap fix and the correct one.
 */
const MAX_TREE_SLOPE = 0.85;

export interface Landscape {
  mesh: THREE.Mesh;
  /**
   * Scatter trees over everything the terrain has made.
   *
   * Separate from building the terrain because it needs the asset registry,
   * which the room resolves, and because the count is the tier's decision. The
   * terrain is the same at every tier; how much grows on it is not.
   */
  plant(registry: AssetRegistry, quality: QualitySettings): void;
}

export function createLandscape(scene: THREE.Scene): Landscape {
  const noise = makeNoise(0);
  const ridgeNoise = makeNoise(97.3);

  const fbm = (x: number, z: number, scale: number, octaves: number): number => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = scale;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * f, z * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };

  /**
   * Ridged noise, for the peaks.
   *
   * Plain fbm gives rolling hills — fine for the valley floor and wrong for a
   * skyline, because hills have no silhouette. Folding the noise about its
   * midpoint and squaring the result produces creases instead of bumps, which
   * is what makes a mountain read as a mountain from ten kilometres away.
   */
  const ridged = (x: number, z: number, scale: number): number => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = scale;
    for (let i = 0; i < 4; i++) {
      const n = 1 - Math.abs(ridgeNoise(x * f, z * f) * 2 - 1);
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.11;
    }
    return sum / norm;
  };

  const height = (x: number, z: number): number => {
    const r = Math.hypot(x, z);

    // The clifftop the villa stands on. Flat, and a shade below the terrace
    // floor so the floor is what you see rather than z-fighting against it.
    if (r <= PLATEAU_RADIUS) return -1.2;

    // The drop. Eased at both ends so the terrace does not sit on a spike and
    // the valley does not start with a crease.
    const fall = smoothstep(PLATEAU_RADIUS, VALLEY_RADIUS, r);
    let y = -1.2 + fall * (VALLEY_Y + 1.2);

    // Broken rock down the cliff face, so it is not a smooth funnel.
    y += Math.sin(r * 0.35) * 2.4 * fall * (1 - fall) * 4;
    y += (fbm(x, z, 0.06, 3) - 0.5) * 9 * fall;

    // Rolling ground across the valley floor, so the middle distance is not a
    // flat green disc between the cliff and the peaks.
    const open = smoothstep(VALLEY_RADIUS, RANGE_START, r);
    y += open * (fbm(x, z, 0.008, 3) - 0.5) * 26;

    // The range itself, well out past the valley.
    const range = smoothstep(RANGE_START, RANGE_FULL, r);
    if (range > 0) {
      const peaks = ridged(x, z, 0.0026) * 210 + fbm(x, z, 0.0018, 4) * 80;
      y += range * peaks;
      // A second, taller line further back, for depth.
      const far = smoothstep(RANGE_FULL * 0.8, EXTENT * 0.7, r);
      y += far * ridged(x + 900, z - 400, 0.0015) * 190;
    }
    return y;
  };

  const geo = new THREE.PlaneGeometry(EXTENT, EXTENT, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colours = new Float32Array(pos.count * 3);

  /*
   * Darker than they look like they should be on a colour picker.
   *
   * This terrain is lit by an open sky with no canopy over it, so it takes the
   * full sun plus an environment term plus a hemisphere fill. At picker-bright
   * values the range came out lighter than the sky behind it, which reads as
   * haze rather than as mountains — a hillside is always darker than the sky it
   * is silhouetted against.
   */
  const grass = new THREE.Color(0x22301a);
  /**
   * Wooded slope, between the valley grass and the bare rock above it.
   *
   * This band is what actually puts a forest on the mountains, and no amount of
   * instanced trees could have. The range runs from 340m out to 820m, which is
   * an annulus of one and three quarter square kilometres: even a thousand trees
   * scattered over it is one per eighty metres, and each is a couple of pixels
   * tall at that distance. Planted, they read as dust on the screen; the
   * hillside behind them stays grey and bare.
   *
   * What reads as forest from a kilometre away is *colour* — a dark, slightly
   * blue-green mass below the rock line, with the rock breaking through it. So
   * the trees are planted where a tree is a recognisable object, and the range
   * gets a band instead. It costs nothing: it is three numbers in a lerp that
   * was already running per vertex.
   */
  const forest = new THREE.Color(0x243524);
  const rock = new THREE.Color(0x3c3a32);
  const snow = new THREE.Color(0xc8d2dc);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = height(x, z);
    pos.setY(i, y);

    /*
     * Bands by height, blended so there is no contour line around every peak.
     *
     * The thresholds have to match the terrain that was actually generated, not
     * a guess at it. Set for a range topping out around 200 they painted a
     * range topping out around 400 entirely in snow, and the whole view came
     * back as a white smear — mountains have to be mostly rock, with caps, or
     * they read as fog with edges.
     */
    // Four bands now, not three, and the new one is the widest: grass on the
    // valley floor, forest up the lower slopes, bare rock above the treeline,
    // snow on the caps. The rock threshold used to sit at 40m, which put every
    // metre of mountain above the valley into grey — the range was bare from
    // its foot, which is why it read as a quarry rather than as a landscape.
    const toForest = smoothstep(-58, -6, y);
    const toRock = smoothstep(TREELINE_Y - 40, TREELINE_Y + 55, y);
    const toSnow = smoothstep(205, 330, y);
    tmp.copy(grass).lerp(forest, toForest).lerp(rock, toRock).lerp(snow, toSnow);
    // A little variation so the bands are not flat fills.
    const tint = 0.9 + fbm(x, z, 0.02, 2) * 0.2;
    colours[i * 3] = tmp.r * tint;
    colours[i * 3 + 1] = tmp.g * tint;
    colours[i * 3 + 2] = tmp.b * tint;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
  );
  // Never culled and never shadowed: it is the backdrop, and asking a 1.7km
  // plane to take part in a shadow map aimed at a terrace costs a lot to
  // achieve nothing.
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    mesh,
    plant(registry, quality) {
      plantTrees(scene, registry, quality.hubTrees, height);
    },
  };
}

/**
 * Put trees on the hillsides.
 *
 * The view was terrain and nothing else, and that is what made it read as a
 * *render* of a landscape rather than a landscape: three colour bands on smooth
 * displaced ground, with no object anywhere in it to judge the scale of any of
 * it against. A hill with trees on it is unmistakably a hill the size of a hill.
 * A hill without them could be a hill or a pile of gravel two metres away.
 *
 * Which is also why the near ones matter most, and why the scatter is weighted
 * towards the clifftop and the valley rather than spread evenly to the horizon:
 * a tree at nine hundred metres is two pixels of silhouette, and a hundred of
 * them cost the same as a hundred you can actually see.
 */
function plantTrees(
  scene: THREE.Scene,
  registry: AssetRegistry,
  total: number,
  heightAt: (x: number, z: number) => number,
): void {
  if (total <= 0) return;

  let seed = 4242;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  /** Where each tree goes, bucketed by species so each is one instanced mesh. */
  const spots: { pos: THREE.Vector3; scale: number; yaw: number }[][] =
    TREE_SPECIES.map(() => []);

  /*
   * Two bands, and a hard rule about what is worth planting.
   *
   * Where the trees go was decided by working out what is actually in frame,
   * and it is not what a map of the terrain suggests. The player stands 2.6m
   * above a terrace ringed by a solid 1.1m balustrade 19m away, and the valley
   * floor is 62m *below* that terrace. The sight line grazing the top of the
   * rail is already 19m under the clifftop by the time it is 340m out and 50m
   * under it at 820m — so the entire valley floor, the whole cliff face, and
   * the lower half of the near range are hidden behind the railing the player
   * is leaning on. There is no camera position in the hub that sees any of it.
   *
   * Successive versions of this planted 46%, then 76%, of the forest down
   * there. Every tree was correctly placed on correctly generated ground and
   * not one of them was ever drawn to screen. So `visible()` below is not an
   * optimisation, it is the placement rule: sample the whole landscape and keep
   * only what clears the rail.
   *
   * `tall` restricts the far band to the two pines. At 400m a 14m pine is about
   * fifty pixels of silhouette and reads as a tree; the 3.6m species is nine
   * pixels and reads as dirt on the lens. Mixing them at distance does not make
   * the forest varied, it makes a third of it noise.
   */
  const EYE_Y = 2.6;
  const RAIL_Y = 1.1;
  const RAIL_R = 19;
  /** Lowest point still visible past the balustrade at a given distance out. */
  const horizonAt = (r: number): number => EYE_Y + ((RAIL_Y - EYE_Y) / RAIL_R) * r;

  const bands: {
    /** Fraction of the tier's budget this band gets. */
    share: number;
    inner: number;
    outer: number;
    scale: [number, number];
    tall?: boolean;
    /** Skip anything below the rail's horizon. */
    mustClearRail?: boolean;
    /** Keep out of the cone the terrace looks down. */
    clearViewCone?: boolean;
  }[] = [
    /*
     * The clifftop, in the ring of flat ground between the terrace's furthest
     * corner (29m out) and the lip where the drop begins. Seen over the rail at
     * full height and close enough to be judged against the player, so this is
     * the only band at true scale and the only one with small trees in it.
     *
     * Also the only band that has to stay out of the way. A pine is fourteen
     * metres and this ring is thirty out, so each one covers twenty degrees of
     * frame — a full ring of them is a fence, and the villa exists to look at
     * the mountains. They go in the side and rear sectors, where they frame the
     * view and give the terrace something taller than a lamp beside it.
     */
    { share: 0.18, inner: 30, outer: PLATEAU_RADIUS, scale: [0.35, 0.7], clearViewCone: true },
    // Everything beyond, out to the far range. One band rather than three,
    // because the rail decides where they land far better than a radius does.
    {
      share: 0.82,
      inner: PLATEAU_RADIUS + 10,
      outer: RANGE_FULL,
      scale: [0.9, 1.8],
      tall: true,
      mustClearRail: true,
    },
  ];

  for (const band of bands) {
    const pool = TREE_SPECIES.map((s, i) => ({ i, weight: band.tall && !s.tall ? 0 : s.weight }));
    const weightTotal = pool.reduce((sum, s) => sum + s.weight, 0);
    const target = Math.round(total * band.share);
    // Most of the far band's samples land on ground the rail hides or on slopes
    // too steep to stand on, so it samples until it has placed what it was
    // asked for. The cap is what stops a landscape with nowhere valid on it
    // from spinning forever.
    const attempts = band.mustClearRail || band.clearViewCone ? target * 25 : target;
    let placed = 0;

    for (let i = 0; i < attempts && placed < target; i++) {
      const a = rand() * Math.PI * 2;
      // sqrt keeps the density per unit area even rather than clumping at the
      // inner edge of the ring.
      const r = band.inner + Math.sqrt(rand()) * (band.outer - band.inner);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = heightAt(x, z);

      // The terrace looks down +z. Anything inside 55 degrees of that axis is
      // standing in the view rather than beside it.
      if (band.clearViewCone && z > 0 && Math.abs(x) < z * 1.43) continue;

      // Nothing the player cannot see, and nothing barely clearing the rail
      // either — a tree half-sunk behind the balustrade is a green smear along
      // the top of it.
      if (band.mustClearRail && y < horizonAt(r) + 6) continue;

      // Nothing above the treeline. The jitter is what keeps that line from
      // being a contour drawn round every peak at exactly the same height.
      if (y > TREELINE_Y + (rand() - 0.5) * 34) continue;

      // Central differences over a few metres — far enough to read the slope of
      // the hillside rather than the noise on top of it.
      const d = 4;
      const slope = Math.hypot(
        heightAt(x + d, z) - heightAt(x - d, z),
        heightAt(x, z + d) - heightAt(x, z - d),
      ) / (2 * d);
      if (slope > MAX_TREE_SLOPE) continue;

      const roll = rand() * weightTotal;
      let pick = pool[0].i;
      let acc = 0;
      for (const species of pool) {
        acc += species.weight;
        if (roll < acc) {
          pick = species.i;
          break;
        }
      }

      // Bigger the further out, so a tree stays a readable object rather than
      // fading into a speck. Not cheating so much as the trick every matte
      // painting uses — nothing in the view is near enough to compare against.
      const far = Math.min(1, Math.max(0, (r - 200) / 500));
      const size = band.scale[0] + rand() * (band.scale[1] - band.scale[0]);

      spots[pick].push({
        pos: new THREE.Vector3(x, y, z),
        scale: size * (1 + far * 0.6),
        yaw: rand() * Math.PI * 2,
      });
      placed++;
    }
  }

  /*
   * Build, without touching a single vertex.
   *
   * The obvious way to instance part of a loaded model is to clone its geometry,
   * bake the node's world matrix into it so the mesh stands at the origin the
   * right way up, and then let the instance matrix do only placement. That is
   * what this did, and on these models it silently destroys them.
   *
   * The shipped assets are meshopt-compressed: their POSITION attribute is
   * normalized 16-bit integers spanning [-1, 1], and the real size lives in the
   * node's scale — 6.96 for a pine. `BufferGeometry.applyMatrix4` writes the
   * transformed positions straight back into that same 16-bit attribute, so
   * every coordinate that scaling pushed outside [-1, 1] is clamped at the
   * edge. A 13.9m pine came out 1.3m tall and slightly crushed, which on a
   * mountainside 700m away is indistinguishable from "the trees did not load" —
   * and is why three passes at rebalancing the scatter changed nothing.
   *
   * So the node transform goes into the *instance* matrix instead, composed on
   * the right of the placement. The geometry is used exactly as it was decoded,
   * shared with the template rather than cloned, and nothing is quantized twice.
   */
  const placement = new THREE.Object3D();
  const model = new THREE.Matrix4();
  const instanceMatrix = new THREE.Matrix4();
  const toBase = new THREE.Matrix4();

  TREE_SPECIES.forEach((species, index) => {
    const mine = spots[index];
    const asset = registry.get(species.id);
    // A missing model is skipped rather than thrown. The hub opening matters
    // more than any one species in the view, and the other three still plant.
    if (!asset || mine.length === 0) return;

    asset.template.updateMatrixWorld(true);
    // Models arrive with their own idea of where zero is; lift the whole model
    // so its lowest point sits on the ground rather than through it. Taken from
    // the registry's own bounds, which are measured with Box3.setFromObject and
    // so read the quantized attribute correctly.
    toBase.makeTranslation(0, -asset.bbox.min.y, 0);

    asset.template.traverse((o) => {
      const source = o as THREE.Mesh;
      if (!source.isMesh || !source.geometry) return;

      const material = (
        Array.isArray(source.material) ? source.material[0] : source.material
      ) as THREE.Material;

      const inst = new THREE.InstancedMesh(source.geometry, material, mine.length);
      // Backdrop, like the terrain under it: the shadow frustum is 44 units
      // across and centred on the player, so nothing out here would ever land
      // in it anyway, and asking would still cost a pass over every instance.
      inst.castShadow = false;
      inst.receiveShadow = false;
      mine.forEach((spot, i) => {
        placement.position.copy(spot.pos);
        placement.rotation.set(0, spot.yaw, 0);
        placement.scale.setScalar(spot.scale);
        placement.updateMatrix();
        model.multiplyMatrices(placement.matrix, toBase);
        instanceMatrix.multiplyMatrices(model, source.matrixWorld);
        inst.setMatrixAt(i, instanceMatrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.matrixAutoUpdate = false;
      inst.updateMatrix();
      scene.add(inst);
    });
  });
}
