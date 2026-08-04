import * as THREE from 'three';
import type { Physics } from '../physics/world';
import type { MapInfo } from '../world/maps';
import type { ScoreEntry } from '../persistence/leaderboard';
import type { AssetRegistry } from '../world/registry';
import type { QualitySettings } from '../render/quality';
import { createPortalSurface, type PortalSurface } from './portalMaterial';
import { createLandscape, LANDSCAPE_ASSET_IDS } from './landscape';
import { createVillaShell, FLOOR_Y, LOGGIA_Z, TERRACE } from './villa';

/**
 * The villa you choose a map from.
 *
 * A terrace on a clifftop: portals along the covered back, everything in front
 * open to a valley and a mountain range. You arrive facing the doorways, and
 * turning round gives you somewhere to sit and something to look at — which is
 * the point of it existing at all. A menu would have been less work.
 *
 * Built in code rather than authored as a level, because none of it is a level:
 * there is nothing to climb and nothing to fall off. Running it through the
 * level format would mean teaching that format about portals and score boards,
 * which are concepts the maps have no use for.
 *
 * The shell is in villa.ts and the view is in landscape.ts. What is left here
 * is what makes it a hub rather than a building: the portals, the boards, and
 * the furniture.
 */

/** Where the portals stand, and how far apart. */
const PORTAL_Z = LOGGIA_Z + 2.5;
const PORTAL_SPACING = 10.5;
const RING_RADIUS = 1.85;
/** How close the player's feet have to get to a pad to be taken through it. */
const PAD_RADIUS = 1.7;

/**
 * Where the things that do not exist yet will go.
 *
 * A wardrobe to change clothes at and a counter to buy from. Neither is wired
 * up; both have their corner built and dressed, because leaving the space for
 * them now is free and retrofitting a shop into a finished terrace is not.
 */
export const STATION_ANCHORS = {
  wardrobe: new THREE.Vector3(-TERRACE.w / 2 + 4.5, FLOOR_Y, LOGGIA_Z + 9),
  shop: new THREE.Vector3(TERRACE.w / 2 - 4.5, FLOOR_Y, LOGGIA_Z + 9),
};

/** Everything the villa wants loaded before it is built. */
export const HUB_ASSET_IDS = [
  'tiny_contemporary_carpet',
  'tiny_lovely_loveseat',
  'tiny_lovely_armchair',
  'tiny_modern_pouffe',
  'tiny_sir_cumference_coffee_table',
  'tiny_orbital_high_dining',
  'tiny_lovely_dining_chair',
  'tiny_power_tower_bookcase',
  'tiny_open_shelf',
  'tiny_vertical_mini_garden',
  'tiny_miracle_mirror',
  'tiny_the_modern_desk_lamp',
  'tiny_lamp_without_storage',
  'trees_and_bush_pack_bush_big2',
  'trees_and_bush_pack_bush_med',
  'trees_and_bush_pack_bush_small',
  'japanese_street_lamp',
  'moai_low_poly_game_ready',
  'sushi',
  'rubber_duck',
  'garden_gnome',
  'psx_industrial_pack_cargo_container',
  // The forest on the hillsides. Four models, a dozen triangles each, planted
  // in the hundreds — see landscape.ts.
  ...LANDSCAPE_ASSET_IDS,
];

export interface Portal {
  map: MapInfo;
  pos: THREE.Vector3;
  setScores(scores: ScoreEntry[]): void;
  /** 0..1, how far into the entry animation this portal is. */
  charge: number;
  /**
   * Whether walking in leads anywhere.
   *
   * A closed portal is still built, still lit and still labelled — it is a
   * doorway to a map that is not finished, not an absence. It simply never
   * charges, so standing on the pad does nothing.
   */
  open: boolean;
  ring: THREE.Mesh;
  surface: PortalSurface;
  pad: THREE.Mesh;
  light: THREE.PointLight;
  emblem: THREE.Object3D | null;
}

export interface HubRoom {
  portals: Portal[];
  spawn: THREE.Vector3;
  spawnYaw: number;
  update(elapsed: number, dt: number): void;
  portalUnder(feet: THREE.Vector3): Portal | null;
}

/**
 * A board of text, as a texture.
 *
 * Canvas rather than any text-in-3D library: a handful of short lines that
 * change once when the scores arrive, so the cost is one draw into a 2D context
 * and it inherits the browser's font rendering for free.
 */
