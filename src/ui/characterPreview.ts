import * as THREE from 'three';
import {
  createAppearance,
  DEFAULT_APPEARANCE,
  type Appearance,
  type ApplyAppearance,
} from '../game/character/appearance';
import { createCharacterRig, loadCharacterSource } from '../game/character/rig';

export interface CharacterPreview {
  element: HTMLElement;
  /** Show what these choices look like. Cheap to call on every keystroke. */
  setAppearance(appearance: Appearance): void;
  /** Begin drawing. Idempotent. */
  start(): void;
  /** Stop drawing and release the animation frame. Idempotent. */
  stop(): void;
}

/** Height the character is scaled to, in this scene's own units. */
const FRAME_HEIGHT = 2.35;
/** Vertical field of view. Narrow, so the figure is not barrel-distorted. */
const FOV = 30;
/** Headroom above and below the figure, as a fraction of its height. */
const MARGIN = 0.12;
/**
 * Where the turntable starts: very slightly off square, so the figure reads as
 * standing in a space rather than as a flat elevation drawing.
 */
const START_YAW = 0.12;

/**
 * The character, turning slowly, wearing whatever is currently chosen.
 *
 * There is no way to judge a shirt colour from a swatch, and the alternative —
 * start a run, look down, come back — is three steps too many for something a
 * player will fiddle with for a minute before their first game. So the model is
 * here on the same screen as the fields that change it.
 *
 * It runs its own tiny renderer rather than borrowing the game's. Sharing would
 * mean either a second pass over the main framebuffer with a different camera
 * and scissor, or swapping the scene out and back every frame — both of them
 * entanglements between the menu and the render loop, for something that only
 * exists while the game is deliberately doing nothing else.
 */
export function createCharacterPreview(width: number, height: number): CharacterPreview {
  const element = document.createElement('div');
  element.style.cssText = `
    width: ${width}px; height: ${height}px; position: relative;
    border-radius: 8px; overflow: hidden; cursor: grab;
    background: linear-gradient(180deg, #23232e 0%, #14141c 100%);
    border: 1px solid #333;
  `;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Not the game's 0.5: there is no HDR sky in here to hold back, so the same
  // exposure would render a silhouette.
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.cssText = 'display: block; width: 100%; height: 100%;';
  element.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 50);

  /*
   * Three lights and no environment map. The game lights characters off a
   * prefiltered sky, which is the right answer out there and far too much
   * machinery for a 200px box — a PMREM pass and a sky shader to render one
   * standing figure. A key, a fill and a rim get a person read clearly, which
   * is all this has to do.
   */
  const key = new THREE.DirectionalLight(0xfff2e2, 2.6);
  key.position.set(2.5, 3.5, 4);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.9);
  fill.position.set(-3, 1, 2);
  const rim = new THREE.DirectionalLight(0xffffff, 1.6);
  rim.position.set(-1.5, 2.5, -4);
  scene.add(key, fill, rim, new THREE.HemisphereLight(0xcfe6ff, 0x2a2a33, 0.5));

  const turntable = new THREE.Group();
  turntable.rotation.y = START_YAW;
  scene.add(turntable);

  let dress: ApplyAppearance | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let pending: Appearance = { ...DEFAULT_APPEARANCE };
  let running = false;
  let frame = 0;
  let last = 0;
  let dragging = false;
  let dragFrom = 0;
  let yawFrom = 0;

  void loadCharacterSource('/assets/character/player.glb', '/assets/character/animations.glb')
    .then((source) => {
      // The same cache the game and the remote avatars use, so opening the menu
      // costs no download of its own.
      const rig = createCharacterRig(source);
      rig.root.traverse((o) => {
        // Nothing casts or receives here; there is no shadow map in this scene.
        (o as THREE.Mesh).castShadow = false;
      });

      const bounds = new THREE.Box3().setFromObject(rig.root);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = size.y > 0.0001 ? FRAME_HEIGHT / size.y : 1;
      rig.root.scale.setScalar(scale);
      rig.root.position.y = -bounds.min.y * scale;
      turntable.add(rig.root);

      mixer = rig.mixer;
      dress = createAppearance(rig.root);
      dress(pending);

      // The whole figure, head to feet. Worked out from the framing rather than
      // dialled in by eye, so changing FOV or MARGIN cannot silently crop the
      // head off.
      const fit = FRAME_HEIGHT * (1 + MARGIN * 2);
      const distance = fit / 2 / Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
      const centre = FRAME_HEIGHT * 0.5;
      camera.position.set(0, centre, distance);
      camera.lookAt(0, centre, 0);
    })
    .catch((e) => console.warn('[preview] character unavailable:', e));

  const tick = (now: number): void => {
    if (!running) return;
    frame = requestAnimationFrame(tick);
    const dt = last === 0 ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    mixer?.update(dt);
    // No turntable drift. It reads as showmanship for about five seconds and
    // then becomes an obstacle: every time you want to look at the print you
    // have to wait for it to come back round.
    renderer.render(scene, camera);
  };

  element.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragFrom = e.clientX;
    yawFrom = turntable.rotation.y;
    element.style.cursor = 'grabbing';
    element.setPointerCapture(e.pointerId);
  });
  element.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    turntable.rotation.y = yawFrom + (e.clientX - dragFrom) * 0.012;
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    element.style.cursor = 'grab';
    element.releasePointerCapture(e.pointerId);
  };
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);

  return {
    element,
    setAppearance(appearance) {
      pending = { ...appearance };
      dress?.(pending);
    },
    start() {
      if (running) return;
      running = true;
      last = 0;
      frame = requestAnimationFrame(tick);
    },
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(frame);
    },
  };
}
