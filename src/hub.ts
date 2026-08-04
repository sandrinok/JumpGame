import * as THREE from 'three';
import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createScene } from './render/scene';
import { detectTier, qualityFor } from './render/quality';
import { FollowCamera } from './render/followCamera';
import { startLoop } from './core/loop';
import { Input } from './core/input';
import { initPhysics } from './physics/world';
import { createCharacter } from './physics/character';
import {
  attachCharacterRig,
  createPlayer,
  renderPlayer,
  respawnPlayer,
  updatePlayer,
} from './game/player';
import { appearanceOf, loadScore } from './persistence/score';
import { createAppearance } from './game/character/appearance';
import { fetchScores } from './persistence/leaderboard';
import { loadMaps, playUrl } from './world/maps';
import { createHubRoom, HUB_ASSET_IDS } from './hub/room';
import { instantiate, loadLevel } from './world/level';
import { setLevelSource } from './persistence/levelFile';
import { isTypingTarget } from './core/input';
import { AssetRegistry } from './world/registry';
import { createPostFx, NEUTRAL_GRADE } from './render/postFx';
import { createSettingsScreen } from './ui/settingsScreen';

/**
 * The hub: a room with one portal per map, and that map's board beside it.
 *
 * Its own entry point rather than a mode inside the game. The game's module is
 * built around having a level — vegetation, water, the dynamics system, the
 * climb gauge — and none of that means anything here. Bolting a second mode
 * onto it would have meant threading "but not in the hub" through all of it.
 *
 * Choosing a map navigates rather than swapping the level in place. Everything
 * the game builds is created once at module scope from the level it loaded, so
 * hot-swapping would mean tearing down and rebuilding the renderer, physics
 * world, scene graph and network identity — a large change with a lot of ways
 * to leak, in exchange for saving a page load that takes about a second.
 */

const appEl = document.getElementById('app');
if (!appEl) throw new Error('#app not found');
const container: HTMLElement = appEl;

const quality = qualityFor(detectTier());
const renderer = createRenderer(container, quality);
const camera = createCamera(container);
const { scene, sunDirection, updateSky } = createScene(renderer, quality);
/*
 * Aerial perspective.
 *
 * createScene hangs the jungle's fog on the scene — green, and dense enough
 * that foliage closes the distance for it. Over a mountain range that is a
 * green wall at fifty metres and no view at all.
 *
 * What a view needs is the opposite: almost nothing near the terrace, and
 * enough haze at a kilometre to separate the far ridge from the near one.
 * Exponential fog at this density is invisible across the villa and about half
 * strength at the horizon, which is what reads as distance.
 */
scene.fog = new THREE.FogExp2(0xa8c0d8, 0.00085);

const input = new Input(renderer.domElement);
input.lockOnClick = true;
const followCam = new FollowCamera(camera);

// Bloom, which is what makes the portals read as light rather than as painted
// discs. The hub is a handful of boxes and a shader, so it can afford the
// composer the climb pays for.
/*
 * No light shafts here, at any tier.
 *
 * They exist for the climb, where the sun is coming down through a canopy and
 * the shafts are what separates the layers of it. A villa on an open terrace
 * has nothing to cast them, so all the pass does is stack every ray on a bright
 * sky and bleach the whole view — which is exactly what it did to the mountains
 * before this line.
 *
 * Refused at construction rather than turned down to zero afterwards: the pass
 * marches its sample loop over every pixel regardless of what its exposure
 * uniform says, so a disabled effect that is still in the chain costs a full
 * screen of work to contribute nothing.
 */
const postFx = createPostFx(renderer, scene, camera, quality, { godRays: false });
// The villa is not a jungle either. Same reasoning as the maps.
postFx.setGrade(NEUTRAL_GRADE);

const physics = await initPhysics();
const maps = await loadMaps();

