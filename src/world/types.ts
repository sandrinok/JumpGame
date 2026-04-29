export type Vec3 = [number, number, number];

export interface Placement {
  /** asset id from registry */
  id: string;
  /** unique per placement, useful for editor selection + level diff */
  uid: string;
  pos: Vec3;
  /** Euler XYZ in radians */
  rot: Vec3;
  scale: Vec3;
  /** optional per-placement collider override (gltf assets only) */
  collider?: ColliderShape;
}

export interface Level {
  spawn: { pos: Vec3; yaw: number };
  killY: number;
  placements: Placement[];
}

export type ColliderShape =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'capsule'
  | 'cone'
  | 'convex'
  | 'trimesh';

export interface PrimitiveAsset {
  kind: 'primitive';
  shape: 'box';
  color: number;
  /** physics shape always matches visual */
}

export interface GltfAsset {
  kind: 'gltf';
  url: string;
  collider: ColliderShape;
  /** auto-set on first load: bbox of base mesh, used as collider hint */
}

export type AssetDef = PrimitiveAsset | GltfAsset;

export interface ManifestEntry {
  id: string;
  asset: AssetDef;
  tags?: string[];
}

export interface Manifest {
  version: 1;
  entries: ManifestEntry[];
}
