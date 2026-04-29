import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './world';

export interface CharacterBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  halfHeight: number;
  radius: number;
}

export function createCharacter(physics: Physics, position = { x: 0, y: 5, z: 0 }): CharacterBody {
  const { RAPIER, world } = physics;

  const radius = 0.4;
  const halfHeight = 0.6;

  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(position.x, position.y, position.z);
  const body = world.createRigidBody(bodyDesc);

  const colDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
  const collider = world.createCollider(colDesc, body);

  const controller = world.createCharacterController(0.01);
  controller.enableAutostep(0.5, 0.2, true);
  controller.enableSnapToGround(0.5);
  controller.setApplyImpulsesToDynamicBodies(false);
  controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
  controller.setSlideEnabled(true);
  controller.setUp({ x: 0, y: 1, z: 0 });

  return { body, collider, controller, halfHeight, radius };
}