// The room is dressed from the same library the maps are built from. Only what
// the hub places, plus each map's emblem — the rest of the 305 assets are not
// downloaded for a room that shows twenty of them.
// A villa is not a ruin: the furniture keeps its own colours.
const registry = new AssetRegistry({ weather: false });
await registry.loadManifest('/assets/manifest.json');
await registry.resolveIds([
  ...HUB_ASSET_IDS,
  ...maps.map((m) => m.emblem).filter((id): id is string => Boolean(id)),
]);

const room = createHubRoom(scene, physics, maps, registry, quality);

/*
 * The furniture, as an editable level.
 *
 * The villa's architecture is code — it carries the colliders the room depends
 * on and its own materials. Its dressing is not, so it goes through the same
 * loader the maps use and can be rearranged with the editor instead of with a
 * text editor. Regenerate the starting layout with `npm run hub`.
 */
const DRESSING_PATH = '/levels/hub.json';
const dressing = await loadLevel(DRESSING_PATH);
setLevelSource(DRESSING_PATH);
await registry.resolveIds(dressing.placements.map((p) => p.id));
const dressingHandle = instantiate(scene, physics, registry, dressing);

const character = createCharacter(physics, {
  x: room.spawn.x,
  y: room.spawn.y,
  z: room.spawn.z,
});
const player = createPlayer(scene, character);
const FEET_OFFSET = character.halfHeight + character.radius;
const score = loadScore();

respawnPlayer(player, [room.spawn.x, room.spawn.y, room.spawn.z], room.spawnYaw);
followCam.yaw = room.spawnYaw + Math.PI;
// Looking slightly down the room rather than level with it: the portals and
// the floor are what you came to see, not the wall tops.
followCam.pitch = -0.2;

attachCharacterRig(player, '/assets/character/player.glb', {
  animationsUrl: '/assets/character/animations.glb',
})
  .then(() => {
    if (!player.rig) return;
    // You should already look like yourself when choosing where to go.
    createAppearance(player.rig.root)(appearanceOf(score));
  })
  .catch(() => {
    // The debug capsule is a fine stand-in; the hub still works without a rig.
  });

// Boards fill in as the requests land. One per map, in parallel, and each
// failure is silent — an empty board is a much smaller problem than a hub that
// will not open because a score server is down.
for (const portal of room.portals) {
  void fetchScores(portal.map.id).then((scores) => portal.setScores(scores));
}

const hint = document.createElement('div');
hint.textContent = 'WASD to walk · walk into a portal to play';
hint.style.cssText = `
  position: absolute; left: 0; right: 0; bottom: 22px; text-align: center;
  font: 13px system-ui, sans-serif; color: #cfd6e4; opacity: 0.55;
  pointer-events: none; text-shadow: 0 1px 3px rgba(0,0,0,0.8);
`;
container.appendChild(hint);

const title = document.createElement('div');
title.style.cssText = `
  position: absolute; left: 0; right: 0; top: 26px; text-align: center;
  font: 700 26px system-ui, sans-serif; color: #eef3fb; letter-spacing: 0.5px;
  pointer-events: none; text-shadow: 0 2px 8px rgba(0,0,0,0.7);
`;
title.textContent = 'JumpGame';
container.appendChild(title);

/*
 * Settings, from the front door.
 *
 * They used to be reachable only from inside a map, which meant the answer to
 * "the graphics are too heavy" was "walk through a portal into the heaviest
 * thing here, then look for a button". Both the tier and the effect switches
 * are stored per browser rather than per page, so changing them here changes
 * them everywhere.
 */
const settingsScreen = createSettingsScreen(container, quality.tier, {
  set(key, on) {
    if (key === 'bloom' || key === 'godRays' || key === 'aberration') {
      return postFx.setEffect(key, on);
    }
    // The hub has no drifting motes and no speed response to a sprint it does
    // not have. Nothing here disagrees with the choice, so nothing here needs
    // reloading for it — it is stored, and it applies on the map where those
    // things exist.
    return true;
  },
});

