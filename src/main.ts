import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createGround, createScene } from './render/scene';
import { FollowCamera } from './render/followCamera';
import { startLoop } from './core/loop';
import { Input } from './core/input';
import { addStaticGround, initPhysics } from './physics/world';
import { createCharacter } from './physics/character';
import { attachCharacterRig, createPlayer, respawnPlayer, updatePlayer } from './game/player';
import { AssetRegistry } from './world/registry';
import { instantiate, loadLevel } from './world/level';
import { createHud } from './ui/hud';
import { loadScore, saveScore } from './persistence/score';
import { Editor } from './editor/editor';
import { createPalette } from './editor/palette';

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = createRenderer(container);
const camera = createCamera(container);
const scene = createScene();
createGround(scene);

const input = new Input(renderer.domElement);
const followCam = new FollowCamera(camera);

const physics = await initPhysics();
addStaticGround(physics);

const registry = new AssetRegistry();
await registry.loadManifest('/assets/manifest.json');
const level = await loadLevel('/levels/dev.json');
const levelHandle = instantiate(scene, physics, registry, level);

const character = createCharacter(physics, {
  x: levelHandle.level.spawn.pos[0],
  y: levelHandle.level.spawn.pos[1],
  z: levelHandle.level.spawn.pos[2],
});
const player = createPlayer(scene, character);
attachCharacterRig(player, '/assets/character/Soldier.glb').catch((e) => {
  console.warn('Character rig failed to load, using debug capsule:', e);
});

const hud = createHud(container);
const score = loadScore();
hud.setBest(score.name, score.best);
let runMaxHeight = 0;

const editor = new Editor(renderer, scene, camera, levelHandle, registry);
editor.palette = createPalette(container, registry);
editor.onModeChange = (mode) => {
  input.lockOnClick = mode === 'play';
};

handleResize(renderer, camera, container);
window.addEventListener('resize', () => {
  editor.onResize(container.clientWidth / container.clientHeight);
});

startLoop(
  (dt) => {
    if (editor.mode === 'play') {
      updatePlayer(player, input, dt, followCam.yaw);
      physics.world.step();
      followCam.update(input, player.visualRoot.position);

      const y = player.visualRoot.position.y;
      hud.setHeight(y);
      if (y > runMaxHeight) runMaxHeight = y;

      if (y < levelHandle.level.killY) {
        if (runMaxHeight > score.best) {
          score.best = runMaxHeight;
          saveScore(score);
          hud.setBest(score.name, score.best);
        }
        runMaxHeight = 0;
        respawnPlayer(player, levelHandle.level.spawn.pos, levelHandle.level.spawn.yaw);
        hud.flashRespawn();
      }
    } else {
      editor.update();
    }
    input.endFrame();
  },
  () => {
    renderer.render(scene, editor.activeCamera);
  },
);
