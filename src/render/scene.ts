import * as THREE from 'three';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ec8e6);
  scene.fog = new THREE.Fog(0xb6d4ea, 100, 400);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x222018, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
  sun.position.set(60, 120, 40);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x6688aa, 0.25);
  fill.position.set(-40, 30, -20);
  scene.add(fill);

  return scene;
}

export function createGround(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(400, 400);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4c6a3a, roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  return mesh;
}
