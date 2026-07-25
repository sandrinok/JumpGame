import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AssetDef, Manifest, ManifestEntry } from './types';

export interface ResolvedAsset {
  id: string;
  def: AssetDef;
  /** unit-sized template geometry (for primitives) or root scene (for glTF) */
  template: THREE.Object3D;
  /** axis-aligned bbox of template at unit scale, used for collider sizing */
  bbox: THREE.Box3;
}

export class AssetRegistry {
  private byId = new Map<string, ResolvedAsset>();
  private gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  /** Manifest entries that have not been downloaded yet. */
  private pending = new Map<string, ManifestEntry>();

  get(id: string): ResolvedAsset | undefined {
    return this.byId.get(id);
  }

  all(): ResolvedAsset[] {
    return [...this.byId.values()];
  }

  /**
   * Read the manifest without downloading anything.
   *
   * Resolving every entry up front meant a player waited on the whole asset
   * library — around 9MB across 130 files — before the game could start, when
   * a level uses a handful of them and the rest exist only for the editor's
   * palette. Call resolveIds() for what a level needs, resolveAll() when the
   * editor opens.
   */
  async loadManifest(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`manifest ${url}: ${res.status}`);
    const manifest = (await res.json()) as Manifest;
    for (const entry of manifest.entries) this.pending.set(entry.id, entry);
  }

  /** Download and prepare specific assets. Already-resolved ids are skipped. */
  async resolveIds(ids: Iterable<string>): Promise<void> {
    const todo = [...new Set(ids)].filter((id) => !this.byId.has(id) && this.pending.has(id));
    await Promise.all(todo.map((id) => this.resolveEntry(this.pending.get(id)!)));
  }

  /** Download everything the manifest lists. Used by the editor palette. */
  async resolveAll(): Promise<void> {
    await this.resolveIds(this.pending.keys());
  }

  /** Ids known to the manifest, resolved or not. */
  knownIds(): string[] {
    return [...this.pending.keys()];
  }

  /** Add an asset from a parsed gltf scene (e.g., from drag-drop) */
  addGltfFromScene(id: string, root: THREE.Object3D, collider: 'box' | 'trimesh' | 'convex' = 'trimesh'): ResolvedAsset {
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);
    const def: AssetDef = { kind: 'gltf', url: `mem:${id}`, collider };
    const resolved: ResolvedAsset = { id, def, template: root, bbox };
    this.byId.set(id, resolved);
    return resolved;
  }

  /** Parse a GLB ArrayBuffer and register it. */
  async addGltfFromArrayBuffer(id: string, buffer: ArrayBuffer, collider: 'box' | 'trimesh' | 'convex' = 'trimesh'): Promise<ResolvedAsset> {
    const gltf = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
      this.gltfLoader.parse(buffer, '', (g) => resolve(g as unknown as { scene: THREE.Object3D }), reject);
    });
    return this.addGltfFromScene(id, gltf.scene, collider);
  }

  private async resolveEntry(entry: ManifestEntry): Promise<void> {
    const asset = entry.asset;
    if (asset.kind === 'primitive') {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({ color: asset.color, roughness: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      const bbox = new THREE.Box3().setFromObject(mesh);
      this.byId.set(entry.id, { id: entry.id, def: asset, template: mesh, bbox });
      return;
    }
    const gltf = await this.gltfLoader.loadAsync(asset.url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);
    this.byId.set(entry.id, { id: entry.id, def: asset, template: root, bbox });
  }
}
