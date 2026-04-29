import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/world';
import type { AssetRegistry, ResolvedAsset } from './registry';
import type { Level, Placement } from './types';

export interface LevelHandle {
  level: Level;
  /** placement uid -> render handle */
  rendered: Map<string, RenderedPlacement>;
}

interface RenderedPlacement {
  placement: Placement;
  group: THREE.Object3D;
  body: RAPIER.RigidBody;
}

export function instantiate(
  scene: THREE.Scene,
  physics: Physics,
  registry: AssetRegistry,
  level: Level,
): LevelHandle {
  const rendered = new Map<string, RenderedPlacement>();
  for (const p of level.placements) {
    const asset = registry.get(p.id);
    if (!asset) {
      console.warn(`[level] missing asset: ${p.id}`);
      continue;
    }
    const r = instantiatePlacement(scene, physics, asset, p);
    rendered.set(p.uid, r);
  }
  return { level, rendered };
}

function instantiatePlacement(
  scene: THREE.Scene,
  physics: Physics,
  asset: ResolvedAsset,
  p: Placement,
): RenderedPlacement {
  const group = new THREE.Group();
  group.add(asset.template.clone(true));
  group.position.set(p.pos[0], p.pos[1], p.pos[2]);
  group.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
  group.scale.set(p.scale[0], p.scale[1], p.scale[2]);
  scene.add(group);

  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(p.pos[0], p.pos[1], p.pos[2])
    .setRotation(quatFromEuler(p.rot));
  const body = physics.world.createRigidBody(bodyDesc);

  if (asset.def.kind === 'primitive' && asset.def.shape === 'box') {
    const halfX = (p.scale[0] * 1) / 2;
    const halfY = (p.scale[1] * 1) / 2;
    const halfZ = (p.scale[2] * 1) / 2;
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ), body);
  } else if (asset.def.kind === 'gltf') {
    // collider sizing from bbox * scale
    const size = new THREE.Vector3();
    asset.bbox.getSize(size);
    if (asset.def.collider === 'box') {
      const hx = (size.x * p.scale[0]) / 2;
      const hy = (size.y * p.scale[1]) / 2;
      const hz = (size.z * p.scale[2]) / 2;
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), body);
    } else if (asset.def.collider === 'trimesh' || asset.def.collider === 'convex') {
      const { vertices, indices } = collectMeshGeometry(asset.template, p.scale);
      const desc = asset.def.collider === 'trimesh'
        ? RAPIER.ColliderDesc.trimesh(vertices, indices)
        : RAPIER.ColliderDesc.convexHull(vertices) ?? RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
      physics.world.createCollider(desc, body);
    }
  }

  return { placement: p, group, body };
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

export async function loadLevel(url: string): Promise<Level> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`level ${url}: ${res.status}`);
  return (await res.json()) as Level;
}
