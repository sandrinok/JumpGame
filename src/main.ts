import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createGround, createScene, focusShadow } from './render/scene';
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
import { setLevelSource } from './persistence/levelFile';
import { createStartScreen } from './ui/startScreen';
import { createCreditsScreen } from './ui/creditsScreen';
import { playWindBurst, unlockAudio } from './audio/sfx';
import { createDebugHud } from './ui/debugHud';

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

const renderer = createRenderer(container);
const camera = createCamera(container);
const { scene, sun } = createScene(renderer);
createGround(scene);

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

const debugHud = createDebugHud(container);
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
};
input.lockOnClick = false;

handleResize(renderer, camera, container);
window.addEventListener('resize', () => {
  editor?.onResize(container.clientWidth / container.clientHeight);
});

/** Persist the current run if it beat the record. Safe to call repeatedly. */
function commitRun(): void {
  if (runMaxHeight <= score.best) return;
  score.best = runMaxHeight;
  saveScore(score);
  hud.setBest(score.name, score.best);
}

// A run used to be banked only by falling past killY, so climbing to 40m and
// then closing the tab threw the whole thing away. pagehide covers closing and
// navigating; visibilitychange covers switching tabs or apps, which on mobile
// is often the last event a page gets.
window.addEventListener('pagehide', commitRun);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') commitRun();
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
      const y = player.currPos.y;
      hud.setHeight(y);
      if (y > runMaxHeight) runMaxHeight = y;

      if (y < levelHandle.level.killY) {
        commitRun();
        runMaxHeight = 0;
        respawnPlayer(player, levelHandle.level.spawn.pos, levelHandle.level.spawn.yaw);
        hud.flashRespawn();
        playWindBurst();
      }
    }
    input.endStep();
  },

  // Presentation — once per rendered frame, at whatever rate the display runs.
  (alpha, frameDt) => {
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

    renderer.render(scene, editor?.activeCamera ?? camera);
    debugHud.sample(renderer);
  },
);
