import type { ColliderShape } from '../world/types';
import type { ResolvedAsset } from '../world/registry';
import type { RenderedPlacement } from '../world/level';

export interface Inspector {
  root: HTMLElement;
  setVisible(v: boolean): void;
  setSelection(r: RenderedPlacement | null, asset: ResolvedAsset | null): void;
  onColliderChange: (shape: ColliderShape | null) => void;
}

const COLLIDER_OPTIONS: Array<{ value: ColliderShape; label: string; hint: string }> = [
  { value: 'box', label: 'Box', hint: 'AABB · fastest, very reliable' },
  { value: 'sphere', label: 'Sphere', hint: 'Ball · ideal for round props' },
  { value: 'cylinder', label: 'Cyl', hint: 'Y-aligned cylinder · pillars/pipes' },
  { value: 'capsule', label: 'Caps', hint: 'Y-aligned capsule · smooth tops' },
  { value: 'cone', label: 'Cone', hint: 'Y-aligned cone · spikes/funnels' },
  { value: 'convex', label: 'Convex', hint: 'Convex hull · good middle ground' },
  { value: 'trimesh', label: 'Tri', hint: 'Exact · slowest, only for static' },
];

export function createInspector(parent: HTMLElement): Inspector {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; bottom: 12px; right: 12px;
    width: 240px; background: rgba(20,20,24,0.9); color: #eee;
    font: 13px system-ui, sans-serif;
    border: 1px solid #444; border-radius: 6px;
    padding: 10px 12px; display: none;
  `;
  parent.appendChild(root);

  const title = document.createElement('div');
  title.style.cssText = 'font-weight: 700; margin-bottom: 6px; opacity: 0.85;';
  root.appendChild(title);

  const meta = document.createElement('div');
  meta.style.cssText = 'opacity: 0.65; font-size: 11px; line-height: 1.5; margin-bottom: 10px; word-break: break-all;';
  root.appendChild(meta);

  const collLabel = document.createElement('div');
  collLabel.textContent = 'Collider';
  collLabel.style.cssText = 'opacity: 0.7; font-size: 11px; margin-bottom: 4px;';
  root.appendChild(collLabel);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 6px;';
  root.appendChild(btnRow);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size: 11px; opacity: 0.6; min-height: 14px;';
  root.appendChild(hint);

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Use asset default';
  resetBtn.style.cssText = `
    margin-top: 8px; width: 100%; padding: 5px;
    background: #2a2a30; color: inherit; border: 1px solid #444;
    border-radius: 3px; cursor: pointer; font: 11px inherit;
  `;
  root.appendChild(resetBtn);

  let currentR: RenderedPlacement | null = null;
  let currentAsset: ResolvedAsset | null = null;

  const api: Inspector = {
    root,
    onColliderChange: () => undefined,
    setVisible(v) {
      root.style.display = v ? 'block' : 'none';
    },
    setSelection(r, asset) {
      currentR = r;
      currentAsset = asset;
      render();
    },
  };

  const render = (): void => {
    const r = currentR;
    const asset = currentAsset;
    if (!r || !asset) {
      title.textContent = 'No selection';
      meta.textContent = '';
      btnRow.innerHTML = '';
      resetBtn.style.display = 'none';
      hint.textContent = '';
      return;
    }
    title.textContent = r.placement.id;
    meta.innerHTML =
      `uid: ${r.placement.uid}<br>` +
      `pos: ${fmtVec(r.placement.pos)}<br>` +
      `rot°: ${fmtVec(r.placement.rot.map((v) => (v * 180) / Math.PI) as [number, number, number])}<br>` +
      `scale: ${fmtVec(r.placement.scale)}`;

    btnRow.innerHTML = '';

    if (asset.def.kind === 'primitive') {
      btnRow.innerHTML = '<span style="opacity:0.6; font-size:11px;">Primitive box (collider follows visual)</span>';
      resetBtn.style.display = 'none';
      hint.textContent = '';
      return;
    }

    const defaultCollider = asset.def.collider;
    const active = r.placement.collider ?? defaultCollider;
    for (const opt of COLLIDER_OPTIONS) {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.style.cssText = `
        padding: 5px 2px; font: inherit; font-size: 11px;
        background: ${active === opt.value ? '#3a5a8a' : '#2a2a30'};
        color: inherit; border: 1px solid #555; border-radius: 3px;
        cursor: pointer;
      `;
      btn.onmouseover = () => (hint.textContent = opt.hint);
      btn.onmouseout = () => (hint.textContent = '');
      btn.onclick = () => api.onColliderChange(opt.value);
      btnRow.appendChild(btn);
    }

    const overridden = r.placement.collider !== undefined && r.placement.collider !== defaultCollider;
    resetBtn.style.display = overridden ? 'block' : 'none';
    resetBtn.textContent = `Use asset default (${defaultCollider})`;
    resetBtn.onclick = () => api.onColliderChange(null);
  };

  return api;
}

function fmtVec(v: [number, number, number]): string {
  return `${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)}`;
}
