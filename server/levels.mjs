/**
 * Listing the levels available to load.
 *
 * Shared by the production server and the Vite dev middleware, for the same
 * reason scores.mjs is: the editor's level browser is the only thing that reads
 * it, and a browser that shows different levels in development than it does in
 * production is a bug you find on the night, not before.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Level filenames the server will read or write.
 *
 * No dots, so no traversal and no extension games; the ".json" is required
 * rather than assumed, because the name is what the client PUTs back.
 */
export const LEVEL_NAME = /^[a-zA-Z0-9_-]{1,64}\.json$/;

/**
 * Placement counts, keyed on identity rather than name.
 *
 * The count is the one thing in the listing that costs a parse, and it is also
 * the thing that makes the browser worth having — "76 objects" tells you which
 * level you are looking at when "dev.json" does not. Keying on size+mtime means
 * a saved level re-counts on the next listing and an untouched one never does,
 * so the endpoint stays cheap no matter how often it is polled.
 */
const countCache = new Map();

/** Levels above this are listed without a count rather than parsed. */
const MAX_COUNT_BYTES = 1024 * 1024;

async function placementCount(file, info) {
  if (info.size > MAX_COUNT_BYTES) return null;
  const key = `${file}:${info.size}:${info.mtimeMs}`;
  const hit = countCache.get(key);
  if (hit !== undefined) return hit;
  let count = null;
  try {
    const level = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(level?.placements)) count = level.placements.length;
  } catch {
    // Unreadable or not a level. It still gets listed — hiding it would leave
    // someone staring at a file they can see on disk and not in the editor.
  }
  countCache.set(key, count);
  return count;
}

/**
 * Every level readable from `dirs`, newest first.
 *
 * Directories are searched in order and the first hit for a name wins, which
 * mirrors how serveLevel resolves one: LEVELS_DIR shadows the copy shipped
 * inside the build, so the listing shows the same file the game would load.
 * Missing directories are not an error — a fresh install has no LEVELS_DIR
 * until the first save.
 */
export async function listLevels(dirs) {
  const found = new Map();
  for (const dir of dirs) {
    const names = await readdir(dir).catch(() => []);
    for (const name of names) {
      if (!LEVEL_NAME.test(name) || found.has(name)) continue;
      const file = join(dir, name);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) continue;
      found.set(name, {
        name,
        size: info.size,
        modified: Math.round(info.mtimeMs),
        placements: await placementCount(file, info),
      });
    }
  }
  return [...found.values()].sort((a, b) => b.modified - a.modified);
}
