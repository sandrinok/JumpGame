import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createGround, createScene, focusShadow } from './render/scene';
import { createPostFx } from './render/postFx';
import { detectTier, qualityFor } from './render/quality';
import { FollowCamera } from './render/followCamera';
import { startLoop } from './core/loop';
import { Input } from './core/input';
import { addStaticGround, initPhysics } from './physics/world';
import { createCharacter } from './physics/character';
import {
  attachCharacterRig,
  createPlayer,
  renderPlayer,
  respawnPlayer,
  updatePlayer,
} from './game/player';
import { AssetRegistry } from './world/registry';
import { instantiate, loadLevel } from './world/level';
import { createHud } from './ui/hud';
import { loadScore, saveScore } from './persistence/score';
import { submitScore, submitScoreBeacon } from './persistence/leaderboard';
import { setLevelSource } from './persistence/levelFile';
import { createStartScreen } from './ui/startScreen';
import { createCreditsScreen } from './ui/creditsScreen';
import { playWindBurst, unlockAudio } from './audio/sfx';
import { createDebugHud } from './ui/debugHud';
import { createGpuTimer } from './render/gpuTimer';
import { installDevHandles } from './render/bench';

type EditorMode = 'play' | 'edit';

interface EditorApi {
  mode: EditorMode;
  activeCamera: import('three').PerspectiveCamera | import('three').OrthographicCamera;
  update(dt: number): void;
  onResize(aspect: number): void;
  toggle(): void;
  onModeChange: ((mode: EditorMode) => void) | null;
}

const appEl = document.getElementById('app');
if (!appEl) throw new Error('#app not found');
// Explicitly typed so the non-null narrowing survives into the async editor
// loader below, which TypeScript otherwise widens back to HTMLElement | null.
const container: HTMLElement = appEl;

// Settled once, before anything allocates a framebuffer: shadow map size and
// multisampling are baked into GPU resources that are expensive to swap out.
const quality = qualityFor(detectTier());

const renderer = createRenderer(container, quality);
const camera = createCamera(container);
const { scene, sun, updateSky } = createScene(renderer, quality);
createGround(scene);
const postFx = createPostFx(renderer, scene, camera, quality);

const input = new Input(renderer.domElement);
const followCam = new FollowCamera(camera);

const physics = await initPhysics();
const groundCollider = addStaticGround(physics);

const registry = new AssetRegistry();
await registry.loadManifest('/assets/manifest.json');
const LEVEL_PATH = '/levels/dev.json';
const level = await loadLevel(LEVEL_PATH);
setLevelSource(LEVEL_PATH);
// Only what this level actually places. The rest of the library is downloaded
// when the editor opens, so a player never waits on assets they cannot see.
await registry.resolveIds(level.placements.map((p) => p.id));
const levelHandle = instantiate(scene, physics, registry, level);

const character = createCharacter(physics, {
  x: levelHandle.level.spawn.pos[0],
  y: levelHandle.level.spawn.pos[1],
  z: levelHandle.level.spawn.pos[2],
});
const player = createPlayer(scene, character);
attachCharacterRig(player, '/assets/character/player.glb', {
  animationsUrl: '/assets/character/animations.glb',
}).catch((e) => {
  console.warn('Character rig failed to load, using debug capsule:', e);
});

const hud = createHud(container);
const score = loadScore();
hud.setBest(score.name, score.best);
let runMaxHeight = 0;
let running = false;
let currentMode: EditorMode = 'play';

/**
 * Distance from the capsule's centre — which is what the physics body reports —
 * down to the soles of its feet. Heights are measured from there, so standing
 * on the ground reads 0.0m rather than the 1.0m of capsule that is always
 * underneath you.
 */
const FEET_OFFSET = character.halfHeight + character.radius;
/**
 * Whether the player has touched anything yet this run.
 *
 * The spawn hangs in the air, so the first thing that happens is a fall. Until
 * this is set, that drop is not scored — otherwise every run opened with the
 * spawn height already banked, and the whole board would be a row of people
 * tied at exactly the height of the spawn point without any of them jumping.
 */
