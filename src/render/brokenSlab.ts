import * as THREE from 'three';

/**
 * Broken-edged slab geometry, to replace the box the player actually stands on.
 *
 * The structural layer is box primitives because a cuboid collider matches its
 * visual exactly — what you see is what you stand on, which a trimesh can never
 * promise. That is the right call for gameplay and it is also why 262 footholds
 * read as a stack of rectangles.
 *
 * This keeps the collider and replaces only the *silhouette*. The top face
 * becomes an irregular polygon instead of a rectangle, extruded down to a
 * differently-irregular bottom, so no two slabs share an outline and none of
 * them has four straight edges.
 *
 * ---------------------------------------------------------------------------
 * The one rule that matters: the visual never exceeds the collider.
 *
 * Jitter is inward-only. If the visible edge extended past the cuboid the
 * player would fall through something that looks solid, which is the worst
 * failure a platformer can have. Inward-only means the reverse — a few
 * centimetres beyond the visible edge are still standable — and that error
 * reads as the game being generous rather than broken.
 * ---------------------------------------------------------------------------
 *
 * Geometry is pooled rather than generated per placement. A handful of variants
 * picked by placement id gives the variety without 262 unique buffers, and they
 * are unit-sized so the same variant serves a 1.5m foothold and a 13m terrace.
 */

/** How many distinct outlines exist. Enough that repeats are not noticeable. */
const VARIANTS = 12;
/** Perimeter samples. More is rounder; this is a ruin, not a circle. */
const SEGMENTS = 22;
/** Deepest bite out of an edge, as a fraction of the half-width. */
const MAX_BITE = 0.16;

function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Walk the perimeter of a unit square, returning points in order.
 * `t` runs 0..1 around the edge.
 */
function squarePerimeter(t: number): [number, number] {
  const u = (t % 1) * 4;
  if (u < 1) return [-0.5 + u, -0.5];
  if (u < 2) return [0.5, -0.5 + (u - 1)];
  if (u < 3) return [0.5 - (u - 2), 0.5];
  return [-0.5, 0.5 - (u - 3)];
}

function buildVariant(seed: number): THREE.BufferGeometry {
  const rand = rngFrom(seed);

  // Two independent outlines, so the slab is not a prism of one shape — the
  // bottom of a broken slab has spalled differently from the top.
  const outline = (bias: number): [number, number][] => {
    const pts: [number, number][] = [];
    // A few "bite" centres per outline: erosion is clustered, not uniform, and
    // evenly jittered edges read as noise rather than as damage.
    const bites = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => ({
      at: rand(),
      width: 0.06 + rand() * 0.13,
      depth: (0.35 + rand() * 0.65) * MAX_BITE * bias,
    }));
    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const [x, z] = squarePerimeter(t);
      let inset = 0.012 + rand() * 0.02; // constant nibble, so no edge is straight
      for (const b of bites) {
        // Wrap-aware distance around the perimeter.
        let d = Math.abs(t - b.at);
        d = Math.min(d, 1 - d);
        if (d < b.width) {
          const f = 1 - d / b.width;
          inset += b.depth * f * f * (3 - 2 * f); // smoothstep, no hard corners
        }
      }
      inset = Math.min(inset, MAX_BITE);
      // Pull towards the centre. Inward only — see the header.
      pts.push([x * (1 - inset * 2), z * (1 - inset * 2)]);
    }
    return pts;
  };

  const top = outline(1);
  const bottom = outline(0.7);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    // World-space-ish UVs; the ruin material is triplanar and ignores these,
    // but leaving them undefined breaks anything that samples a map.
    uvs.push(x + 0.5, z + 0.5);
    return positions.length / 3 - 1;
  };

  // Top face, as a fan from the centre.
  //
  // Wound (centre, i+1, i), not (centre, i, i+1). squarePerimeter walks the
  // outline in the direction that makes the latter face *downwards*: the cross
  // product of two consecutive spokes comes out -Y. Declaring the vertex normal
  // as +Y does not save it, because backface culling uses winding, not the
  // normal attribute — so the top of every slab was culled and what showed
  // through was the underside, which faces the dark ground hemisphere and
  // rendered black.
  const topCentre = push(0, 0.5, 0, 0, 1, 0);
  const topRing = top.map(([x, z]) => push(x, 0.5, z, 0, 1, 0));
  for (let i = 0; i < SEGMENTS; i++) {
    indices.push(topCentre, topRing[(i + 1) % SEGMENTS], topRing[i]);
  }

  // Bottom face, wound the other way for the same reason.
  const botCentre = push(0, -0.5, 0, 0, -1, 0);
  const botRing = bottom.map(([x, z]) => push(x, -0.5, z, 0, -1, 0));
  for (let i = 0; i < SEGMENTS; i++) {
    indices.push(botCentre, botRing[i], botRing[(i + 1) % SEGMENTS]);
  }

  // Sides. Each quad gets its own vertices so the edge stays sharp instead of
  // smoothing into the top face.
  for (let i = 0; i < SEGMENTS; i++) {
    const j = (i + 1) % SEGMENTS;
    const [ax, az] = top[i];
    const [bx, bz] = top[j];
    const [cx, cz] = bottom[j];
    const [dx, dz] = bottom[i];
    // Outward normal for an edge walked in this direction, and a winding that
    // agrees with it. Both were inverted: on the front edge the old formula
    // produced +Z where outward is -Z, so every side faced into the slab.
    const nx = (bz - az) || 0;
    const nz = (ax - bx) || 0;
    const len = Math.hypot(nx, nz) || 1;
    const a = push(ax, 0.5, az, nx / len, 0, nz / len);
    const b = push(bx, 0.5, bz, nx / len, 0, nz / len);
    const c = push(cx, -0.5, cz, nx / len, 0, nz / len);
    const d = push(dx, -0.5, dz, nx / len, 0, nz / len);
    indices.push(a, b, c, a, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

let pool: THREE.BufferGeometry[] | null = null;

/** The shared pool, built once on first use. */
export function brokenSlabPool(): THREE.BufferGeometry[] {
  if (!pool) pool = Array.from({ length: VARIANTS }, (_, i) => buildVariant(9871 + i * 7919));
  return pool;
}

/**
 * Pick a variant deterministically from a placement id, so a level looks the
 * same on every load and in every client of a shared world.
 */
export function brokenSlabFor(uid: string): THREE.BufferGeometry {
  const variants = brokenSlabPool();
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return variants[Math.abs(h) % variants.length];
}
