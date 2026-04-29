import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/world';
import type { AssetRegistry, ResolvedAsset } from './registry';
import type { Level, Placement } from './types';

export interface RenderedPlacement {
  placement: Placement;
  group: THREE.Object3D;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

export class LevelHandle {
  rendered = new Map<string, RenderedPlacement>();

  constructor(
    public level: Level,
    private scene: THREE.Scene,
    private physics: Physics,
    private registry: AssetRegistry,
  ) {}

  addPlacement(p: Placement): RenderedPlacement | null {
    const asset = this.registry.get(p.id);
    if (!asset) {
      console.warn(`[level] missing asset: ${p.id}`);
      return null;
    }
    const r = build(this.scene, this.physics, asset, p);
    this.rendered.set(p.uid, r);
    if (!this.level.placements.includes(p)) this.level.placements.push(p);
    return r;
  }

  removePlacement(uid: string): void {
    const r = this.rendered.get(uid);
    if (!r) return;
    this.scene.remove(r.group);
    disposeObject(r.group);
    this.physics.world.removeRigidBody(r.body);
    this.rendered.delete(uid);
    const i = this.level.placements.findIndex((p) => p.uid === uid);
    if (i >= 0) this.level.placements.splice(i, 1);
  }

  clear(): void {
    for (const uid of [...this.rendered.keys()]) this.removePlacement(uid);
  }

  replace(next: Level): void {
    this.clear();
    this.level = { ...next, placements: [] };
    for (const p of next.placements) this.addPlacement(p);
    this.level.spawn = next.spawn;
    this.level.killY = next.killY;
  }

  updateTransform(uid: string): void {
    const r = this.rendered.get(uid);
    if (!r) return;
    const p = r.placement;
    // refresh visual (already mutated externally — caller writes to placement)
    r.group.position.set(p.pos[0], p.pos[1], p.pos[2]);
    r.group.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    r.group.scale.set(p.scale[0], p.scale[1], p.scale[2]);

    // recreate physics body to reflect new scale/pos/rot
    this.physics.world.removeRigidBody(r.body);
    const asset = this.registry.get(p.id)!;
    const { body, collider } = createBody(this.physics, asset, p);
    r.body = body;
    r.collider = collider;
  }
}

export function instantiate(
  scene: THREE.Scene,
  physics: Physics,
  registry: AssetRegistry,
  level: Level,
): LevelHandle {
  const handle = new LevelHandle(level, scene, physics, registry);
  for (const p of [...level.placements]) {
    // remove from array temporarily so addPlacement doesn't double-push
    const idx = handle.level.placements.indexOf(p);
    if (idx >= 0) handle.level.placements.splice(idx, 1);
    handle.addPlacement(p);
  }
  return handle;
}

function build(
  scene: THREE.Scene,
  physics: Physics,
  asset: ResolvedAsset,
  p: Placement,
): RenderedPlacement {
  const group = new THREE.Group();
  group.userData.uid = p.uid;
  group.add(asset.template.clone(true));
  group.position.set(p.pos[0], p.pos[1], p.pos[2]);
  group.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
  group.scale.set(p.scale[0], p.scale[1], p.scale[2]);
  scene.add(group);

  const { body, collider } = createBody(physics, asset, p);
  return { placement: p, group, body, collider };
}

function createBody(
  physics: Physics,
  asset: ResolvedAsset,
  p: Placement,
): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(p.pos[0], p.pos[1], p.pos[2])
    .setRotation(quatFromEuler(p.rot));
  const body = physics.world.createRigidBody(bodyDesc);

  let colDesc: RAPIER.ColliderDesc;
  if (asset.def.kind === 'primitive' && asset.def.shape === 'box') {
    colDesc = RAPIER.ColliderDesc.cuboid(p.scale[0] / 2, p.scale[1] / 2, p.scale[2] / 2);
  } else if (asset.def.kind === 'gltf') {
    const colliderType = p.collider ?? asset.def.collider;
    const params = p.colliderParams ?? {};
    const bboxSize = new THREE.Vector3();
    asset.bbox.getSize(bboxSize);
    const bboxCenter = new THREE.Vector3();
    asset.bbox.getCenter(bboxCenter);
    const wx = Math.max(0.01, params.size?.[0] ?? bboxSize.x * p.scale[0]);
    const wy = Math.max(0.01, params.size?.[1] ?? bboxSize.y * p.scale[1]);
    const wz = Math.max(0.01, params.size?.[2] ?? bboxSize.z * p.scale[2]);
    const offset = {
      x: params.offset?.[0] ?? bboxCenter.x * p.scale[0],
      y: params.offset?.[1] ?? bboxCenter.y * p.scale[1],
      z: params.offset?.[2] ?? bboxCenter.z * p.scale[2],
    };
    const localRot = params.rot
      ? quatFromEuler(params.rot)
      : null;
    switch (colliderType) {
      case 'box':
        colDesc = RAPIER.ColliderDesc.cuboid(wx / 2, wy / 2, wz / 2);
        break;
      case 'sphere': {
        const r = Math.max(wx, wy, wz) / 2;
        colDesc = RAPIER.ColliderDesc.ball(r);
        break;
      }
      case 'cylinder': {
        const halfH = wy / 2;
        const r = Math.max(wx, wz) / 2;
        colDesc = RAPIER.ColliderDesc.cylinder(halfH, r);
        break;
      }
      case 'capsule': {
        const r = Math.max(wx, wz) / 2;
        const halfH = Math.max(0.01, wy / 2 - r);
        colDesc = RAPIER.ColliderDesc.capsule(halfH, r);
        break;
      }
      case 'cone': {
        const halfH = wy / 2;
        const r = Math.max(wx, wz) / 2;
        colDesc = RAPIER.ColliderDesc.cone(halfH, r);
        break;
      }
      case 'convex':
      case 'trimesh':
      default: {
        const { vertices, indices } = collectMeshGeometry(asset.template, p.scale);
        const built =
          colliderType === 'trimesh'
            ? RAPIER.ColliderDesc.trimesh(vertices, indices)
            : RAPIER.ColliderDesc.convexHull(vertices);
        colDesc = built ?? RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
        break;
      }
    }
    colDesc.setTranslation(offset.x, offset.y, offset.z);
    if (localRot) colDesc.setRotation(localRot);
  } else {
    colDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
  }
  const collider = physics.world.createCollider(colDesc, body);
  return { body, collider };
}

function quatFromEuler(rot: [number, number, number]) {
  const e = new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ');
  const q = new THREE.Quaternion().setFromEuler(e);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function collectMeshGeometry(
  root: THREE.Object3D,
  scale: [number, number, number],
): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  let offset = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const geo = m.geometry;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      verts.push(pos.getX(i) * scale[0], pos.getY(i) * scale[1], pos.getZ(i) * scale[2]);
    }
    const indexAttr = geo.index;
    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i++) idx.push(indexAttr.getX(i) + offset);
    } else {
      for (let i = 0; i < pos.count; i++) idx.push(i + offset);
    }
    offset += pos.count;
  });
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

export async function loadLevel(url: string): Promise<Level> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`level ${url}: ${res.status}`);
  return (await res.json()) as Level;
}
