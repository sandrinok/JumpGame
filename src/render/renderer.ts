import * as THREE from 'three';

export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // The sky is a physical-scattering shader emitting true HDR radiance, which
  // is far brighter than the flat colour it replaced. Exposure is the master
  // control for the whole scene now; at 1.0 the sky blows out to white and the
  // shading goes flat.
  renderer.toneMappingExposure = 0.5;
  // The render loop resets these once per frame; see main.ts. Left on auto,
  // every pass of the post-processing chain would wipe the previous one's
  // numbers before anything could read them.
  renderer.info.autoReset = false;
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createCamera(container: HTMLElement): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);
  return camera;
}

export function handleResize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, container: HTMLElement): void {
  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
}
