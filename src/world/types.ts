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
}

export interface ColliderParams {
  /** override the auto-derived size (world units) */
  size?: Vec3;
  /** local offset relative to placement origin */
  offset?: Vec3;
  /** local rotation relative to placement (Euler XYZ, radians) */
  rot?: Vec3;
}

/** Per-asset collider configuration that applies to every placement of that asset. */
export interface AssetColliderOverride {
  collider?: ColliderShape;
  params?: ColliderParams;
}

export interface Level {
  spawn: { pos: Vec3; yaw: number };
  killY: number;
  placements: Placement[];
  /** Editor-authored collider overrides keyed by asset id; applies to all instances. */
  assetOverrides?: Record<string, AssetColliderOverride>;
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
