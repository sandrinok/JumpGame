import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
  private gltfLoader = new GLTFLoader();

  get(id: string): ResolvedAsset | undefined {
    return this.byId.get(id);
  }

  all(): ResolvedAsset[] {
    return [...this.byId.values()];
  }

  async loadManifest(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`manifest ${url}: ${res.status}`);
    const manifest = (await res.json()) as Manifest;
    await Promise.all(manifest.entries.map((e) => this.resolveEntry(e)));
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
