import * as THREE from 'three';
import type { Input } from '../core/input';

const MIN_PITCH = -Math.PI / 2 + 0.1;
const MAX_PITCH = Math.PI / 2 - 0.1;
const MIN_DIST = 2;
const MAX_DIST = 12;
const MOUSE_SENS = 0.0025;
const ZOOM_STEP = 0.0015;

export class FollowCamera {
  yaw = 0;
  pitch = -0.3;
  distance = 6;
  target = new THREE.Vector3();
  shoulderHeight = 1.4;

  constructor(public camera: THREE.PerspectiveCamera) {}

  update(input: Input, focus: THREE.Vector3): void {
    this.yaw -= input.mouseDX * MOUSE_SENS;
    this.pitch -= input.mouseDY * MOUSE_SENS;
    if (this.pitch < MIN_PITCH) this.pitch = MIN_PITCH;
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;

    if (input.scrollDY !== 0) {
      this.distance += input.scrollDY * ZOOM_STEP;
      if (this.distance < MIN_DIST) this.distance = MIN_DIST;
      if (this.distance > MAX_DIST) this.distance = MAX_DIST;
    }

    this.target.set(focus.x, focus.y + this.shoulderHeight, focus.z);

    const cosP = Math.cos(this.pitch);
    const offX = Math.sin(this.yaw) * cosP * this.distance;
    const offY = -Math.sin(this.pitch) * this.distance;
    const offZ = Math.cos(this.yaw) * cosP * this.distance;

    this.camera.position.set(this.target.x + offX, this.target.y + offY, this.target.z + offZ);
    this.camera.lookAt(this.target);
  }
}
