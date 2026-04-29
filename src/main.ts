import { createCamera, createRenderer, handleResize } from './render/renderer';
import { createGround, createScene } from './render/scene';
import { startLoop } from './core/loop';
import { addStaticGround, initPhysics } from './physics/world';
import { createCharacter } from './physics/character';
import { createPlayerMesh, syncPlayerMesh, type Player } from './game/player';

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

const renderer = createRenderer(container);
const camera = createCamera(container);
const scene = createScene();
createGround(scene);
handleResize(renderer, camera, container);

const physics = await initPhysics();
addStaticGround(physics);

const character = createCharacter(physics, { x: 0, y: 5, z: 0 });
const playerMesh = createPlayerMesh(scene, character);
const player: Player = { body: character, mesh: playerMesh, velocityY: 0 };

const GRAVITY = -25;

startLoop(
  (dt) => {
    player.velocityY += GRAVITY * dt;
    const desired = { x: 0, y: player.velocityY * dt, z: 0 };
    character.controller.computeColliderMovement(character.collider, desired);
    const corrected = character.controller.computedMovement();
    const t = character.body.translation();
    character.body.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
      z: t.z + corrected.z,
    });
    if (character.controller.computedGrounded()) player.velocityY = 0;

    physics.world.step();
    syncPlayerMesh(player);
  },
  () => {
    renderer.render(scene, camera);
  },
);
