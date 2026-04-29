import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createGround, createScene } from './render/scene';
import { FollowCamera } from './render/followCamera';
import { startLoop } from './core/loop';
import { Input } from './core/input';
import { addStaticGround, initPhysics } from './physics/world';
import { createCharacter } from './physics/character';
import { createPlayer, updatePlayer } from './game/player';

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

const character = createCharacter(physics, { x: 0, y: 5, z: 0 });
const player = createPlayer(scene, character);

startLoop(
  (dt) => {
    updatePlayer(player, input, dt, followCam.yaw);
    physics.world.step();
    followCam.update(input, player.mesh.position);
    input.endFrame();
  },
  () => {
    renderer.render(scene, camera);
  },
);
