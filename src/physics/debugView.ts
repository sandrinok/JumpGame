import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './world';

export type DebugMode = 'off' | 'wire' | 'solid' | 'both';

const MODE_ORDER: DebugMode[] = ['off', 'wire', 'solid', 'both'];

const SOLID_OPACITY = 0.32;
const SOLID_COLOR = 0x44d3ff;
const WIRE_COLOR = 0x66ff99;

/**
 * Renders Rapier colliders as wireframe and / or translucent solids per shape.
 * Walks the collider set and emits one Three mesh per collider, so individual
 * colliders can be excluded (e.g. the ground plane).
 */
export class PhysicsDebugView {
  mode: DebugMode = 'off';
  private wireGroup: THREE.Group;
  private solidGroup: THREE.Group;
  private solidMaterial: THREE.MeshBasicMaterial;
  private wireMaterial: THREE.LineBasicMaterial;
  private excluded = new Set<number>();

  constructor(scene: THREE.Scene, private physics: Physics) {
    this.wireGroup = new THREE.Group();
    this.wireGroup.visible = false;
    this.wireGroup.renderOrder = 999;
    scene.add(this.wireGroup);

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
    this.wireMaterial = new THREE.LineBasicMaterial({
      color: WIRE_COLOR,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
  }

  /** Hide a specific collider from the debug view (e.g. the world ground). */
  exclude(collider: RAPIER.Collider): void {
    this.excluded.add(collider.handle);
  }

  setMode(m: DebugMode): void {
    this.mode = m;
    this.wireGroup.visible = m === 'wire' || m === 'both';
    this.solidGroup.visible = m === 'solid' || m === 'both';
    if (!this.wireGroup.visible) this.disposeGroup(this.wireGroup);
    if (!this.solidGroup.visible) this.disposeGroup(this.solidGroup);
  }

  cycle(): void {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length];
    this.setMode(next);
  }

  toggle(): void {
    this.cycle();
  }

  update(): void {
    if (!this.wireGroup.visible && !this.solidGroup.visible) return;

    this.disposeGroup(this.wireGroup);
    this.disposeGroup(this.solidGroup);

    const colliders = this.physics.world.colliders;
    const n = colliders.len();
    for (let i = 0; i < n; i++) {
      const c = colliders.get(i);
      if (!c) continue;
      if (this.excluded.has(c.handle)) continue;
      const geo = this.buildGeometry(c);
      if (!geo) continue;
      const t = c.translation();
      const r = c.rotation();

      if (this.solidGroup.visible) {
        const mesh = new THREE.Mesh(geo, this.solidMaterial);
        mesh.position.set(t.x, t.y, t.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
        this.solidGroup.add(mesh);
      }
      if (this.wireGroup.visible) {
        const edges = new THREE.EdgesGeometry(geo, 20);
        const lines = new THREE.LineSegments(edges, this.wireMaterial);
        lines.position.set(t.x, t.y, t.z);
        lines.quaternion.set(r.x, r.y, r.z, r.w);
        this.wireGroup.add(lines);
        // EdgesGeometry holds its own buffers; we'll dispose on next frame.
      }
      // If only wire is shown we still need the source geo disposed
      if (!this.solidGroup.visible) geo.dispose();
    }
  }

  private disposeGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const c = group.children[0] as THREE.Mesh | THREE.LineSegments;
      c.geometry.dispose();
      group.remove(c);
    }
  }

  private buildGeometry(c: RAPIER.Collider): THREE.BufferGeometry | null {
    const shape = c.shape;
    if (shape instanceof RAPIER.Cuboid) {
      const h = shape.halfExtents;
      return new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2);
    }
    if (shape instanceof RAPIER.Ball) return new THREE.SphereGeometry(shape.radius, 16, 12);
    if (shape instanceof RAPIER.Cylinder) return new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 24);
    if (shape instanceof RAPIER.Capsule) return new THREE.CapsuleGeometry(shape.radius, shape.halfHeight * 2, 8, 16);
    if (shape instanceof RAPIER.Cone) return new THREE.ConeGeometry(shape.radius, shape.halfHeight * 2, 24);
    if (shape instanceof RAPIER.TriMesh || shape instanceof RAPIER.ConvexPolyhedron) {
      const verts = shape.vertices;
      const idx = shape.indices;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      if (idx) geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeVertexNormals();
      return geo;
    }
    return null;
  }
}
