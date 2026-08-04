# ThreeJS Skills Template

Projecttemplate met Claude Code skills voor Three.js / WebGPU werk.
Alle skills staan in `.claude/skills/` en worden automatisch geladen zodra
Claude Code in deze map draait — kopieer de map naar een nieuw project (of
gebruik dit als GitHub template) om ze mee te nemen.

## Bronnen

| Bron | Skills |
| --- | --- |
| [cloudai-x/threejs-skills](https://github.com/cloudai-x/threejs-skills) | `threejs-fundamentals`, `threejs-geometry`, `threejs-materials`, `threejs-textures`, `threejs-lighting`, `threejs-animation`, `threejs-shaders`, `threejs-postprocessing`, `threejs-loaders`, `threejs-interaction` |
| [majidmanzarpour/threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills) | `threejs-game-director`, `threejs-gameplay-systems`, `threejs-aaa-graphics-builder`, `threejs-game-ui-designer`, `threejs-3d-generator`, `threejs-image-generator`, `threejs-audio-generator`, `threejs-debug-profiler`, `threejs-qa-release` |
| [dgreenheck/webgpu-claude-skill](https://github.com/dgreenheck/webgpu-claude-skill) | `webgpu-threejs-tsl` |

## Skills (20)

**Three.js kern** — `threejs-fundamentals` (scene/camera/renderer setup),
`threejs-geometry`, `threejs-materials`, `threejs-textures`, `threejs-lighting`,
`threejs-animation`, `threejs-shaders` (GLSL), `threejs-postprocessing`,
`threejs-loaders` (GLTF/DRACO/KTX2), `threejs-interaction` (raycasting, controls).

**Game development** — `threejs-game-director` (orkestreert de andere game
skills), `threejs-gameplay-systems` (incl. een Vite+TS starter template in
`assets/threejs-vite-game/`), `threejs-aaa-graphics-builder`,
`threejs-game-ui-designer`, `threejs-debug-profiler`, `threejs-qa-release`
(Playwright visual tests / playtest bots).

**Asset generatie** — `threejs-3d-generator` (Tripo), `threejs-image-generator`
(Gemini), `threejs-audio-generator` (ElevenLabs).

**WebGPU** — `webgpu-threejs-tsl` (TSL node materials, compute shaders,
WGSL-integratie, device loss handling).

## Optionele API keys

Alleen nodig voor de drie asset-generatie skills; de rest werkt zonder.

```powershell
[Environment]::SetEnvironmentVariable("TRIPO_API_KEY", "...", "User")
[Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "...", "User")
[Environment]::SetEnvironmentVariable("ELEVENLABS_API_KEY", "...", "User")
```

Die skills draaien Python scripts (`skills/*/scripts/*.py`) en verwachten
Python 3 met `requests` beschikbaar.

## Skills bijwerken

```bash
git clone --depth 1 https://github.com/<owner>/<repo> tmp
cp -r tmp/skills/* .claude/skills/
rm -rf tmp
```
