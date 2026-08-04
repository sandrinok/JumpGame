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

export type SaveOutcome = 'saved' | 'unauthorized' | 'unavailable';

/** "levels/dev.json" -> "dev.json"; the server owns the directory, not the client. */
function levelFileName(source: string): string {
  return source.split('/').pop() ?? source;
}

async function trySaveToServer(source: string, text: string): Promise<SaveOutcome> {
  const name = levelFileName(source);
  try {
    const res = await fetch(`/api/level/${encodeURIComponent(name)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: text,
    });
    if (res.ok) {
      console.info('[level] saved to server:', name);
      return 'saved';
    }
    if (res.status === 401) return 'unauthorized';
    console.warn('[level] server save returned', res.status);
    return 'unavailable';
  } catch (e) {
    console.warn('[level] server save failed:', e);
    return 'unavailable';
  }
}

/**
 * Save to the server, asking for the password again if the session has lapsed.
 *
 * Sessions expire after 12h, and losing an afternoon of level edits to that
 * would be miserable — ask again and retry rather than fall through to a
 * surprise download.
 */
async function saveToServer(source: string, text: string): Promise<SaveOutcome> {
  const outcome = await trySaveToServer(source, text);
  if (outcome !== 'unauthorized') return outcome;
  const { promptLogin } = await import('../editor/auth');
  const host = document.getElementById('app') ?? document.body;
  if (!(await promptLogin(host))) return 'unauthorized';
  return await trySaveToServer(source, text);
}

/**
 * Write the level to the server under a name of your choosing, and make that
 * the file subsequent saves go to.
 *
 * This is the only way to get a level the editor is holding — one opened from
 * disk, or built from nothing — into the server's library, where the level
 * browser can find it again.
 */
export async function saveLevelAsName(name: string, level: Level): Promise<SaveOutcome> {
  const outcome = await saveToServer(name, serializeLevel(level));
  if (outcome === 'saved') setLevelSource(`levels/${name}`);
  return outcome;
}

/**
 * Save the level wherever it came from.
 *
 * Returns whether it was actually written anywhere — false only when the file
 * picker was dismissed. The editor uses that to decide whether it still has
 * unsaved work, so a cancelled Save must not read as a successful one.
 */
export async function saveLevel(level: Level): Promise<boolean> {
  const w = window as unknown as FSWindow;
  const text = serializeLevel(level);

  // Preferred path: write straight back to the file this level came from.
  // Dev does it through the Vite middleware, production through the
  // authenticated endpoint; the client cannot tell the difference.
  if (levelSource) {
    if ((await saveToServer(levelSource, text)) === 'saved') return true;
  }

  if (w.showSaveFilePicker) {
    try {
      const handle = lastHandle ?? (await w.showSaveFilePicker(PICKER_OPTS));
      lastHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
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
  return true;
}

export async function saveLevelAs(level: Level): Promise<boolean> {
  lastHandle = null;
  return await saveLevel(level);
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
