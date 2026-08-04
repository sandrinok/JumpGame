import * as THREE from 'three';

/**
 * Cut a shirt out of the body it is worn on.
 *
 * The first version of this painted the shirt into the body's own shader: a
 * mask over the bind-pose position, blended into the skin colour. That works
 * and costs nothing, but it is paint. There is no edge — a hem is a gradient
 * between two colours, so it fringes purple where tan meets blue — and there is
 * no silhouette, so a sleeve never stands away from the arm inside it.
 *
 * This builds an actual garment instead, and the reason it is affordable is
 * that the hard part was already solved. The body is one skinned mesh, so every
 * vertex already carries the bone indices and weights that move it. Copying the
 * triangles the shirt covers, pushing them out along their normals and handing
 * them the same skeleton produces a mesh that deforms in exact lockstep with
 * the body underneath, for free and for ever — no cloth simulation, no second
 * rig, nothing per frame.
 *
 * The shirt is cut rather than merely filtered. Keeping whole triangles would
 * leave a hem that zigzags along whichever edges happened to fall near the
 * line, so each triangle is clipped against the four planes that bound the
 * garment and re-triangulated.
 */

export interface ShirtCut {
  /** Lowest bind-pose Y the shirt reaches. The hem. */
  hem: number;
  /** Highest bind-pose Y. The collar. */
  collar: number;
  /** Furthest |x| along the outstretched arms. The sleeve end. */
  sleeve: number;
}

/** How far the garment stands off the skin, in bind-pose units (~1cm). */
const OFFSET = 0.012;

/**
 * One vertex mid-clip, as flat numbers rather than Vector3s.
 *
 * Unlovely, and the reason is measurement: the first version built three
 * objects per triangle — two vectors and two arrays each — before testing
 * whether the triangle was anywhere near the shirt, and around six triangles in
 * seven are not. At 14,000 triangles that came to 26ms a rebuild, which is
 * more than a frame, doubled because both the preview and the player in the
 * world are dressed. These are pooled and reused; nothing here allocates.
 */
interface Vertex {
  px: number; py: number; pz: number;
  nx: number; ny: number; nz: number;
  u: number; v: number;
  /** Bone indices and weights, taken whole rather than blended. See copyEdge. */
  si0: number; si1: number; si2: number; si3: number;
  sw0: number; sw1: number; sw2: number; sw3: number;
}

function blankVertex(): Vertex {
  return {
    px: 0, py: 0, pz: 0,
    nx: 0, ny: 0, nz: 0,
    u: 0, v: 0,
    si0: 0, si1: 0, si2: 0, si3: 0,
    sw0: 0, sw1: 0, sw2: 0, sw3: 0,
  };
}

/**
 * Build the shirt geometry for one cut.
 *
 * Fast enough to call from a slider: the body is around 7,000 vertices and this
 * is a single pass over them with no allocation per triangle beyond the
 * clipping scratch.
 */