let hasLanded = false;

const gpuTimer = createGpuTimer(renderer);
const debugHud = createDebugHud(container, {
  gpu: gpuTimer,
  tier: quality.tier,
  renderScale: () => postFx.renderScale,
  bufferSize: () => postFx.bufferSize,
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    debugHud.toggle();
    e.preventDefault();
  }
});

let editor: EditorApi | null = null;
let editorPending = false;

/**
 * Build the editor. Everything it needs — React, Tailwind, the editor itself —
 * is imported here rather than at startup, so a player never downloads any of
 * it and the game does not wait on it before its first frame.
 */
async function loadEditor(): Promise<EditorApi> {
  // The palette needs the whole library, which the game deliberately did not
  // download at startup.
  const [{ Editor }, { PhysicsDebugView }, react, reactDom, { EditorRoot }] = await Promise.all([
    import('./editor/editor'),
    import('./physics/debugView'),
    import('react'),
    import('react-dom/client'),
    import('./editor/ui/EditorRoot'),
    import('./editor.css'),
    registry.resolveAll(),
  ]);
  const e = new Editor(renderer, scene, camera, levelHandle, registry, input);
  const dbg = new PhysicsDebugView(scene, physics);
  dbg.exclude(groundCollider);
  e.physicsDebug = dbg;
  e.onModeChange = (mode) => {
    currentMode = mode;
    input.lockOnClick = running && mode === 'play';
    // The start screen is a full-screen overlay at z-index 100. Left up, it
    // swallows every click meant for the editor — the menus and palette render
    // but nothing responds.
    if (mode === 'edit') startScreen.hide();
    else if (!running) startScreen.show();
  };

  const uiHost = document.createElement('div');
  uiHost.id = 'editor-ui';
  container.appendChild(uiHost);
  reactDom.createRoot(uiHost).render(react.createElement(EditorRoot, { actions: e.getActions() }));
  return e;
}

/**
 * F2. On a server with no editor password configured this does nothing at all —
 * players get no hint that an editor exists.
 */
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
    if (!session.configured) return;
    if (!session.authenticated && !(await promptLogin(container))) return;
    editor = await loadEditor();
    editor.toggle();
  } catch (e) {
    console.error('[editor] failed to open:', e);
  } finally {
    editorPending = false;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'F2') return;
  e.preventDefault();
  void toggleEditor();
});

const creditsScreen = createCreditsScreen(container);
const startScreen = createStartScreen(container, score);
startScreen.onCredits = () => creditsScreen.open();
startScreen.onPlay = () => {
  running = true;
  unlockAudio();
  input.lockOnClick = currentMode === 'play';
  hud.setBest(score.name, score.best);
  respawnPlayer(player, levelHandle.level.spawn.pos, levelHandle.level.spawn.yaw);
  runMaxHeight = 0;
  hasLanded = false;
};
input.lockOnClick = false;

/**
 * End the run and go back to the menu.
 *
 * There was no way back at all: Play hid the start screen and nothing ever
 * brought it up again, so the scoreboard was unreachable for as long as the tab
 * stayed open. Ending the run here also banks it, which matters more than it
 * sounds — a run was otherwise only ever submitted by falling past killY, and
 * the ground collider is 200 units across with no hole in it, so in practice
 * scores only reached the server when someone closed the tab.
 */
function leaveRun(): void {
  if (!running || currentMode !== 'play') return;
  commitRun();
  runMaxHeight = 0;
  hasLanded = false;
  running = false;
  input.lockOnClick = false;
  if (document.pointerLockElement) document.exitPointerLock();
  startScreen.show();
}

// Escape is the obvious key, but while the pointer is locked the browser eats
// it to release the lock and the page never sees the keypress. So the release
// itself is the signal, and the key handler only covers playing without
// mouse-look, where no lock was ever taken.
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) leaveRun();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') leaveRun();
});

handleResize(renderer, camera, container);
window.addEventListener('resize', () => {
  editor?.onResize(container.clientWidth / container.clientHeight);
  postFx.setSize(container.clientWidth, container.clientHeight);
});

