import * as THREE from 'three';
import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createGround, createScene, focusShadow } from './render/scene';
import { createPostFx, JUNGLE_GRADE, NEUTRAL_GRADE } from './render/postFx';
import { detectTier, qualityFor } from './render/quality';
import { effectIsOn, storedEffects } from './render/effects';
import { FollowCamera } from './render/followCamera';
import { startLoop } from './core/loop';
import { Input, isTypingTarget } from './core/input';
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
import { createVegetation, VEGETATION_IDS } from './world/vegetation';
import { createDynamics } from './world/dynamics';
import { createWater } from './render/water';
import { createFeel } from './game/feel';
import { createParticles } from './render/particles';
import { setRuinScale } from './render/ruinMaterial';
import { instantiate, loadLevel } from './world/level';
import { createHud } from './ui/hud';
import { appearanceOf, bestOn, loadScore, saveScore } from './persistence/score';
import { submitScore, submitScoreBeacon } from './persistence/leaderboard';
import { connectMultiplayer } from './net/multiplayer';
import { createRemotePlayers, type RemotePlayers } from './game/remotePlayers';
import { createAppearance, type ApplyAppearance } from './game/character/appearance';
import { setLevelSource } from './persistence/levelFile';
import { createStartScreen } from './ui/startScreen';
import { createCreditsScreen } from './ui/creditsScreen';
import { createSettingsScreen } from './ui/settingsScreen';
import {
  playBounce,
  playWindBurst,
  setAmbienceActive,
  unlockAudio,
  updateFootsteps,
} from './audio/sfx';
import { createDebugHud } from './ui/debugHud';
import { createOnlinePanel } from './ui/onlinePanel';
import { createChat } from './ui/chat';
import { createGpuTimer } from './render/gpuTimer';
import { installDevHandles } from './render/bench';
import { arrivedThroughPortal, findMap, loadMaps, selectedMapId } from './world/maps';

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
// The player's individual effect switches are folded in here rather than
// applied afterwards, so anything they turned off is never built at all.
const quality = qualityFor(detectTier());

const renderer = createRenderer(container, quality);
const camera = createCamera(container);
const { scene, sun, sunDirection, updateSky } = createScene(renderer, quality);
// Ground is shaped around the waterline, so it needs to know where that is.
const WATER_Y = 1.05;
const postFx = createPostFx(renderer, scene, camera, quality);

const input = new Input(renderer.domElement);
const followCam = new FollowCamera(camera);

const physics = await initPhysics();
const groundCollider = addStaticGround(physics);

// Which map this page is playing. The hub sets ?map= on the way in; opening the
// game directly falls back to the first map in the index.
const maps = await loadMaps();
const currentMap = findMap(maps, selectedMapId(maps));
// Only the jungle gets its library aged into a mossy ruin. Everywhere else the
// props keep the colours they were authored with.
const registry = new AssetRegistry({ weather: currentMap.look === 'jungle' });
await registry.loadManifest('/assets/manifest.json');
const LEVEL_PATH = `/levels/${currentMap.file}`;
// Built once the map is known: the terrain is carved around this map's
// waterline, and a map with no flood wants it flat.
createGround(scene, currentMap.env.water ? WATER_Y : null, quality.anisotropy);
// The look is the map's, not the game's. Left on the jungle grade every map
// came out with the same cold cast over everything in it.
postFx.setGrade(currentMap.look === 'jungle' ? JUNGLE_GRADE : NEUTRAL_GRADE);

