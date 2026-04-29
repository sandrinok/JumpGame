import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createGround, createScene } from './render/scene';
import { startLoop } from './core/loop';

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = createRenderer(container);
const camera = createCamera(container);
const scene = createScene();
createGround(scene);
handleResize(renderer, camera, container);

startLoop(
  (_dt) => {
    // physics + game logic (later)
  },
  () => {
    renderer.render(scene, camera);
  },
);
