import * as THREE from 'three';

/** Half-size of the sun's shadow frustum, in world units, around the focus point. */
const SHADOW_EXTENT = 22;
const SHADOW_MAP_SIZE = 2048;
/** Where the sun sits relative to whatever it is currently focused on. */
const SUN_OFFSET = new THREE.Vector3(40, 70, 25);

export interface SceneSetup {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createScene(): SceneSetup {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ec8e6);
  scene.fog = new THREE.Fog(0xb6d4ea, 100, 400);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x222018, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
  sun.position.copy(SUN_OFFSET);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const cam = sun.shadow.camera;
  cam.left = -SHADOW_EXTENT;
  cam.right = SHADOW_EXTENT;
  cam.top = SHADOW_EXTENT;
  cam.bottom = -SHADOW_EXTENT;
  cam.near = 1;
  cam.far = 250;
  cam.updateProjectionMatrix();
  // Enough bias to kill acne on the big flat ground, small enough that the
  // character's contact shadow stays attached to its feet — that shadow is the
  // cue you judge a landing by.
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x6688aa, 0.25);
  fill.position.set(-40, 30, -20);
  scene.add(fill);

  return { scene, sun };
}

/**
 * Keep the shadow frustum centred on the player. A directional light covering
 * the whole 400x400 world would need a frustum so large that the shadow under
 * the character — the one telling you where you will land — would be a couple
 * of texels wide. Moving the light with the player keeps it sharp instead.
 */
export function focusShadow(sun: THREE.DirectionalLight, focus: THREE.Vector3): void {
  sun.target.position.copy(focus);
  sun.target.updateMatrixWorld();
  sun.position.copy(focus).add(SUN_OFFSET);
}

export function createGround(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(400, 400);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4c6a3a, roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
