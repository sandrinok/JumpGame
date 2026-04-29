import type { ColliderShape, Vec3, ColliderParams } from '../world/types';
import type { ResolvedAsset } from '../world/registry';
import type { RenderedPlacement } from '../world/level';

export interface Inspector {
  root: HTMLElement;
  setVisible(v: boolean): void;
  setSelection(r: RenderedPlacement | null, asset: ResolvedAsset | null): void;
  onColliderChange: (shape: ColliderShape | null) => void;
  onColliderParamsChange: (params: ColliderParams | null) => void;
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
    width: 280px; max-height: 75vh; overflow-y: auto;
    background: rgba(20,20,24,0.92); color: #eee;
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

  const collLabel = sectionLabel('Collider');
  root.appendChild(collLabel);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 6px;';
  root.appendChild(btnRow);

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size: 11px; opacity: 0.6; min-height: 14px; margin-bottom: 6px;';
  root.appendChild(hint);

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Use asset default';
  resetBtn.style.cssText = `
    margin-bottom: 10px; width: 100%; padding: 5px;
    background: #2a2a30; color: inherit; border: 1px solid #444;
    border-radius: 3px; cursor: pointer; font: 11px inherit;
  `;
  root.appendChild(resetBtn);

  const overrideLabel = sectionLabel('Collider overrides (absolute)');
  root.appendChild(overrideLabel);

  const offsetRow = vec3Row('Offset');
  const sizeRow = vec3Row('Size');
  const rotRow = vec3Row('Rot°');
  root.appendChild(offsetRow.row);
  root.appendChild(sizeRow.row);
  root.appendChild(rotRow.row);

  const resetOverrides = document.createElement('button');
  resetOverrides.textContent = 'Reset all overrides';
  resetOverrides.style.cssText = `
    margin-top: 6px; width: 100%; padding: 5px;
    background: #2a2a30; color: inherit; border: 1px solid #444;
    border-radius: 3px; cursor: pointer; font: 11px inherit;
  `;
  root.appendChild(resetOverrides);

  let currentR: RenderedPlacement | null = null;
  let currentAsset: ResolvedAsset | null = null;

  const api: Inspector = {
    root,
    onColliderChange: () => undefined,
    onColliderParamsChange: () => undefined,
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
      overrideLabel.style.display = 'none';
      offsetRow.row.style.display = 'none';
      sizeRow.row.style.display = 'none';
      rotRow.row.style.display = 'none';
      resetOverrides.style.display = 'none';
      return;
    }
    title.textContent = r.placement.id;
    meta.innerHTML =
      `uid: ${r.placement.uid}<br>` +
      `pos: ${fmtVec(r.placement.pos)}<br>` +
      `rot°: ${fmtVec(toDeg(r.placement.rot))}<br>` +
      `scale: ${fmtVec(r.placement.scale)}`;

    btnRow.innerHTML = '';

    if (asset.def.kind === 'primitive') {
      btnRow.innerHTML = '<span style="opacity:0.6; font-size:11px; grid-column: 1/-1;">Primitive box (collider follows visual)</span>';
      resetBtn.style.display = 'none';
      hint.textContent = '';
      overrideLabel.style.display = 'none';
      offsetRow.row.style.display = 'none';
      sizeRow.row.style.display = 'none';
      rotRow.row.style.display = 'none';
      resetOverrides.style.display = 'none';
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

    overrideLabel.style.display = 'block';
    offsetRow.row.style.display = 'flex';
    sizeRow.row.style.display = 'flex';
    rotRow.row.style.display = 'flex';

    const params = r.placement.colliderParams ?? {};
    offsetRow.write(params.offset);
    sizeRow.write(params.size);
    rotRow.write(params.rot ? toDeg(params.rot) : undefined);

    const hasOverrides = !!params.offset || !!params.size || !!params.rot;
    resetOverrides.style.display = hasOverrides ? 'block' : 'none';
  };

  const emit = (): void => {
    const r = currentR;
    if (!r) return;
    const next: ColliderParams = {};
    const off = offsetRow.read();
    const sz = sizeRow.read();
    const rt = rotRow.read();
    if (off) next.offset = off;
    if (sz) next.size = sz;
    if (rt) next.rot = toRad(rt);
    api.onColliderParamsChange(Object.keys(next).length === 0 ? null : next);
  };

  for (const row of [offsetRow, sizeRow, rotRow]) {
    row.row.addEventListener('input', () => {
      // debounce-light: schedule on next frame to coalesce rapid edits
      requestAnimationFrame(emit);
    });
  }
  resetOverrides.onclick = () => api.onColliderParamsChange(null);

  return api;
}

function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'opacity: 0.7; font-size: 11px; margin-bottom: 4px; margin-top: 2px;';
  return el;
}

interface Vec3RowApi {
  row: HTMLElement;
  read(): Vec3 | undefined;
  write(v: Vec3 | undefined): void;
}

function vec3Row(label: string): Vec3RowApi {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-bottom: 4px;';
  const lab = document.createElement('div');
  lab.textContent = label;
  lab.style.cssText = 'font-size: 11px; opacity: 0.7; width: 44px; flex-shrink: 0;';
  row.appendChild(lab);
  const inputs: HTMLInputElement[] = [];
  for (let i = 0; i < 3; i++) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = '–';
    inp.style.cssText = `
      width: 100%; min-width: 0; padding: 3px 4px;
      background: #0f0f14; color: inherit; border: 1px solid #3a3a44;
      border-radius: 3px; font: 11px ui-monospace, monospace;
    `;
    inputs.push(inp);
    row.appendChild(inp);
  }
  return {
    row,
    read() {
      const vals: number[] = [];
      let anyFilled = false;
      for (const inp of inputs) {
        const t = inp.value.trim();
        if (t === '') {
          vals.push(NaN);
        } else {
          anyFilled = true;
          const n = parseFloat(t);
          vals.push(Number.isFinite(n) ? n : 0);
        }
      }
      if (!anyFilled) return undefined;
      // any blank field becomes 0 if at least one value is filled
      return vals.map((v) => (Number.isFinite(v) ? v : 0)) as Vec3;
    },
    write(v) {
      if (v === undefined) {
        inputs.forEach((i) => (i.value = ''));
      } else {
        inputs.forEach((i, idx) => (i.value = round(v[idx]).toString()));
      }
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function fmtVec(v: [number, number, number]): string {
  return `${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)}`;
}

function toDeg(v: Vec3): Vec3 {
  return [(v[0] * 180) / Math.PI, (v[1] * 180) / Math.PI, (v[2] * 180) / Math.PI];
}

function toRad(v: Vec3): Vec3 {
  return [(v[0] * Math.PI) / 180, (v[1] * Math.PI) / 180, (v[2] * Math.PI) / 180];
}