function makeBoard(width: number, height: number): {
  texture: THREE.CanvasTexture;
  draw: (title: string, subtitle: string, rows: string[][], accent: string) => void;
} {
  const scale = 96;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const draw = (title: string, subtitle: string, rows: string[][], accent: string): void => {
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1b1712');
    bg.addColorStop(1, '#0d0b08');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // A bar of the map's colour along the top, which is what makes three boards
    // in a row read as three different places rather than three copies.
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h * 0.035);

    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f6efe4';
    ctx.font = `700 ${Math.round(h * 0.115)}px system-ui, sans-serif`;
    ctx.fillText(title, w * 0.055, h * 0.075);

    ctx.fillStyle = 'rgba(240,232,218,0.45)';
    ctx.font = `${Math.round(h * 0.045)}px system-ui, sans-serif`;
    ctx.fillText(subtitle, w * 0.055, h * 0.215);

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.055, h * 0.3);
    ctx.lineTo(w * 0.945, h * 0.3);
    ctx.stroke();

    const top = h * 0.35;
    const line = h * 0.115;
    ctx.font = `${Math.round(h * 0.065)}px system-ui, sans-serif`;
    if (rows.length === 0) {
      ctx.fillStyle = 'rgba(240,232,218,0.3)';
      ctx.fillText('No runs yet — be first.', w * 0.055, top);
    }
    rows.forEach(([rank, name, height], i) => {
      const y = top + i * line;
      if (i === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(w * 0.04, y - h * 0.018, w * 0.92, line * 0.92);
      }
      ctx.fillStyle = 'rgba(240,232,218,0.35)';
      ctx.fillText(rank, w * 0.055, y);
      ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(245,238,226,0.85)';
      ctx.fillText(name, w * 0.14, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = i === 0 ? accent : 'rgba(245,238,226,0.6)';
      ctx.fillText(height, w * 0.945, y);
      ctx.textAlign = 'left';
    });
    texture.needsUpdate = true;
  };

  return { texture, draw };
}

/** A small engraved plate, for labelling a corner that has no UI yet. */
function makePlate(text: string, sub: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#2a231b';
    ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = 'rgba(210,190,160,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 500, 148);
    ctx.fillStyle = '#e8dcc6';
    ctx.font = '700 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, 256, 34);
    ctx.fillStyle = 'rgba(232,220,198,0.5)';
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText(sub, 256, 98);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 0.6),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
  );
}