/**
 * Persist the current run if it beat the record. Safe to call repeatedly.
 *
 * @param leaving true when the page is going away, which changes how the score
 *                is sent — an ordinary fetch would be cancelled by the unload.
 */
function commitRun(leaving = false): void {
  if (runMaxHeight <= score.best) return;
  score.best = runMaxHeight;
  saveScore(score);
  hud.setBest(score.name, score.best);

  // The shared board is decoration; a failure here must not disturb the run.
  if (leaving) {
    submitScoreBeacon(score.name, score.best);
    return;
  }
  void submitScore(score.name, score.best).then((scores) => {
    if (scores) startScreen.setScores(scores);
  });
}

// A run used to be banked only by falling past killY, so climbing to 40m and
// then closing the tab threw the whole thing away. pagehide covers closing and
// navigating; visibilitychange covers switching tabs or apps, which on mobile
// is often the last event a page gets.
window.addEventListener('pagehide', () => commitRun(true));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') commitRun(true);
});

installDevHandles({
  renderer,
  scene,
  postFx,
  camera: () => editor?.activeCamera ?? camera,
  level: levelHandle,
  registry,
});

startLoop(
  // Simulation — fixed 60Hz. Gameplay decisions live here and nowhere else, so
  // they stay identical on every refresh rate.
  (dt) => {
    if (currentMode === 'play' && running) {
      updatePlayer(player, input, dt, followCam.yaw);
      physics.world.step();

      // Read height from the simulation, not the interpolated visual: a
      // respawn must trigger on where the player actually is.
      const height = player.currPos.y - FEET_OFFSET;
      hud.setHeight(height);
      if (player.grounded) hasLanded = true;
      if (hasLanded && height > runMaxHeight) runMaxHeight = height;

      // killY is a world coordinate, so it is compared against the body rather
      // than the height shown to the player.
      if (player.currPos.y < levelHandle.level.killY) {
        commitRun();
        runMaxHeight = 0;
        hasLanded = false;
        respawnPlayer(player, levelHandle.level.spawn.pos, levelHandle.level.spawn.yaw);
        hud.flashRespawn();
        playWindBurst();
      }
    }
    input.endStep();
  },

  // Presentation — once per rendered frame, at whatever rate the display runs.
  (alpha, frameDt) => {
    const cpuStart = debugHud.enabled ? performance.now() : 0;
    if (currentMode === 'play') {
      if (running) {
        renderPlayer(player, alpha, frameDt);
        followCam.update(input, player.visualRoot.position);
        focusShadow(sun, player.visualRoot.position);
      } else {
        // Keep the rig breathing behind the start screen. The mixer only ran
        // once a run had started, so the first thing a visitor saw was the
        // character frozen in its bind pose, arms out like a mannequin.
        player.rig?.mixer.update(frameDt);
      }
    } else {
      editor?.update(frameDt);
      // Follow the fly-cam instead of the parked player, or the level would be
      // lit by a shadow frustum sitting wherever the player last stood.
      if (editor) focusShadow(sun, editor.activeCamera.position);
    }
    // After the camera has consumed this frame's mouse delta, before the next
    // frame starts collecting one.
    input.endFrame();

    updateSky(frameDt);
    // Resolution follows the frame budget. Fed the real frame interval, not the
    // fixed step, since dropped frames are exactly what it looks for.
    postFx.tune(frameDt * 1000);
    // renderer.info resets on every draw call, and the composer issues several
    // per frame — so sampling after it reported only the final fullscreen
    // quad ("draws 1 · tris 1"). Reset once per frame instead and let the
    // counters accumulate across every pass, which is the real cost anyway.
    renderer.info.reset();
    // Timer queries only run while the overlay is up; asking the driver for
    // timings every frame is not free, and nothing reads them when it is down.
    if (debugHud.enabled) gpuTimer.begin();
    postFx.render(editor?.activeCamera ?? camera);
    if (debugHud.enabled) gpuTimer.end();
    debugHud.sample(renderer, performance.now() - cpuStart);
  },
);