const settingsBtn = document.createElement('button');
settingsBtn.textContent = 'Settings';
settingsBtn.style.cssText = `
  position: absolute; right: 22px; top: 22px; padding: 6px 14px;
  font: 13px system-ui, sans-serif; color: #cfd6e4; cursor: pointer;
  background: rgba(12,16,24,0.55); border: 1px solid #4a4a58; border-radius: 6px;
  backdrop-filter: blur(4px);
`;
settingsBtn.addEventListener('click', () => settingsScreen.open());
container.appendChild(settingsBtn);

/**
 * How long the player must stand on a pad before it takes them.
 *
 * Instant would fire on the frame someone clips a corner while running past,
 * and the first thing that happens after choosing a map is a page load, which
 * is not something to trigger by accident. Long enough to be a decision, short
 * enough that it does not feel like a queue.
 */
// Registers a resize listener, so exactly once. Called from inside the render
// callback it adds one listener per frame.
handleResize(renderer, camera, container);
window.addEventListener('resize', () => {
  postFx.setSize(container.clientWidth, container.clientHeight);
});

if (import.meta.env.DEV) {
  // Same idea as the game's __jg: the room has no visible state to read, so
  // when something is missing from it the only way to tell a model that failed
  // to load from one placed behind a wall is to ask.
  (window as unknown as { __hub: unknown }).__hub = {
    scene,
    renderer,
    room,
    registry,
    postFx,
    camera,
    followCam,
    player,
    dressing: dressingHandle,
    /** Which of the room's models actually resolved. */
    assets: () =>
      [...HUB_ASSET_IDS, ...maps.map((m) => m.emblem)]
        .filter((id): id is string => Boolean(id))
        .map((id) => ({ id, loaded: Boolean(registry.get(id)) })),
    /**
     * Draw a frame without waiting for one.
     *
     * A browser suspends requestAnimationFrame the moment its tab is not the
     * one on screen, which freezes the whole hub — so a screenshot taken from
     * anywhere but the foreground shows whatever was on the canvas when it went
     * away. This steps the presentation path by hand so the room can be looked
     * at regardless.
     */
    frame(steps = 1) {
      for (let i = 0; i < steps; i++) {
        elapsed += 1 / 60;
        renderPlayer(player, 1, 1 / 60);
        room.update(elapsed, 1 / 60);
        followCam.update(input, player.visualRoot.position);
        updateSky(1 / 60);
        postFx.aimGodRays(camera, sunDirection);
        postFx.render(camera);
      }
    },
  };
}

/*
 * F2, the same as in the game.
 *
 * It edits the villa's furniture and nothing else: the editor is handed the
 * dressing level, so the terrace, the portals and the mountains are not
 * selectable and cannot be dragged into the valley by accident. Everything —
 * React, the editor, the whole asset library for the palette — is imported here
 * rather than at startup, so opening the hub never downloads any of it.
 */
type EditorMode = 'play' | 'edit';
interface EditorApi {
  mode: EditorMode;
  update(dt: number): void;
  toggle(): void;
  onModeChange: ((mode: EditorMode) => void) | null;
}
let editor: EditorApi | null = null;
let editorPending = false;
let editing = false;

