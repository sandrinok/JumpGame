import * as THREE from 'three';
import type { Input } from '../core/input';

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

const MOUSE_SENS = 0.0025;
const MIN_PITCH = -Math.PI / 2 + 0.05;
const MAX_PITCH = Math.PI / 2 - 0.05;
const SPEED_MIN = 1;
const SPEED_MAX = 200;
const SPEED_STEP = 1.15;
const FAST_MUL = 4;
const SLOW_MUL = 0.25;

/**
 * Unity/Unreal-style editor fly cam.
 * Right-mouse drag enables look (pointer-lock); WASD/QE/Shift move while held.
 * Mouse wheel adjusts movement speed (only while looking, so it doesn't hijack
 * normal page scroll outside the editor).
 */
export class EditorCameraController {
  yaw = 0;
  pitch = 0;
  speed = 10;
  enabled = false;

  private looking = false;
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private move = new THREE.Vector3();
  private accumDX = 0;
  private accumDY = 0;

  constructor(
    public camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    dom.addEventListener('contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.button !== 2) return;
      e.preventDefault();
      this.beginLook();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button !== 2) return;
      if (this.looking) this.endLook();
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.looking) return;
      this.accumDX += e.movementX;
      this.accumDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      const stillLocked = document.pointerLockElement === dom;
      if (this.looking && !stillLocked) this.looking = false;
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled || !this.looking) return;
      e.preventDefault();
      this.speed *= e.deltaY < 0 ? SPEED_STEP : 1 / SPEED_STEP;
      if (this.speed < SPEED_MIN) this.speed = SPEED_MIN;
      if (this.speed > SPEED_MAX) this.speed = SPEED_MAX;
    }, { passive: false });
  }

  /** Initialize yaw/pitch from camera's current world rotation. */
  syncFromCamera(): void {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
  }

  /** Switch which camera the controller drives (e.g. perspective ↔ ortho). */
  setCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
    this.camera = camera as THREE.PerspectiveCamera;
    this.syncFromCamera();
  }

  /** Snap to a canonical axis-aligned view, looking at the world origin. */
  snapToView(view: ViewName, distance = 25): void {
    const eyes: Record<ViewName, [number, number, number, number, number]> = {
      // [posX, posY, posZ, yaw, pitch]
      front:  [0, 0, distance, 0, 0],
      back:   [0, 0, -distance, Math.PI, 0],
      right:  [distance, 0, 0, Math.PI / 2, 0],
      left:   [-distance, 0, 0, -Math.PI / 2, 0],
      top:    [0, distance, 0, 0, -Math.PI / 2 + 0.01],
      bottom: [0, -distance, 0, 0, Math.PI / 2 - 0.01],
    };
    const [x, y, z, yaw, pitch] = eyes[view];
    this.camera.position.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);
  }

  private beginLook(): void {
    this.looking = true;
    this.dom.requestPointerLock();
  }

  private endLook(): void {
    this.looking = false;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  /** Force exit (e.g. on mode change). */
  release(): void {
    if (this.looking) this.endLook();
  }

  update(dt: number, input: Input): void {
    if (!this.enabled) return;

    if (this.accumDX !== 0 || this.accumDY !== 0) {
      this.yaw -= this.accumDX * MOUSE_SENS;
      this.pitch -= this.accumDY * MOUSE_SENS;
      if (this.pitch < MIN_PITCH) this.pitch = MIN_PITCH;
      if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
      this.accumDX = 0;
      this.accumDY = 0;
    }

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);

    if (!this.looking) return;

    this.fwd.set(0, 0, -1).applyQuaternion(q);
    this.right.set(1, 0, 0).applyQuaternion(q);

    const fwdAxis = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const rightAxis = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const upAxis =
      (input.isDown('KeyE') ? 1 : 0) - (input.isDown('KeyQ') ? 1 : 0) +
      (input.isDown('Space') ? 1 : 0) - (input.isDown('ControlLeft') ? 1 : 0);

    if (fwdAxis === 0 && rightAxis === 0 && upAxis === 0) return;

    this.move
      .copy(this.fwd).multiplyScalar(fwdAxis)
      .addScaledVector(this.right, rightAxis)
      .addScaledVector(this.up, upAxis);
    if (this.move.lengthSq() > 1) this.move.normalize();

    let mul = 1;
    if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) mul = FAST_MUL;
    else if (input.isDown('AltLeft') || input.isDown('AltRight')) mul = SLOW_MUL;

    this.move.multiplyScalar(this.speed * mul * dt);
    this.camera.position.add(this.move);
  }
}
