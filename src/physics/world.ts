import RAPIER from '@dimforge/rapier3d-compat';

export interface Physics {
  RAPIER: typeof RAPIER;
  world: RAPIER.World;
}

export async function initPhysics(): Promise<Physics> {
  await RAPIER.init();
  const gravity = { x: 0, y: -25, z: 0 };
  const world = new RAPIER.World(gravity);
  return { RAPIER, world };
}

export function addStaticGround(physics: Physics, size = 200): void {
  const { RAPIER, world } = physics;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
  const half = size / 2;
  world.createCollider(RAPIER.ColliderDesc.cuboid(half, 0.05, half).setTranslation(0, -0.05, 0), body);
}
