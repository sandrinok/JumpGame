# Asset optimization

Drop your raw Sketchfab/CC `.glb` or `.gltf` files into `3dassets/` (gitignored —
they stay on your machine). Then run:

```
npm run optimize-assets
```

Each file is processed through:

- **dedup / prune / weld / resample** — mesh cleanup, drops unreferenced data
- **textureCompress** → WebP, max 2048px (via `sharp`)
- **EXT_meshopt_compression** — vertex compression (decoded at runtime by `MeshoptDecoder`)

Output lands in `public/assets/3d/` and gets auto-registered in
`public/assets/manifest.json` with `collider: trimesh` by default.

Tweak collider type (`box` / `convex` / `trimesh`) and `tags` in the manifest
afterwards — the script never touches existing entries.

## Custom paths

```
npm run optimize-assets -- some/source some/output
```

## Running on the VPS

The script is plain Node — no GPU, no compiled binaries beyond what `sharp` and
`meshoptimizer` install via npm. 2 GB RAM is enough as long as your textures
stay under 4K. Run the same command after `npm install` and you're done.