if (!currentMap.env.vegetation) {
  /*
   * Thinner, neutral air for the bare maps.
   *
   * The jungle's fog is green and dense on purpose: foliage closes the distance
   * and the haze only has to separate the layers. With no foliage there is
   * nothing to separate, so the same density simply drains the colour out of
   * everything inside forty metres — which on a map made of traffic cones and
   * cargo containers is the entire thing you came to look at.
   */
  scene.fog = new THREE.FogExp2(0x9fb0c4, 0.0022);
}
const level = await loadLevel(LEVEL_PATH);
setLevelSource(LEVEL_PATH);
// Only what this level actually places. The rest of the library is downloaded
// when the editor opens, so a player never waits on assets they cannot see.
await registry.resolveIds([
  ...level.placements.map((p) => p.id),
  // The rubble models, and only if this tier is going to scatter any. On low
  // that is fourteen models nobody downloads rather than fourteen downloaded
  // and then not placed — the tier decides what exists, and a download for
  // something that will not exist is the most expensive kind of nothing.
  ...(currentMap.env.vegetation && quality.debris ? VEGETATION_IDS : []),
]);
const levelHandle = instantiate(scene, physics, registry, level);
// Purely visual and deliberately collider-free: the jungle is dressing, and
// nothing the player can walk into. Placement keeps it clear of every landable
// face, so it never lies about where the floor is.
const vegetation = currentMap.env.vegetation
  ? createVegetation(scene, registry, level, quality)
  : null;
// Sat just under the kill plane, so the surface the player must not touch is
// the surface they can see. killY is compared against the capsule centre, which
// sits a body-radius above the feet.
const water = currentMap.env.water ? createWater(scene, WATER_Y) : null;
const feel = createFeel(camera.fov);
const particles = createParticles(scene, quality.motes);
let windClock = 0;
const feet = new THREE.Vector3();
const carryDelta = new THREE.Vector3();

/**
 * Point the camera the way the level says the player is facing.
 *
 * FollowCamera keeps its own yaw and started at 0 regardless of the spawn, so
 * the player faced one way and the camera looked another — you began every run
 * looking at the back of the climb. The camera sits *behind* the player and
 * looks back at them, so its yaw is the player's plus half a turn.
 */
function faceSpawn(): void {
  followCam.yaw = levelHandle.level.spawn.yaw + Math.PI;
  followCam.pitch = -0.22;
}

const character = createCharacter(physics, {
  x: levelHandle.level.spawn.pos[0],
  y: levelHandle.level.spawn.pos[1],
  z: levelHandle.level.spawn.pos[2],
});
const player = createPlayer(scene, character);
// Moving platforms, crumbling ledges, bounce pads and rotators. Built after the
// character because its ground ray has to know which collider is the player's
// own — the ray starts inside the capsule and would otherwise only ever find
// that.
const dynamics = createDynamics(physics, levelHandle, character.collider);
const CHARACTER_MODEL = '/assets/character/player.glb';
const CHARACTER_ANIMATIONS = '/assets/character/animations.glb';
const hud = createHud(container);
const score = loadScore();
hud.setBest(score.name, bestOn(score, currentMap.id));

/** Puts the local player's own colours and shirt on their own character. */
let dressSelf: ApplyAppearance | null = null;
attachCharacterRig(player, CHARACTER_MODEL, {
  animationsUrl: CHARACTER_ANIMATIONS,
})
  .then(() => {
    if (!player.rig) return;
    // Seeing yourself as everyone else sees you. Without this the whole
    // choice is invisible to the one person making it.
    dressSelf = createAppearance(player.rig.root);
    dressSelf(appearanceOf(score));
  })
  .catch((e) => {
    console.warn('Character rig failed to load, using debug capsule:', e);
  });

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

/*
 * The shared world.
 *
 * Everything about it is optional: the connection retries quietly in the
 * background, remote avatars only appear once the character model has loaded,
 * and nothing here can stop the game running on its own.
 */
const net = connectMultiplayer(currentMap.id, score.name, appearanceOf(score));
let remotePlayers: RemotePlayers | null = null;
createRemotePlayers(
  scene,
  CHARACTER_MODEL,
  CHARACTER_ANIMATIONS,
  (character.halfHeight + character.radius) * 2,
)
  .then((rp) => {
    remotePlayers = rp;
  })
  .catch((e) => console.warn('[multiplayer] remote avatars unavailable:', e));

