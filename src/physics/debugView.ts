import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './world';

export type DebugMode = 'off' | 'wire' | 'solid' | 'both';

const MODE_ORDER: DebugMode[] = ['off', 'wire', 'solid', 'both'];

const SOLID_OPACITY = 0.32;
const SOLID_COLOR = 0x44d3ff;

/**
 * Renders Rapier colliders as wireframe (debugRender lines), translucent
 * solids (per-shape geometry), or both. Editor-only.
 */
export class PhysicsDebugView {
  mode: DebugMode = 'off';
  private wireLines: THREE.LineSegments;
  private solidGroup: THREE.Group;
  private solidMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, private physics: Physics) {
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    wireGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    const wireMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.wireLines = new THREE.LineSegments(wireGeo, wireMat);
    this.wireLines.renderOrder = 999;
    this.wireLines.visible = false;
    this.wireLines.frustumCulled = false;
    scene.add(this.wireLines);

    this.solidGroup = new THREE.Group();
    this.solidGroup.visible = false;
    this.solidGroup.renderOrder = 998;
    scene.add(this.solidGroup);

    this.solidMaterial = new THREE.MeshBasicMaterial({
      color: SOLID_COLOR,
      transparent: true,
      opacity: SOLID_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  setMode(m: DebugMode): void {
    this.mode = m;
    this.wireLines.visible = m === 'wire' || m === 'both';
    this.solidGroup.visible = m === 'solid' || m === 'both';
    if (!this.solidGroup.visible) this.disposeSolids();
  }

  cycle(): void {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length];
    this.setMode(next);
  }

  /** Backward-compat alias kept for the old toggle hotkey path. */
  toggle(): void {
    this.cycle();
  }

  update(): void {
    if (this.wireLines.visible) this.updateWires();
    if (this.solidGroup.visible) this.updateSolids();
  }

  private updateWires(): void {
    const dbg = this.physics.world.debugRender();
    const rgba = dbg.colors;
    const rgb = new Float32Array((rgba.length / 4) * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }
    const geo = this.wireLines.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(dbg.vertices, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    geo.computeBoundingSphere();
  }

  private disposeSolids(): void {
    while (this.solidGroup.children.length > 0) {
      const c = this.solidGroup.children[0] as THREE.Mesh;
      c.geometry.dispose();
      this.solidGroup.remove(c);
    }
  }

  private updateSolids(): void {
    this.disposeSolids();
    const colliders = this.physics.world.colliders;
    const n = colliders.len();
    for (let i = 0; i < n; i++) {
      const c = colliders.get(i);
      if (!c) continue;
      const mesh = this.buildSolidMesh(c);
      if (!mesh) continue;
      const t = c.translation();
      const r = c.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
      this.solidGroup.add(mesh);
    }
  }

  private buildSolidMesh(c: RAPIER.Collider): THREE.Mesh | null {
    const shape = c.shape;
    let geo: THREE.BufferGeometry | null = null;
    if (shape instanceof RAPIER.Cuboid) {
      const h = shape.halfExtents;
      geo = new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2);
    } else if (shape instanceof RAPIER.Ball) {
      geo = new THREE.SphereGeometry(shape.radius, 16, 12);
    } else if (shape instanceof RAPIER.Cylinder) {
      geo = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 24);
    } else if (shape instanceof RAPIER.Capsule) {
      geo = new THREE.CapsuleGeometry(shape.radius, shape.halfHeight * 2, 8, 16);
    } else if (shape instanceof RAPIER.Cone) {
      geo = new THREE.ConeGeometry(shape.radius, shape.halfHeight * 2, 24);
    } else if (shape instanceof RAPIER.TriMesh || shape instanceof RAPIER.ConvexPolyhedron) {
      const verts = shape.vertices;
      const idx = shape.indices;
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      if (idx) geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!geo) return null;
    return new THREE.Mesh(geo, this.solidMaterial);
  }
}