export function buildShirtGeometry(
  body: THREE.SkinnedMesh,
  cut: ShirtCut,
): THREE.BufferGeometry {
  const geo = body.geometry;
  const position = geo.attributes.position;
  const normal = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const skinIndex = geo.attributes.skinIndex;
  const skinWeight = geo.attributes.skinWeight;
  const index = geo.index;

  const triangleCount = index ? index.count / 3 : position.count / 3;

  const outPos: number[] = [];
  const outNormal: number[] = [];
  const outUv: number[] = [];
  const outSkinIndex: number[] = [];
  const outSkinWeight: number[] = [];

  const read = (v: Vertex, i: number): Vertex => {
    v.px = position.getX(i);
    v.py = position.getY(i);
    v.pz = position.getZ(i);
    v.nx = normal ? normal.getX(i) : 0;
    v.ny = normal ? normal.getY(i) : 1;
    v.nz = normal ? normal.getZ(i) : 0;
    v.u = uv ? uv.getX(i) : 0;
    v.v = uv ? uv.getY(i) : 0;
    v.si0 = skinIndex.getX(i);
    v.si1 = skinIndex.getY(i);
    v.si2 = skinIndex.getZ(i);
    v.si3 = skinIndex.getW(i);
    v.sw0 = skinWeight.getX(i);
    v.sw1 = skinWeight.getY(i);
    v.sw2 = skinWeight.getZ(i);
    v.sw3 = skinWeight.getW(i);
    return v;
  };

  /*
   * The four half-spaces bounding the garment, each as "keep where this is
   * positive". Clipping against them one after another is exact, which is why
   * they are kept apart rather than combined into one distance field — the
   * intersection of half-spaces is not something you can interpolate along an
   * edge in a single step.
   */
  const distance = (v: Vertex, plane: number): number => {
    switch (plane) {
      case 0: return v.py - cut.hem;
      case 1: return cut.collar - v.py;
      case 2: return cut.sleeve - v.px;
      default: return v.px + cut.sleeve;
    }
  };

  const emit = (v: Vertex): void => {
    // Out along the normal, so the garment sits on the skin rather than in it.
    outPos.push(v.px + v.nx * OFFSET, v.py + v.ny * OFFSET, v.pz + v.nz * OFFSET);
    outNormal.push(v.nx, v.ny, v.nz);
    outUv.push(v.u, v.v);
    outSkinIndex.push(v.si0, v.si1, v.si2, v.si3);
    outSkinWeight.push(v.sw0, v.sw1, v.sw2, v.sw3);
  };

  // Clipping four planes can add at most one vertex each, so a triangle can
  // never grow past seven. Two buffers, swapped between planes.
  const POOL = 8;
  const source: Vertex[] = Array.from({ length: POOL }, blankVertex);
  let polyA: Vertex[] = Array.from({ length: POOL }, blankVertex);
  let polyB: Vertex[] = Array.from({ length: POOL }, blankVertex);
  let polyCount = 0;

  for (let t = 0; t < triangleCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;

    read(source[0], i0);
    read(source[1], i1);
    read(source[2], i2);

    // Reject and accept whole triangles before doing any clipping work. Six in
    // seven are nowhere near the shirt and leave on the first test; most of the
    // rest are wholly inside and never need splitting at all.
    let outsideAny = false;
    let straddles = false;
    for (let p = 0; p < 4 && !outsideAny; p++) {
      const d0 = distance(source[0], p);
      const d1 = distance(source[1], p);
      const d2 = distance(source[2], p);
      if (d0 < 0 && d1 < 0 && d2 < 0) outsideAny = true;
      else if (d0 < 0 || d1 < 0 || d2 < 0) straddles = true;
    }
    if (outsideAny) continue;
    if (!straddles) {
      emit(source[0]);
      emit(source[1]);
      emit(source[2]);
      continue;
    }

    copyVertex(polyA[0], source[0]);
    copyVertex(polyA[1], source[1]);
    copyVertex(polyA[2], source[2]);
    polyCount = 3;

    for (let p = 0; p < 4 && polyCount > 0; p++) {
      let nextCount = 0;
      for (let i = 0; i < polyCount; i++) {
        const cur = polyA[i];
        const prev = polyA[(i + polyCount - 1) % polyCount];
        const dCur = distance(cur, p);
        const dPrev = distance(prev, p);
        // Sutherland-Hodgman: emit the crossing point whenever an edge changes
        // side, then the current vertex if it is inside.
        if (dPrev < 0 !== dCur < 0) copyEdge(polyB[nextCount++], prev, cur, dPrev, dCur);
        if (dCur >= 0) copyVertex(polyB[nextCount++], cur);
      }
      const swap = polyA;
      polyA = polyB;
      polyB = swap;
      polyCount = nextCount;
    }

    // Fan-triangulate whatever survived. A clipped triangle is convex, so a fan
    // from its first vertex is always valid.
    for (let i = 2; i < polyCount; i++) {
      emit(polyA[0]);
      emit(polyA[i - 1]);
      emit(polyA[i]);
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(outNormal, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(outSkinIndex, 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(outSkinWeight, 4));
  return out;
}

function copyVertex(into: Vertex, from: Vertex): void {
  into.px = from.px; into.py = from.py; into.pz = from.pz;
  into.nx = from.nx; into.ny = from.ny; into.nz = from.nz;
  into.u = from.u; into.v = from.v;
  into.si0 = from.si0; into.si1 = from.si1; into.si2 = from.si2; into.si3 = from.si3;
  into.sw0 = from.sw0; into.sw1 = from.sw1; into.sw2 = from.sw2; into.sw3 = from.sw3;
}

/**
 * The point where an edge crosses a boundary.
 *
 * Position, normal and UV interpolate the way you would expect. Bone bindings
 * do not: skinIndex holds indices into the skeleton, and the average of bone 7
 * and bone 12 is not bone 9 or half of each — blending them would attach the
 * hem to whatever bone happened to sit between them in the array. So the new
 * vertex adopts the bindings of whichever end it landed nearer. Across an edge
 * a centimetre long the two ends are influenced almost identically, and the
 * alternative is a shirt with vertices stapled to the wrong limb.
 */
function copyEdge(into: Vertex, a: Vertex, b: Vertex, da: number, db: number): void {
  const t = da / (da - db);
  into.px = a.px + (b.px - a.px) * t;
  into.py = a.py + (b.py - a.py) * t;
  into.pz = a.pz + (b.pz - a.pz) * t;

  const nx = a.nx + (b.nx - a.nx) * t;
  const ny = a.ny + (b.ny - a.ny) * t;
  const nz = a.nz + (b.nz - a.nz) * t;
  const len = Math.hypot(nx, ny, nz) || 1;
  into.nx = nx / len;
  into.ny = ny / len;
  into.nz = nz / len;

  into.u = a.u + (b.u - a.u) * t;
  into.v = a.v + (b.v - a.v) * t;

  const nearer = t < 0.5 ? a : b;
  into.si0 = nearer.si0; into.si1 = nearer.si1;
  into.si2 = nearer.si2; into.si3 = nearer.si3;
  into.sw0 = nearer.sw0; into.sw1 = nearer.sw1;
  into.sw2 = nearer.sw2; into.sw3 = nearer.sw3;
}

/**
 * A skinned garment sharing the body's skeleton.
 *
 * Bound with the body's own bind matrix and parented beside it, so its world
 * transform and bone offsets match exactly — anything else and the shirt walks
 * off on its own while the character stands still.
 */
export function createShirtMesh(
  body: THREE.SkinnedMesh,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.SkinnedMesh {
  const shirt = new THREE.SkinnedMesh(geometry, material);
  shirt.name = 'Shirt';
  shirt.position.copy(body.position);
  shirt.quaternion.copy(body.quaternion);
  shirt.scale.copy(body.scale);
  body.parent?.add(shirt);
  shirt.bind(body.skeleton, body.bindMatrix);
  shirt.castShadow = true;
  // Same as the body: a skinned mesh's bounds are its bind pose, which says
  // nothing about where the animation has actually put it.
  shirt.frustumCulled = false;
  return shirt;
}
