export type Vec3 = [number, number, number];

/**
 * What a placement *does*, beyond sitting there.
 *
 * Absent means static, so every level authored before this existed still loads
 * and behaves identically.
 */
export type PlacementKind = 'moving' | 'crumbling' | 'bounce' | 'rotating';

export interface PlacementMotion {
  /** World-space offset from `pos` at the far end of the travel. */
  to: Vec3;
  /** Seconds for one full there-and-back cycle. */
  period: number;
  /** 0..1 offset into the cycle, so a row of platforms is not in lockstep. */
  phase?: number;
}

export interface Placement {
  /** asset id from registry */
  id: string;
  /** unique per placement, useful for editor selection + level diff */
  uid: string;
  pos: Vec3;
  /** Euler XYZ in radians */
  rot: Vec3;
  scale: Vec3;
  /** Behaviour. Omitted for ordinary static geometry. */
  kind?: PlacementKind;
  /** For 'moving': where and how fast. */
  motion?: PlacementMotion;
  /** For 'rotating': radians per second about Y. */
  spin?: number;
  /** For 'crumbling': seconds of contact before it gives way. */
  fuse?: number;
  /** For 'bounce': launch speed in m/s, replacing the player's jump velocity. */
  launch?: number;
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
