import * as THREE from 'three';
import type { Physics } from './world';

/**
 * Wireframe overlay of all Rapier colliders in the world.
 * Built on world.debugRender() (vertices + RGBA colors); rebuilt every frame
 * while visible. Editor-only: cost is fine for level-building scale.
 */
export class PhysicsDebugView {
  private lines: THREE.LineSegments;
  visible = false;

  constructor(scene: THREE.Scene, private physics: Physics) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.renderOrder = 999;
    this.lines.visible = false;
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.lines.visible = v;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  update(): void {
    if (!this.visible) return;
    const dbg = this.physics.world.debugRender();
    const verts = dbg.vertices;
    const rgba = dbg.colors;
    const rgb = new Float32Array((rgba.length / 4) * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    const geo = this.lines.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    geo.computeBoundingSphere();
  }
}
