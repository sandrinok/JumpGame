import * as THREE from 'three';
import type { Physics } from '../physics/world';
import type { AssetRegistry } from '../world/registry';

/**
 * The building the hub is inside.
 *
 * A terrace on a clifftop rather than a room with four walls. The portals stand
 * along the back under a covered loggia; everything in front of them is open to
 * the valley, and the only thing between the player and the drop is a
 * balustrade. That layout is the whole idea: you arrive facing the doorways,
 * and when you turn round there is somewhere to sit and something to look at.
 *
 * Structure gets exactly matching cuboid colliders, for the same reason the
 * climb does. Everything else — the pergola slats, the trim, the furniture —
 * carries none, and is placed clear of anywhere the player walks.
 *
 * Deliberately no roof over the middle. One was tried: the camera sits nearly
 * level with the player, so a lid fills the top half of every frame with unlit
 * dark, and lighting it means lighting a surface nobody looks at. The loggia
 * covers the portals, the pergola breaks up the sky over the lounge, and the
 * space between them is open.
 */

/** Terrace footprint. The clifftop under it is a little larger. */
export const TERRACE = { w: 44, d: 38 };
/** Where the portal wall stands. */
export const LOGGIA_Z = -15;
/** Top of the terrace floor. Everything else is measured from here. */
export const FLOOR_Y = 0;

export interface VillaSurfaces {
  stone: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  timber: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
}

export interface VillaBuild {
  /** Add a solid box with a matching collider. */
  solid(size: [number, number, number], pos: [number, number, number], mat: THREE.Material): THREE.Mesh;
  /** Add a box with no collider. Decoration only. */
  decor(size: [number, number, number], pos: [number, number, number], mat: THREE.Material): THREE.Mesh;
  materials: VillaSurfaces;
}

function terraceTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#c9bfae';
    ctx.fillRect(0, 0, size, size);
    // Travertine: blotches rather than a pattern, because paving that repeats
    // visibly is worse than paving with no detail at all.
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 4 + Math.random() * 26;
      ctx.fillStyle = `rgba(${150 + Math.random() * 60 | 0},${140 + Math.random() * 60 | 0},${120 + Math.random() * 55 | 0},0.05)`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, Math.random() * 3.14, 0, Math.PI * 2);
      ctx.fill();
    }
    // Slab joints, on a grid coarse enough that the eye reads size from them.
    ctx.strokeStyle = 'rgba(120,108,92,0.5)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * size;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 5);
  tex.anisotropy = 8;
  return tex;
}

/**
 * Where the loggia's columns stand, given where the doorways are.
 *
 * One in the middle of every gap between neighbouring portals, plus one at each
 * end of the run. Nothing lands on a portal's centre line by construction,
 * which is the property the old fixed stride could not offer.
 */
function columnPositions(portalX: number[], halfWidth: number): number[] {
  const end = halfWidth - 2.5;
  if (portalX.length === 0) return [-end, end];
  const sorted = [...portalX].sort((a, b) => a - b);
  const between = sorted.slice(1).map((x, i) => (x + sorted[i]) / 2);
  return [-end, ...between, end];
}

/**
 * @param portalX x of every portal, so the colonnade can be laid out around
 *   them rather than across them.
 */
