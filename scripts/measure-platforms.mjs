#!/usr/bin/env node
/**
 * Measure every asset in the manifest for use as a platform.
 *
 * Placing a prop as something the player lands on needs two numbers the level
 * format does not hold: how high its top surface is, and whether that surface
 * is big and flat enough to stand on. The collider is a trimesh — the mesh
 * itself — so both are questions about the actual triangles, not the bounding
 * box: the box around a street lamp says "4 metres tall", and standing on it
 * means balancing on the bulb.
 *
 * So: rasterise each mesh from above into a height field, and look for a
 * plateau. `standSquare` is the side of the largest square at the top surface,
 * in metres at scale 1 — compare it against the player capsule (0.8m wide) to
 * decide whether an asset can carry a jump, and multiply by placement scale.
 *
 *   node scripts/measure-platforms.mjs [out.json]
 *
 * Numbers are per unit scale, so they hold for any placement of the asset.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = resolve('.');
const OUT = process.argv[2] ?? 'asset-metrics.json';

/** Grid resolution across the footprint. 32x32 is ~1000 point-in-triangle tests per triangle-bbox. */
const GRID = 32;
/** A cell counts as "top surface" if it is within this of the highest point. */
const FLAT_TOL = 0.12;
/** The player capsule is 0.8m wide; a landing needs a bit more than that. */
const MIN_STAND = 1.0;

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8'));

/** World-space triangles of the whole scene, as flat [ax,ay,az, bx,by,bz, cx,cy,cz]. */
function triangles(doc) {
  const out = [];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const visit = (node, parent) => {
    const m = mul(parent, node.getWorldMatrix ? node.getWorldMatrix() : node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const idx = prim.getIndices();
        const count = idx ? idx.getCount() : pos.getCount();
        const p = [0, 0, 0];
        for (let i = 0; i + 2 < count; i += 3) {
          const tri = [];
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getScalar(i + k) : i + k;
            pos.getElement(vi, p);
            tri.push(...apply(m, p));
          }
          out.push(tri);
        }
      }
    }
    for (const child of node.listChildren()) visit(child, m);
  };
  for (const node of scene.listChildren()) visit(node, identity());
  return out;
}

// Column-major 4x4, matching glTF.
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function apply(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Largest axis-aligned square of true cells, in cells. Standard DP: each cell
 * holds the size of the biggest square ending there.
 */
function maximalSquare(grid, w, h) {
  const dp = new Int32Array(w * h);
  let best = 0;
  let corner = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!grid[j * w + i]) continue;
      dp[j * w + i] =
        i === 0 || j === 0
          ? 1
          : 1 + Math.min(dp[(j - 1) * w + i], dp[j * w + i - 1], dp[(j - 1) * w + i - 1]);
      if (dp[j * w + i] > best) {
        best = dp[j * w + i];
        corner = j * w + i; // bottom-right cell of the winning square
      }
    }
  }
  return { size: best, i: (corner % w) - (best - 1) / 2, j: Math.floor(corner / w) - (best - 1) / 2 };
}

function measure(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (let k = 0; k < 9; k += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], t[k + a]);
        max[a] = Math.max(max[a], t[k + a]);
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;

  const w = max[0] - min[0];
  const d = max[2] - min[2];
  const cellX = w / GRID;
  const cellZ = d / GRID;
  // Height field: the highest surface over each cell centre, seen from above.
  const height = new Float64Array(GRID * GRID).fill(-Infinity);

  for (const t of tris) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - min[0]) / cellX) - 1);
    const i1 = Math.min(GRID - 1, Math.ceil((Math.max(ax, bx, cx) - min[0]) / cellX));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - min[2]) / cellZ) - 1);
    const j1 = Math.min(GRID - 1, Math.ceil((Math.max(az, bz, cz) - min[2]) / cellZ));
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue; // edge-on triangle: contributes no surface
    for (let j = j0; j <= j1; j++) {
      const pz = min[2] + (j + 0.5) * cellZ;
      for (let i = i0; i <= i1; i++) {
        const px = min[0] + (i + 0.5) * cellX;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        if (y > height[j * GRID + i]) height[j * GRID + i] = y;
      }
    }
  }

  const covered = [...height].filter((v) => Number.isFinite(v));
  const topY = max[1];
  const flat = new Uint8Array(GRID * GRID);
  for (let n = 0; n < height.length; n++) flat[n] = height[n] >= topY - FLAT_TOL ? 1 : 0;
  const square = maximalSquare(flat, GRID, GRID);

  return {
    size: [r(w), r(max[1] - min[1]), r(d)],
    min: min.map(r),
    max: max.map(r),
    triangles: tris.length,
    /** Fraction of the footprint that is solid when seen from above. */
    coverage: r(covered.length / (GRID * GRID)),
    /** Fraction of the footprint sitting at the very top. */
    topFraction: r(flat.reduce((n, v) => n + v, 0) / (GRID * GRID)),
    /** Side of the biggest square plateau at the top, in metres, at scale 1. */
    standSquare: r(Math.min(square.size * cellX, square.size * cellZ)),
    /**
     * Where that plateau is, in the asset's own coordinates — almost no model
     * is centred on its origin, so this is what a placement has to be offset by
     * to put the landing spot where the level wants it.
     */
    standCentre: [r(min[0] + (square.i + 0.5) * cellX), r(topY), r(min[2] + (square.j + 0.5) * cellZ)],
  };
}

const r = (v) => Math.round(v * 1000) / 1000;

const results = {};
let done = 0;
for (const entry of manifest.entries) {
  if (entry.asset.kind !== 'gltf') {
    results[entry.id] = { kind: 'primitive' };
    continue;
  }
  const file = resolve(ROOT, 'public', entry.asset.url.replace(/^\//, ''));
  try {
    const doc = await io.read(file);
    const m = measure(triangles(doc));
    results[entry.id] = m ? { kind: 'gltf', tags: entry.tags ?? [], ...m } : { kind: 'gltf', error: 'no geometry' };
  } catch (e) {
    results[entry.id] = { kind: 'gltf', error: String(e.message ?? e).slice(0, 120) };
  }
  if (++done % 40 === 0) console.error(`  ${done}/${manifest.entries.length}`);
}

writeFileSync(OUT, JSON.stringify(results, null, 1));

const ok = Object.entries(results).filter(([, m]) => m.standSquare >= MIN_STAND);
console.log(`scanned ${done} assets -> ${OUT}`);
console.log(`${ok.length} have a plateau of at least ${MIN_STAND}m at scale 1`);
console.log(`${Object.values(results).filter((m) => m.error).length} failed to read`);
