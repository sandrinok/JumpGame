import * as THREE from 'three';
import { createRuinMaterial, type RuinMaterialOptions } from '../render/ruinMaterial';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AssetDef, Manifest, ManifestEntry } from './types';

/**
 * Which primitive ids get the ruin treatment, and how far gone each one is.
 *
 * box_stone is the load-bearing floor slab the player lands on, so it takes the
 * most moss — the green reads as "you can stand here". box_wood is the
 * supporting mass under the slabs and the Spine: darker, wetter, further into
 * shadow, and much less overgrown so it never competes with a foothold.
 */
const RUIN_SURFACES: Record<string, RuinMaterialOptions> = {
  // Deliberately the lightest thing in the palette. Once contrast went into the
  // grade, a darker slab collapsed into a black silhouette against the jungle —
  // and this is the one surface the player has to read to judge a jump. The
  // foothold has to stay the most legible object in the frame.
  box_stone: { base: 0x777063, moss: 0.9, damp: 0.95 },
  box_wood: { base: 0x413b33, moss: 0.4, damp: 1.3 },
};

/**
 * Age an imported asset into the world it has been dropped into.
 *
 * Everything in the library was authored as a clean, saturated, brand-new
 * object — a construction crane is fluorescent safety yellow, crates are bright
 * orange. Dropped unmodified into a mossy overgrown ruin they do not read as
 * abandoned, they read as *pasted in*: the eye picks out the one object still
 * lit like a product shot.
 *
 * Desaturating, darkening and pushing everything a little towards green is the
 * cheapest way to make a mixed-source asset library look like one place. It
 * costs nothing at runtime — it happens once, on the shared template, before
 * any placement clones it.
 *
 * **It is a jungle treatment, not a house style.** The green push is the colour
 * of that one map's canopy, and applied everywhere it gives every object on
 * every map the same cold tint — a scrapyard of sushi and traffic cones came
 * out looking like it was carved from a single material. Whether it runs is the
 * registry's `weather` option, and only the flooded ruin asks for it.
 */
function weather(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  const hsl = { h: 0, s: 0, l: 0 };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    for (const raw of [mesh.material].flat()) {
      const mat = raw as THREE.MeshStandardMaterial;
      if (!mat || seen.has(mat) || !mat.color) continue;
      seen.add(mat);
      mat.color.getHSL(hsl);
      mat.color.setHSL(
        // Drift towards the green of the canopy, proportionally to how
        // saturated the colour was — a grey stays grey, a hot yellow moves.
        THREE.MathUtils.lerp(hsl.h, 0.27, Math.min(0.45, hsl.s * 0.6)),
        hsl.s * 0.45,
        hsl.l * 0.72,
      );
      if ('roughness' in mat) mat.roughness = Math.min(1, (mat.roughness ?? 0.8) + 0.25);
      if ('metalness' in mat) mat.metalness = (mat.metalness ?? 0) * 0.4;

      // Most of these assets carry their colour in a texture, not in
      // `material.color` — the crane's safety yellow survived a 40% colour
      // multiply completely intact, because multiplying a map only darkens it
      // and saturated yellow stays saturated yellow when it gets darker. The
      // desaturation has to happen after the map is sampled.
      if (mat.map) {
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            /* glsl */ `
            #include <map_fragment>
            {
              float wLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
              diffuseColor.rgb = mix( vec3( wLum ), diffuseColor.rgb, 0.4 );
              diffuseColor.rgb *= vec3( 0.82, 0.9, 0.72 );
            }
            `,
          );
        };
        mat.customProgramCacheKey = () => 'weathered-v1';
        mat.needsUpdate = true;
      }
    }
  });
}

export interface ResolvedAsset {
  id: string;
  def: AssetDef;
  /** unit-sized template geometry (for primitives) or root scene (for glTF) */
  template: THREE.Object3D;
  /** axis-aligned bbox of template at unit scale, used for collider sizing */
  bbox: THREE.Box3;
}

export interface RegistryOptions {
  /**
   * Age imported assets into an overgrown ruin. See `weather`.
   *
   * Defaults to true, which is what the flooded jungle wants and what every
   * caller used to get whether it suited them or not.
   */
  weather?: boolean;
}

export class AssetRegistry {
  private byId = new Map<string, ResolvedAsset>();
  private gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  /** Manifest entries that have not been downloaded yet. */
  private pending = new Map<string, ManifestEntry>();
  private readonly weathering: boolean;

  constructor(options: RegistryOptions = {}) {
    this.weathering = options.weather ?? true;
  }

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
      // The structural layer of the level is box primitives, so this is where
      // the ruin surfacing lands. Shared per id, which keeps the whole tower on
      // two materials however many hundred slabs it is made of.
      const mat = RUIN_SURFACES[entry.id]
        ? createRuinMaterial(RUIN_SURFACES[entry.id])
        : new THREE.MeshStandardMaterial({ color: asset.color, roughness: 0.85 });
      const mesh = new THREE.Mesh(geo, mat);
      const bbox = new THREE.Box3().setFromObject(mesh);
      this.byId.set(entry.id, { id: entry.id, def: asset, template: mesh, bbox });
      return;
    }
    const gltf = await this.gltfLoader.loadAsync(asset.url);
    const root = gltf.scene;
    if (this.weathering) weather(root);
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);
    this.byId.set(entry.id, { id: entry.id, def: asset, template: root, bbox });
  }
}