export function createVillaShell(
  scene: THREE.Scene,
  physics: Physics,
  registry: AssetRegistry,
  portalX: number[],
): VillaBuild {
  const solid = (
    size: [number, number, number],
    pos: [number, number, number],
    mat: THREE.Material,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const { RAPIER, world } = physics;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2), body);
    return mesh;
  };

  const decor = (
    size: [number, number, number],
    pos: [number, number, number],
    mat: THREE.Material,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  const materials: VillaSurfaces = {
    stone: new THREE.MeshStandardMaterial({
      // Tinted down rather than left at white. The texture is already a pale
      // travertine; multiplying it by white and lighting it from three
      // directions is how paving ends up brighter than the sky behind it.
      color: 0x6d675a,
      map: terraceTexture(),
      roughness: 0.92,
    }),
    plaster: new THREE.MeshStandardMaterial({ color: 0x8b8171, roughness: 0.95 }),
    timber: new THREE.MeshStandardMaterial({ color: 0x6b4b32, roughness: 0.8 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x70654f, roughness: 0.6, metalness: 0.1 }),
    water: new THREE.MeshStandardMaterial({
      color: 0x2f8fb5,
      roughness: 0.08,
      metalness: 0.3,
      transparent: true,
      opacity: 0.82,
    }),
  };

  const T = TERRACE;

  // The terrace slab, and the mass of rock it is standing on. The rock is what
  // makes the terrace read as the top of something rather than a platform
  // hovering over a valley.
  solid([T.w, 1.2, T.d], [0, FLOOR_Y - 0.6, 0], materials.stone);
  decor([T.w + 3, 26, T.d + 3], [0, -14, 0], new THREE.MeshStandardMaterial({
    color: 0x6a6153,
    roughness: 1,
  }));

  // Back wall, behind the portals. The only full wall the villa has.
  solid([T.w, 8.5, 0.8], [0, 4.25, LOGGIA_Z - 1.4], materials.plaster);

  // Side wings, stopping short of the front so the view is uninterrupted.
  const wingD = 15;
  for (const side of [-1, 1]) {
    solid([0.8, 8.5, wingD], [side * (T.w / 2 - 0.4), 4.25, LOGGIA_Z + wingD / 2], materials.plaster);
  }

  /*
   * The balustrade, all the way round the open sides.
   *
   * Solid, and the reason is not decoration: the terrace is the top of a
   * sixty-metre cliff, and the hub has no fail state. Walking off it would drop
   * the player through the scenery into a respawn, which reads as the room
   * being broken.
   */
  const railH = 1.1;
  const railT = 0.45;
  solid([T.w, railH, railT], [0, railH / 2, T.d / 2], materials.trim);
  for (const side of [-1, 1]) {
    solid(
      [railT, railH, T.d - wingD],
      [side * (T.w / 2 - railT / 2), railH / 2, T.d / 2 - (T.d - wingD) / 2],
      materials.trim,
    );
  }
  // Balusters: decoration hung on the rail, so no colliders of their own.
  const balusterMat = materials.trim;
  for (let x = -T.w / 2 + 1; x <= T.w / 2 - 1; x += 1.5) {
    decor([0.16, railH - 0.3, 0.16], [x, (railH - 0.3) / 2, T.d / 2], balusterMat);
  }

  /*
   * Columns down the front of the loggia, holding its roof up.
   *
   * Their x positions are derived from the portal spacing rather than stepped
   * along the terrace, and that is the entire point of them being a list. A
   * fixed stride landed them at -17, -8, 1 and 10 against portals at -10.5, 0
   * and 10.5 — three metres in front of each doorway and very nearly centred on
   * it, so every portal was viewed through a column and the emblem beside it
   * was hidden outright. A colonnade whose bays do not line up with the
   * openings behind them is a mistake you can see from anywhere on the terrace.
   *
   * So: one column in each gap *between* portals, and one at each end of the
   * run. The bays now frame the doorways instead of blocking them, and the
   * walk from the spawn to any pad is down the middle of a bay.
   */
  const colH = 7.4;
  for (const x of columnPositions(portalX, T.w / 2)) {
    decor([0.9, colH, 0.9], [x, colH / 2, LOGGIA_Z + 5.5], materials.plaster);
    decor([1.3, 0.4, 1.3], [x, colH + 0.2, LOGGIA_Z + 5.5], materials.trim);
    decor([1.25, 0.35, 1.25], [x, 0.17, LOGGIA_Z + 5.5], materials.trim);
  }
  // Loggia roof: over the portals only, so the middle of the terrace stays open.
  decor([T.w, 0.7, 8.2], [0, colH + 0.75, LOGGIA_Z + 1.6], materials.plaster);
  decor([T.w + 1.2, 0.35, 9.0], [0, colH + 1.25, LOGGIA_Z + 1.6], materials.trim);

  void registry;
  return { solid, decor, materials };
}
