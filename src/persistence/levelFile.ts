import type { Level } from '../world/types';

interface FSWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
}

const PICKER_OPTS = {
  types: [{ description: 'JumpGame level', accept: { 'application/json': ['.json'] } }],
  suggestedName: 'level.json',
};

let lastHandle: FileSystemFileHandle | null = null;
/** Source path of the level loaded from /levels/*.json — set by setLevelSource. */
let levelSource: string | null = null;

export function setLevelSource(path: string | null): void {
  // Strip leading slash so we can POST it directly to /__save-level/<rel>.
  levelSource = path ? path.replace(/^\/+/, '') : null;
}

export function getLevelSource(): string | null {
  return levelSource;
}

export function serializeLevel(level: Level): string {
  return JSON.stringify(level, null, 2);
}

async function trySaveToDevServer(rel: string, text: string): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const res = await fetch(`/__save-level/${rel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
    });
    if (!res.ok) {
      console.warn('[level] dev-server save returned', res.status);
      return false;
    }
    console.info('[level] saved to', rel);
    return true;
  } catch (e) {
    console.warn('[level] dev-server save failed:', e);
    return false;
  }
}

export async function saveLevel(level: Level): Promise<void> {
  const w = window as unknown as FSWindow;
  const text = serializeLevel(level);
  // Dev: overwrite the source file in /public via the vite middleware.
  if (levelSource && (await trySaveToDevServer(levelSource, text))) return;
  if (w.showSaveFilePicker) {
    try {
      const handle = lastHandle ?? (await w.showSaveFilePicker(PICKER_OPTS));
      lastHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
      console.warn('[level] FS Access save failed, falling back to download:', e);
    }
  }
  // download fallback
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'level.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function saveLevelAs(level: Level): Promise<void> {
  lastHandle = null;
  await saveLevel(level);
}

export async function loadLevelFromDisk(): Promise<Level | null> {
  // Loading from disk replaces the source — subsequent Save uses the FS picker, not the dev server.
  levelSource = null;
  const w = window as unknown as FSWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker(PICKER_OPTS);
      lastHandle = handle;
      const file = await handle.getFile();
      return JSON.parse(await file.text()) as Level;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      console.warn('[level] FS Access open failed, falling back to <input>:', e);
    }
  }
  return await loadViaInput();
}

function loadViaInput(): Promise<Level | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        resolve(JSON.parse(await f.text()) as Level);
      } catch (e) {
        console.error('[level] failed to parse:', e);
        resolve(null);
      }
    };
    input.click();
  });
}
