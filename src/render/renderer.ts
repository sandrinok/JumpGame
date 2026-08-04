import * as THREE from 'three';
import type { QualitySettings } from './quality';

export function createRenderer(container: HTMLElement, quality: QualitySettings): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    // Not a typo. Every pixel of scene geometry is drawn into the composer's
    // own multisampled HDR target, and all the canvas ever receives is one
    // fullscreen quad from the output pass. Antialiasing the canvas allocates a
    // second multisampled framebuffer the size of the screen and resolves it
    // every frame, to smooth the edges of a quad that has none.
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.maxPixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  // three 0.185 deprecated PCFSoftShadowMap and silently falls back to hard
  // PCF, so asking for it is a no-op that looks like a setting. VSM keeps genuinely
  // soft edges, which is what dappled light through a canopy needs — the
  // shadow of a leaf has no business having a crisp border.
  //
  // It is also the one shadow setting with a real per-frame cost rather than a
  // per-allocation one: VSM blurs its map in two extra fullscreen passes, and
  // the light here follows the player, so the map is rebuilt and reblurred
  // every single frame. The lower tiers take hard PCF instead — the shadow
  // under the player's feet, which is what a landing is judged by, is still
  // there; it just has a crisp edge.
  renderer.shadowMap.type = quality.softShadows ? THREE.VSMShadowMap : THREE.PCFShadowMap;
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