const onlinePanel = createOnlinePanel(container);
const chat = createChat(container);
chat.onSend = (text) => net.say(text);
chat.onOpenChange = (isOpen) => {
  if (isOpen) {
    // Drop anything held, or the character keeps walking while you type.
    input.clearKeys();
    input.lockOnClick = false;
    // Give the cursor back. Releasing the pointer normally means the run has
    // ended, which is why the handler below has to know chat is why it went.
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    input.lockOnClick = running && currentMode === 'play';
  }
};
net.onChat = (message) => chat.push(message);
net.onScores = (scores) => startScreen.setScores(scores);

const gpuTimer = createGpuTimer(renderer);
const debugHud = createDebugHud(container, {
  gpu: gpuTimer,
  tier: quality.tier,
  renderScale: () => postFx.renderScale,
  bufferSize: () => postFx.bufferSize,
});
window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e)) return;
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
  // Loading another level deletes the ground the player is standing on. Put
  // them on the new spawn, and reset the run with them: the height climbed in
  // a level that no longer exists is not a score in this one.
  e.onLevelReplaced = () => {
    respawnPlayer(player, levelHandle.level.spawn.pos, levelHandle.level.spawn.yaw);
    faceSpawn();
    runMaxHeight = 0;
    hasLanded = false;
  };
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
  if (isTypingTarget(e) || e.code !== 'F2') return;
  e.preventDefault();
  void toggleEditor();
});

const creditsScreen = createCreditsScreen(container);
/*
 * The effect switches, routed to whatever owns each one.
 *
 * Each returns whether it could be honoured from here. Turning something *off*
 * always can be — a pass that exists can be skipped, a mesh that exists can be
 * hidden. Turning something *on* only can be if this tier built it in the first
 * place, and the panel offers a reload for the rest rather than flipping a
 * switch that does nothing.
 */
const settingsScreen = createSettingsScreen(container, quality.tier, {
  set(key, on) {
    switch (key) {
      case 'bloom':
      case 'godRays':
      case 'aberration':
        return postFx.setEffect(key, on);
      case 'motes':
        return particles.setMotesVisible(on);
      case 'speedFov':
        // Costs nothing and is always built, so it always takes.
        feel.setEnabled(on);
        return true;
    }
  },
});
// Whatever was chosen last session, applied before the first frame. The tier
// resolution already accounts for the rest; this one is not a tier setting.
feel.setEnabled(effectIsOn('speedFov', quality, storedEffects()));
const startScreen = createStartScreen(container, score, currentMap);
startScreen.onCredits = () => creditsScreen.open();
startScreen.onSettings = () => settingsScreen.open();
startScreen.onIdentityChange = () => {
  // The start screen writes straight into `score` and saves it, so both the
  // wire and the local character read from the same place rather than from
  // arguments that could drift apart.
  net.setIdentity(score.name, appearanceOf(score));
  dressSelf?.(appearanceOf(score));
};
startScreen.onPlay = () => {
  running = true;
  unlockAudio();
  setAmbienceActive(true);
  input.lockOnClick = currentMode === 'play';
  hud.setBest(score.name, bestOn(score, currentMap.id));
  respawnPlayer(player, levelHandle.level.spawn.pos, levelHandle.level.spawn.yaw);
  faceSpawn();
  runMaxHeight = 0;
  hasLanded = false;
};
input.lockOnClick = false;

// Walking into a hub portal is already the decision to play; putting a menu in
// front of them afterwards asks the same question twice. Placed after onPlay is
// assigned, because this runs it.
if (arrivedThroughPortal()) startScreen.startImmediately();

/**
 * Longest a new personal best may go unrecorded while a run continues.
 *
 * A score used to reach the server only when a run ended, so a browser that
 * crashed, a laptop that slept, or simply a long session recorded nothing at
 * all. Sending on every improvement would be a request per frame while
 * climbing, so improvements are banked on this interval instead.
 */
const BEST_SUBMIT_INTERVAL_MS = 4000;
let lastBestSubmit = 0;

