import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ResolvedAsset } from '../world/registry';

/**
 * Small rendered previews of each asset, for the palette.
 *
 * The palette was a column of a hundred and forty identifiers, and no amount of
 * naming discipline makes `apoc_object_2` mean anything. A picture of the thing
 * is the only description that works.
 *
 * These are rendered in the browser rather than generated ahead of time and
 * committed. By the time the palette exists the editor has already downloaded
 * and parsed every asset — the geometry is sitting in memory — so nothing can
 * drift out of sync with the assets the way a folder of checked-in PNGs would.
 * It is the same reason the credits are derived from the files rather than
 * maintained by hand.
 */

/** Edge length of a preview, in CSS pixels before DPI scaling. */
const SIZE = 96;
/** How much of the frame the asset fills. Below 1 to leave a little air. */
const FILL = 0.82;
/**
 * Where the camera sits, as a direction. Three-quarter view from slightly
 * above: straight-on hides depth, and straight-down makes everything a blob.
 */
const VIEW_DIRECTION = new THREE.Vector3(1, 0.55, 1).normalize();
/**
 * Where to look from for something flat.
 *
 * Around fifteen assets are essentially planes — road tiles, a carpet, a
 * poster — and from the three-quarter view above they are a sliver a few pixels
 * tall. Leaning towards the top-down view shows the face, which is the only
 * part of them there is.
 */
const FLAT_VIEW_DIRECTION = new THREE.Vector3(0.35, 1, 0.35).normalize();
/** Thinner than this fraction of its longest side and an asset counts as flat. */
const FLATNESS = 0.08;

export interface ThumbnailMaker {
  /** A data URL for this asset, rendered on first request and then cached. */
  get(asset: ResolvedAsset): Promise<string>;
  dispose(): void;
}

export function createThumbnailMaker(): ThumbnailMaker {
  const cache = new Map<string, Promise<string>>();

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    // toDataURL reads the drawing buffer, which the browser is free to discard
    // straight after a render unless it is told to keep it.
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(SIZE, SIZE);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  // A neutral studio environment, so metal and gloss have something to reflect.
  // Without it anything metallic renders as a black silhouette, which for a
  // library full of pipes, tools and vehicles is most of it.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const scene = new THREE.Scene();
  scene.environment = environment;
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 3, 2);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const holder = new THREE.Group();
  scene.add(holder);

  const centre = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const size = new THREE.Vector3();

  /**
   * One preview at a time.
   *
   * The scene, camera and holder are shared, so two of these running at once
   * would photograph each other's models. Chaining costs nothing here: the work
   * is a fraction of a millisecond once the shaders exist.
   */
  let queue: Promise<unknown> = Promise.resolve();

  async function render(asset: ResolvedAsset): Promise<string> {
    // clone(true) shares geometry and materials with the registry's template,
    // which is what makes this cheap — nothing is uploaded to the GPU twice.
    const model = asset.template.clone(true);
    holder.add(model);
    try {
      // Frame from the asset's own bounds. Models arrive at wildly different
      // scales — some are a metre tall, the crane is over a thousand — so a
      // fixed camera distance would show either a speck or an interior.
      const box = new THREE.Box3().setFromObject(model);
      box.getBoundingSphere(sphere);
      box.getCenter(centre);
      const radius = Math.max(sphere.radius, 0.0001);
      const distance = radius / (FILL * Math.tan((camera.fov * Math.PI) / 360));

      const extent = box.getSize(size);
      const longest = Math.max(extent.x, extent.y, extent.z);
      const shortest = Math.min(extent.x, extent.y, extent.z);
      const direction = shortest < longest * FLATNESS ? FLAT_VIEW_DIRECTION : VIEW_DIRECTION;
      camera.position.copy(direction).multiplyScalar(distance).add(centre);
      camera.near = Math.max(distance - radius * 2, distance / 100);
      camera.far = distance + radius * 4;
      camera.updateProjectionMatrix();
      camera.lookAt(centre);

      // Almost the entire cost of a preview is compiling that asset's shaders
      // the first time they are used: measured at 49ms for the first render of
      // a model and 0ms for the second. Done inside render() that is a dropped
      // frame per tile, which is exactly when someone is scrolling the palette.
      // compileAsync hands it to the driver's parallel compiler instead, and
      // what is left to do on the main thread is a third of a millisecond.
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } finally {
      holder.remove(model);
    }
  }

  return {
    get(asset) {
      const cached = cache.get(asset.id);
      if (cached) return cached;
      // The promise is cached, not the result, so two tiles asking for the same
      // asset at once share one render instead of racing.
      const pending = queue.then(() => render(asset));
      cache.set(asset.id, pending);
      // A failure must not wedge the queue for everything behind it.
      queue = pending.catch(() => undefined);
      return pending;
    },

    dispose() {
      // Only what this module made. The models were clones sharing the
      // registry's geometry and materials, and disposing those would blank out
      // every placed copy in the level.
      environment.dispose();
      renderer.dispose();
      cache.clear();
    },
  };
}