export function createHubRoom(
  scene: THREE.Scene,
  physics: Physics,
  maps: MapInfo[],
  registry: AssetRegistry,
  quality: QualitySettings,
): HubRoom {
  const span = (maps.length - 1) * PORTAL_SPACING;
  const portalX = maps.map((_, i) => -span / 2 + i * PORTAL_SPACING);

  const landscape = createLandscape(scene);
  landscape.plant(registry, quality);
  // The colonnade is laid out around the doorways, so where they are has to be
  // decided before the building goes up rather than after it.
  const { decor, materials } = createVillaShell(scene, physics, registry, portalX);

  /**
   * Drop a library model onto the terrace.
   *
   * Sized by its longest horizontal dimension rather than by a raw scale, so a
   * 6.6m sushi and a 0.4m lamp can be asked for in the same units: "make this
   * about two metres across". A missing asset is skipped rather than thrown —
   * the hub opening matters more than any one ornament in it.
   */
  const prop = (
    id: string,
    pos: [number, number, number],
    width: number,
    yaw = 0,
  ): THREE.Object3D | null => {
    const asset = registry.get(id);
    if (!asset) return null;
    const obj = asset.template.clone(true);
    const bounds = new THREE.Box3().setFromObject(obj);
    const size = bounds.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.z) || 1;
    const s = width / longest;
    obj.scale.setScalar(s);
    // Sit it on the floor: models arrive with their own idea of where zero is.
    obj.position.set(pos[0], pos[1] - bounds.min.y * s, pos[2]);
    obj.rotation.y = yaw;
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        // Receives shadow, does not cast one. These models come apart into
        // dozens of sub-meshes each, and every one of them casting doubles the
        // draw calls for the whole terrace — to add contact shadows under
        // furniture that is already sitting in the shade of a roof.
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    scene.add(obj);
    return obj;
  };

  /*
   * Light.
   *
   * The scene's sun is doing the outdoor half. What it cannot do is reach under
   * the loggia roof, which is exactly where the boards and the portals are — so
   * the covered part gets its own warm fill, and the open terrace gets a sky
   * term rather than nothing.
   */
  // Kept deliberately low. The scene already has a sun and an environment
  // term; piling a bright sky light and a row of lamps on top of them washed
  // the whole terrace out to near-white, which is the usual way an outdoor
  // scene ends up looking like it has no light in it at all.
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x6b6250, 0.28));
  for (const x of [-14, 0, 14]) {
    const lamp = new THREE.PointLight(0xffd2a0, 9, 18, 2);
    lamp.position.set(x, 6.4, LOGGIA_Z + 3.5);
    scene.add(lamp);
  }

  const portals: Portal[] = [];

  maps.forEach((map, i) => {
    const x = portalX[i];
    const open = map.available !== false;
    /*
     * A closed doorway is drained of its colour rather than left dark.
     *
     * Both readings had to be ruled out before this one. Hiding the portal
     * entirely loses the promise — the hub's job is to say what is coming as
     * well as what is here. Building it at full brightness and refusing the
     * player at the pad is worse still: everything about it says "walk in", and
     * the answer arrives only after they have.
     *
     * Desaturated and dimmed reads as unlit signage, which is exactly what it
     * is. The map's own colour is still visible in it, so the doorway is
     * recognisably that map's.
     */
    const accent = new THREE.Color(map.accent);
    if (!open) {
      const hsl = { h: 0, s: 0, l: 0 };
      accent.getHSL(hsl);
      accent.setHSL(hsl.h, hsl.s * 0.25, hsl.l * 0.42);
    }

    // A recess in the back wall, so each doorway is set into something.
    decor([8.0, 7.6, 0.4], [x, 3.8, LOGGIA_Z - 1.0], materials.trim);
    decor([7.2, 6.9, 0.3], [x, 3.6, LOGGIA_Z - 0.8], materials.plaster);

    // The pad. Deliberately not solid: it is a floor marking, and a collider on
    // it would be a kerb the player trips over on the way in.
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS * 1.05, 0.08, 48),
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.2,
      }),
    );
    pad.position.set(x, FLOOR_Y + 0.04, PORTAL_Z);
    pad.receiveShadow = true;
    scene.add(pad);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(RING_RADIUS, 0.17, 16, 48),
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 1.1,
        roughness: 0.25,
        metalness: 0.6,
      }),
    );
    ring.position.set(x, 2.2, PORTAL_Z - 1.2);
    ring.castShadow = true;
    scene.add(ring);

    const surface = createPortalSurface(accent, RING_RADIUS);
    surface.mesh.position.copy(ring.position);
    surface.mesh.position.z += 0.02;
    scene.add(surface.mesh);

    // Plinth, so the arch is standing on something.
    decor([4.2, 0.28, 1.3], [x, 0.14, PORTAL_Z - 1.2], materials.trim);

    const light = new THREE.PointLight(accent, open ? 9 : 2.5, 15, 2);
    light.position.set(x, 2.3, PORTAL_Z + 0.4);
    scene.add(light);

    // A closed doorway says so on the floor as well as on the board. This is
    // the one the player is standing over when nothing happens, so it is the
    // one that has to have already answered the question.
    if (!open) {
      const plate = makePlate(map.title, 'coming soon');
      // Clear of the pad's top face, which is at 0.08 — the pad is 0.08 thick
      // and centred at 0.04, so a plate at 0.06 lies *inside* it and is not
      // drawn at all.
      plate.position.set(x, 0.11, PORTAL_Z + 0.2);
      // Face up, with the text's top edge pointing away down the terrace, which
      // is the right way up for someone walking towards the doorway.
      plate.rotation.x = -Math.PI / 2;
      scene.add(plate);
    }

    const board = makeBoard(4.4, 2.9);
    const boardMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 2.9),
      new THREE.MeshBasicMaterial({ map: board.texture, toneMapped: false }),
    );
    boardMesh.position.set(x, 5.5, PORTAL_Z - 1.75);
    scene.add(boardMesh);
    decor([4.7, 3.2, 0.12], [x, 5.5, PORTAL_Z - 1.85], materials.timber);

    // One prop per portal, saying what is through it before you read anything.
    const emblem = map.emblem
      ? prop(map.emblem, [x + 3.4, FLOOR_Y, PORTAL_Z + 0.3], map.emblemWidth ?? 1.6, -0.5)
      : null;

    const render = (scores: ScoreEntry[]): void => {
      board.draw(
        map.title,
        map.blurb.length > 62 ? `${map.blurb.slice(0, 59)}…` : map.blurb,
        // A closed map's board carries the notice instead of a table. Its
        // scores are not merely empty, they cannot be set — showing "no runs
        // yet — be first" over a doorway nobody can walk through is an
        // invitation to do something impossible.
        open
          ? scores.slice(0, 5).map((e, n) => [`${n + 1}`, e.name, `${e.height.toFixed(1)} m`])
          : [['', 'Coming soon', '']],
        map.accent,
      );
    };
    render([]);

    portals.push({
      map,
      pos: new THREE.Vector3(x, FLOOR_Y, PORTAL_Z),
      setScores: render,
      charge: 0,
      open,
      ring,
      surface,
      pad,
      light,
      emblem,
    });
  });

  /*
   * The pool.
   *
   * Set into the terrace along the right-hand side rather than in the middle:
   * the middle is the walk from the seating to the portals, and a pool across
   * it would mean either swimming or going round. The water surface is a plain
   * transparent plane — there is a real animated water shader in the project,
   * but it is built for a flooded street at level scale and this is a puddle.
   */
  const poolX = TERRACE.w / 2 - 8;
  const poolZ = 9;
  const poolW = 9;
  const poolD = 13;
  decor([poolW + 1.4, 0.5, poolD + 1.4], [poolX, 0.25, poolZ], materials.trim);
  decor([poolW, 0.9, poolD], [poolX, -0.15, poolZ], new THREE.MeshStandardMaterial({
    color: 0x1d5f78,
    roughness: 0.5,
  }));
  const surface = decor([poolW - 0.3, 0.06, poolD - 0.3], [poolX, 0.26, poolZ], materials.water);
  surface.castShadow = false;

  /*
   * The furniture used to be placed here.
   *
   * It now lives in public/levels/hub.json and is instantiated by the same
   * loader the maps use, so it can be dragged around with the editor instead of
   * edited as source. The architecture stayed behind: it carries the colliders
   * the room depends on and its own materials, and neither survives a trip
   * through the level format.
   *
   * Regenerate the starting layout with `npm run hub`. That overwrites whatever
   * the editor last saved.
   */

  /*
   * The two corners that are not finished.
   *
   * A wardrobe to change at and a counter to buy from. Neither does anything
   * yet. The plinths and the plates are built anyway, because the space for
   * them is free now and cutting a shop into a finished terrace later is not —
   * and an obviously-reserved corner is more honest than a flat wall that will
   * have to be knocked through. What stands *on* them is furniture, so it lives
   * in the level file with the rest.
   */
  const wardrobe = STATION_ANCHORS.wardrobe;
  decor([5.0, 0.25, 4.4], [wardrobe.x, 0.12, wardrobe.z], materials.trim);
  const wardrobePlate = makePlate('Wardrobe', 'not open yet');
  wardrobePlate.position.set(wardrobe.x, 2.4, wardrobe.z - 2.2);
  wardrobePlate.rotation.y = 0.15;
  scene.add(wardrobePlate);

  const shop = STATION_ANCHORS.shop;
  decor([5.0, 0.25, 4.4], [shop.x, 0.12, shop.z], materials.trim);
  decor([3.2, 1.05, 1.1], [shop.x, 0.78, shop.z - 1.2], materials.timber);
  const shopPlate = makePlate('Kiosk', 'not open yet');
  shopPlate.position.set(shop.x, 2.4, shop.z - 2.2);
  shopPlate.rotation.y = -0.15;
  scene.add(shopPlate);

  return {
    portals,
    // In front of the portals, facing them: the doorways are what you are here
    // for, and the view is the reward for turning round.
    spawn: new THREE.Vector3(0, FLOOR_Y + 1.2, 2.5),
    // Portals sit at negative z, and yaw 0 looks down +z.
    spawnYaw: Math.PI,

    update(elapsed, dt) {
      for (const p of portals) {
        p.surface.material.uniforms.uTime.value = elapsed;
        p.surface.material.uniforms.uCharge.value = p.charge;

        // The ring turns slowly and speeds up as the player commits, so the
        // portal is visibly answering the approach rather than only getting
        // brighter.
        p.ring.rotation.z = elapsed * (0.25 + p.charge * 2.2);

        const pulse = 0.8 + Math.sin(elapsed * 1.5 + p.pos.x) * 0.12;
        (p.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse + p.charge * 3.5;
        p.light.intensity = 9 * pulse + p.charge * 55;
        (p.pad.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + p.charge * 2.2;
        p.pad.scale.setScalar(1 + p.charge * 0.05);
        if (p.emblem) p.emblem.rotation.y += dt * (0.25 + p.charge * 1.5);
      }
    },

    portalUnder(feet) {
      for (const p of portals) {
        // A doorway that leads nowhere is not standable-on in any sense the
        // caller cares about: it never charges and it never takes anyone
        // through. Filtering here rather than at the call site means a second
        // caller cannot forget to.
        if (!p.open) continue;
        const dx = feet.x - p.pos.x;
        const dz = feet.z - p.pos.z;
        // Only while actually on the floor: jumping over a pad is not choosing
        // a map, and being yanked out mid-hop would be startling.
        if (feet.y > FLOOR_Y + 0.6 || feet.y < FLOOR_Y - 0.6) continue;
        if (dx * dx + dz * dz <= PAD_RADIUS * PAD_RADIUS) return p;
      }
      return null;
    },
  };
}