/** Record the run so far if it has improved and enough time has passed. */
function trackBest(): void {
  if (runMaxHeight <= bestOn(score, currentMap.id)) return;
  const now = performance.now();
  if (now - lastBestSubmit < BEST_SUBMIT_INTERVAL_MS) return;
  lastBestSubmit = now;
  commitRun();
}

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
  setAmbienceActive(false);
  input.lockOnClick = false;
  if (document.pointerLockElement) document.exitPointerLock();
  startScreen.show();
}

// Escape is the obvious key, but while the pointer is locked the browser eats
// it to release the lock and the page never sees the keypress. So the release
// itself is the signal, and the key handler only covers playing without
// mouse-look, where no lock was ever taken.
document.addEventListener('pointerlockchange', () => {
  // Typing released it on purpose; that is not the end of a run.
  if (!document.pointerLockElement && !chat.isOpen) leaveRun();
});
window.addEventListener('keydown', (e) => {
  // Escape closes whatever is being typed in before it ends the run.
  if (isTypingTarget(e)) return;
  if (e.code === 'Escape') {
    leaveRun();
    return;
  }
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && running && currentMode === 'play') {
    e.preventDefault();
    chat.open();
  }
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
  if (runMaxHeight <= bestOn(score, currentMap.id)) return;
  score.bests[currentMap.id] = runMaxHeight;
  saveScore(score);
  hud.setBest(score.name, bestOn(score, currentMap.id));

  // The shared board is decoration; a failure here must not disturb the run.
  if (leaving) {
    submitScoreBeacon(currentMap.id, score.name, runMaxHeight);
    return;
  }
  void submitScore(currentMap.id, score.name, runMaxHeight).then((scores) => {
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

/**
 * Drop the player onto the route at a given height.
 *
 * Verifying a 183m climb by playing it from the bottom every time is not
 * verification, it is endurance. This finds the foothold whose top surface is
 * nearest the requested height and stands the player on it, so any jump in the
 * level can be reached in one command.
 *
 * Deliberately snaps to a real foothold rather than teleporting to raw
 * coordinates: dropped at an arbitrary point the player just falls, which tells
 * you nothing about the jump you wanted to look at.
 */
function warpTo(height: number): { y: number; from: string } | null {
  let best: { p: (typeof levelHandle.level.placements)[number]; top: number } | null = null;
  for (const p of levelHandle.level.placements) {
    if (p.id !== 'box_stone') continue;
    const top = p.pos[1] + p.scale[1] / 2;
    if (!best || Math.abs(top - height) < Math.abs(best.top - height)) best = { p, top };
  }
  if (!best) return null;
  respawnPlayer(
    player,
    [best.p.pos[0], best.top + FEET_OFFSET + 0.6, best.p.pos[2]],
    levelHandle.level.spawn.yaw,
  );
  // The run is a scoring concept; warping is not a run. Reset it so a warp to
  // 150m does not post a 150m score nobody climbed.
  runMaxHeight = 0;
  hasLanded = false;
  return { y: best.top, from: best.p.uid };
}

/**
 * Warp shortcuts, so a jump at 140m can be looked at without climbing to it.
 *
 * PageUp / PageDown step through the climb; Home returns to the bottom. Held
 * Shift makes the step large, because stepping 20m at a time through 183m is
 * still nine presses.
 */
if (import.meta.env.DEV) {
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e) || currentMode !== 'play') return;
    const big = e.shiftKey ? 3 : 1;
    let target: number | null = null;
    const here = player.currPos.y - FEET_OFFSET;
    if (e.code === 'PageUp') target = here + 15 * big;
    else if (e.code === 'PageDown') target = Math.max(0, here - 15 * big);
    else if (e.code === 'Home') target = 0;
    if (target === null) return;
    e.preventDefault();
    const landed = warpTo(target);
    if (landed) hud.flashRespawn();
  });
}

installDevHandles({
  renderer,
  scene,
  postFx,
  warp: warpTo,
  ruinScale: setRuinScale,
  camera: () => editor?.activeCamera ?? camera,
  level: levelHandle,
  registry,
  dynamics,
  net,
});