async function toggleEditor(): Promise<void> {
  if (editor) {
    editor.toggle();
    return;
  }
  if (editorPending) return;
  editorPending = true;
  try {
    const { getSession, promptLogin } = await import('./editor/auth');
    const session = await getSession();
    // No editor password configured on the server: no editor, and no hint that
    // one exists.
    if (!session.configured) return;
    if (!session.authenticated && !(await promptLogin(container))) return;

    const [{ Editor }, { PhysicsDebugView }, react, reactDom, { EditorRoot }] = await Promise.all([
      import('./editor/editor'),
      import('./physics/debugView'),
      import('react'),
      import('react-dom/client'),
      import('./editor/ui/EditorRoot'),
      import('./editor.css'),
      // The palette wants the whole library, which the hub deliberately did not
      // download for a room that shows twenty models.
      registry.resolveAll(),
    ]);
    const e = new Editor(renderer, scene, camera, dressingHandle, registry, input);
    e.physicsDebug = new PhysicsDebugView(scene, physics);
    e.onModeChange = (mode) => {
      editing = mode === 'edit';
      input.lockOnClick = !editing;
      hint.style.display = editing ? 'none' : '';
      title.style.display = editing ? 'none' : '';
    };
    const uiHost = document.createElement('div');
    uiHost.id = 'editor-ui';
    container.appendChild(uiHost);
    reactDom.createRoot(uiHost).render(react.createElement(EditorRoot, { actions: e.getActions() }));
    editor = e as unknown as EditorApi;
    editor.toggle();
  } catch (e) {
    console.error('[editor] failed to open:', e);
  } finally {
    editorPending = false;
  }
}

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e) || e.code !== 'F2') return;
  e.preventDefault();
  void toggleEditor();
});

const DWELL_SECONDS = 0.55;
let leaving = false;

const feet = new THREE.Vector3();
let elapsed = 0;

startLoop(
  (dt) => {
    elapsed += dt;
    if (leaving) return;

    if (editing) {
      // The editor owns the camera and the mouse in edit mode. Stepping the
      // player as well would walk them through the room under the cursor, and
      // strolling onto a pad mid-edit would navigate away from unsaved work.
      editor?.update(dt);
      input.endStep();
      return;
    }

    updatePlayer(player, input, dt, followCam.yaw);
    physics.world.step();

    feet.copy(player.currPos);
    feet.y -= FEET_OFFSET;
    const standing = room.portalUnder(feet);

    for (const portal of room.portals) {
      if (portal === standing) {
        portal.charge = Math.min(1, portal.charge + dt / DWELL_SECONDS);
        if (portal.charge >= 1) {
          leaving = true;
          location.href = playUrl(portal.map.id);
        }
      } else {
        // Falls off faster than it fills, so stepping off is immediate and
        // stepping back on does not start from nothing.
        portal.charge = Math.max(0, portal.charge - dt / (DWELL_SECONDS * 0.5));
      }
    }

    // Nothing here is fatal, but a fall through the world would still be a
    // dead end. Put them back rather than leaving them under the floor.
    if (player.currPos.y < -20) {
      respawnPlayer(player, [room.spawn.x, room.spawn.y, room.spawn.z], room.spawnYaw);
    }

    // Edge-triggered keys belong to the step that consumed them.
    input.endStep();
  },

  (alpha, frameDt) => {
    renderPlayer(player, alpha, frameDt);
    room.update(elapsed, frameDt);
    if (!editing) followCam.update(input, player.visualRoot.position);
    updateSky(frameDt);
    // Aim the light shafts before drawing them. Left unaimed the pass keeps its
    // default sun position, which is screen centre — and every ray converges on
    // the sun, so dead centre they stack over the whole frame and white it out.
    // That is what was bleaching the terrace, not the lighting.
    // The editor swaps in its own fly camera; draw through whichever is active.
    const view = (editor as unknown as { activeCamera?: THREE.Camera })?.activeCamera ?? camera;
    postFx.aimGodRays(view, sunDirection);
    // The renderer is built with info.autoReset off, because the composer issues
    // several draws per frame and letting each one wipe the counters leaves them
    // reporting the final fullscreen quad. The game resets them once per frame;
    // the hub never did, so `__hub.renderer.info` was a running total since page
    // load — which reads as a plausible per-frame number and is not one.
    renderer.info.reset();
    postFx.render(view);

    // After the camera has consumed them, and not before: mouse and wheel
    // deltas accumulate across a frame. Leaving this out does not make the
    // camera slightly too sensitive, it makes it compound — every frame
    // re-applies the entire history of mouse movement, so the view spins away
    // on its own and never stops.
    input.endFrame();
  },
);
