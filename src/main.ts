import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createGround, createScene } from './render/scene';
import { FollowCamera } from './render/followCamera';
import { startLoop } from './core/loop';
import { Input } from './core/input';
import { addStaticGround, initPhysics } from './physics/world';
import { createCharacter } from './physics/character';
import { attachCharacterRig, createPlayer, updatePlayer } from './game/player';
import { AssetRegistry } from './world/registry';
import { instantiate, loadLevel } from './world/level';

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = createRenderer(container);
const camera = createCamera(container);
const scene = createScene();
createGround(scene);
handleResize(renderer, camera, container);

const input = new Input(renderer.domElement);
const followCam = new FollowCamera(camera);

const physics = await initPhysics();
addStaticGround(physics);

const registry = new AssetRegistry();
await registry.loadManifest('/assets/manifest.json');
const level = await loadLevel('/levels/dev.json');
instantiate(scene, physics, registry, level);

const character = createCharacter(physics, {
  x: level.spawn.pos[0],
  y: level.spawn.pos[1],
  z: level.spawn.pos[2],
});
const player = createPlayer(scene, character);
attachCharacterRig(player, '/assets/character/Soldier.glb').catch((e) => {
  console.warn('Character rig failed to load, using debug capsule:', e);
});

startLoop(
  (dt) => {
    updatePlayer(player, input, dt, followCam.yaw);
    physics.world.step();
    followCam.update(input, player.visualRoot.position);
    input.endFrame();
  },
  () => {
    renderer.render(scene, camera);
  },
);