startLoop(
  // Simulation — fixed 60Hz. Gameplay decisions live here and nowhere else, so
  // they stay identical on every refresh rate.
  (dt) => {
    if (currentMode === 'play' && running) {
      // Order matters. Platforms move, we ask what the one under the player
      // travelled, and the player's controller applies it together with their
      // own movement in a single resolved step. The carry is deliberately not
      // applied to the body first: the controller reads the collider's position,
      // which a setTranslation does not update until the next world.step, so
      // moving the player up front makes it resolve collisions from a position
      // the player no longer occupies.
      dynamics.step(dt);
      feet.copy(player.currPos);
      feet.y -= FEET_OFFSET;
      const { launch } = dynamics.carry(feet, carryDelta);
      if (launch !== null && player.grounded && player.velocity.y <= 0.01) {
        player.velocity.y = launch;
        player.jumping = false;
        player.jumpTrigger = 0.25;
        playBounce();
      }

      updatePlayer(player, input, dt, followCam.yaw, carryDelta);
      physics.world.step();

      updateFootsteps(Math.hypot(player.velocity.x, player.velocity.z), player.grounded, dt);

      // Read height from the simulation, not the interpolated visual: a
      // respawn must trigger on where the player actually is.
      const height = player.currPos.y - FEET_OFFSET;
      hud.setHeight(height);
      if (player.grounded) hasLanded = true;
      if (hasLanded && height > runMaxHeight) {
        runMaxHeight = height;
        trackBest();
      }

      // killY is a world coordinate, so it is compared against the body rather
      // than the height shown to the player.
      if (player.currPos.y < levelHandle.level.killY) {
        // Splash before the respawn moves them, or it fires at the spawn point.
        // Kept because this fires once per run, on the one moment that is
        // unambiguously worth marking — not on every landing.
        particles.burst(player.currPos, 1.9, 'splash');
        commitRun();
        runMaxHeight = 0;
        hasLanded = false;
        respawnPlayer(player, levelHandle.level.spawn.pos, levelHandle.level.spawn.yaw);
        faceSpawn();
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

        // Landings deliberately produce no camera or particle response; see
        // game/feel.ts for why there is no honest threshold for one here.
        player.landImpact = 0;
        player.launched = false;
        feel.update(
          frameDt,
          Math.hypot(player.velocity.x, player.velocity.z),
          player.velocity.y,
          player.grounded,
        );
        feel.apply(camera);

        focusShadow(sun, player.visualRoot.position);
        // Reported from the interpolated visual rather than the simulation, so
        // what other people see matches what this player sees of themselves.
        net.send({
          p: [
            player.visualRoot.position.x,
            player.visualRoot.position.y - FEET_OFFSET,
            player.visualRoot.position.z,
          ],
          y: player.visualRoot.rotation.y,
          a: player.rig?.current ?? 'idle',
          h: player.currPos.y - FEET_OFFSET,
        });
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

    // Other players keep moving whether or not this one is in a run, so they
    // are still there behind the menu.
    remotePlayers?.update(net.others);
    remotePlayers?.render(frameDt);
    onlinePanel.update(
      running ? { name: score.name, colour: score.colour, height: player.currPos.y - FEET_OFFSET } : null,
      net.others,
      net.connected,
    );

    // Same alpha the player is drawn with. Draw the platforms at the simulation
    // position while the player is interpolated and, above 60Hz, the player
    // visibly shuffles about on a platform they are standing still on.
    dynamics.render(alpha);
    // Aim the light shafts at whichever camera is actually drawing, so they
    // stay correct in the editor's fly cam as well as in play.
    postFx.aimGodRays(editor?.activeCamera ?? camera, sunDirection);
    updateSky(frameDt);
    // Wind runs off accumulated wall-clock rather than the fixed step: it is
    // presentation only, and pausing it with the simulation would freeze the
    // whole forest solid behind the start screen.
    windClock += frameDt;
    vegetation?.update(windClock);
    water?.update(windClock);
    particles.update(windClock, camera.position);
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
