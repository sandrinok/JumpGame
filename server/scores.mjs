/**
 * The shared high score table.
 *
 * Lives here rather than in the HTTP layer because two servers need it: the
 * production one in index.mjs, and the Vite dev middleware. Duplicating the
 * validation across both is how the two quietly stop agreeing about what a
 * valid score is.
 *
 * Stored as one JSON file. A group of colleagues posting a handful of runs on a
 * Friday does not need a database, and a file that can be read with `cat` is
 * easier to fix when someone inevitably submits themselves as "aaaaaaaa".
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** How many entries the board shows. */
export const TOP_N = 20;
/**
 * How many are kept on disk. More than the board shows, so a player who slips
 * out of the top twenty is still there when they beat their score again, but
 * bounded so the file cannot grow forever.
 */
const KEEP_N = 200;

const MAX_NAME_LENGTH = 24;
/**
 * Sanity bound on a submitted height.
 *
 * This is not anti-cheat and cannot be: the client posts a number, so anyone
 * who opens the console can post any number they like. Signing it, or replaying
 * the run server-side, would be the only real answers and both cost far more
 * than this is worth. What the bound does is keep one bored person from
 * wedging the board with Infinity or 1e308 so that nobody else's score is ever
 * visible again.
 */
const MAX_HEIGHT = 10000;

/** Submissions allowed per address per window, and the window. */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

/**
 * Clean a submitted name, or return null if nothing usable is left.
 *
 * Control characters are stripped rather than rejected: they arrive from
 * paste accidents far more often than from anyone being clever, and the score
 * is still real. Everything else is left alone — this is a leaderboard among
 * colleagues, not a public forum, and mangling someone's name because it has
 * an accent in it would be worse than the problem.
 */
export function cleanName(value) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, MAX_NAME_LENGTH);
}

export function cleanHeight(value) {
  const height = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(height)) return null;
  if (height <= 0 || height > MAX_HEIGHT) return null;
  // One decimal is all the game ever displays.
  return Math.round(height * 10) / 10;
}

export function createScoreBoard(file) {
  /** Cached table, loaded on first use. */
  let entries = null;
  /**
   * Writes are chained rather than run concurrently. Two submissions arriving
   * together would otherwise both read the old table, both add their own entry,
   * and the second write would erase the first.
   */
  let queue = Promise.resolve();
  const hits = new Map();

  async function load() {
    if (entries) return entries;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      entries = Array.isArray(parsed?.entries) ? parsed.entries.filter(isValidEntry) : [];
    } catch {
      // Missing file on first run, or something unreadable. Either way an empty
      // board is the right starting point; a corrupt file is overwritten on the
      // next submission rather than taking the endpoint down.
      entries = [];
    }
    sort(entries);
    return entries;
  }

  async function persist() {
    await mkdir(dirname(file), { recursive: true });
    const text = JSON.stringify({ version: 1, entries }, null, 2);
    // Write-then-rename, so a crash mid-write cannot leave a truncated table
    // that the next load() would silently treat as an empty board.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, file);
  }

  return {
    /** The board, best first. */
    async top(limit = TOP_N) {
      return (await load()).slice(0, limit);
    },

    /**
     * Record a run.
     *
     * One entry per player, holding their best. Keeping every run instead would
     * let whoever is having a good evening take all twenty rows, which is the
     * opposite of what a shared board is for.
     *
     * @returns the board after the change, plus whether this run made the cut.
     */
    async submit({ name, height, at = Date.now() }) {
      const result = queue.then(async () => {
        await load();
        const key = name.toLowerCase();
        const existing = entries.find((e) => e.name.toLowerCase() === key);
        let improved = true;
        if (existing) {
          if (height <= existing.height) {
            improved = false;
          } else {
            existing.height = height;
            existing.at = at;
            // Take the new spelling: someone fixing their capitalisation should
            // see it change.
            existing.name = name;
          }
        } else {
          entries.push({ name, height, at });
        }
        if (improved) {
          sort(entries);
          if (entries.length > KEEP_N) entries.length = KEEP_N;
          await persist();
        }
        return { improved, entries: entries.slice(0, TOP_N) };
      });
      // The chain must survive a failed write, or one error stops every later
      // submission from ever running.
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },

    /** True while this address is under its submission allowance. */
    allow(ip) {
      const now = Date.now();
      const entry = hits.get(ip);
      if (!entry || now - entry.first > RATE_WINDOW_MS) {
        hits.set(ip, { count: 1, first: now });
        return true;
      }
      entry.count++;
      return entry.count <= RATE_LIMIT;
    },

    /** Drop rate-limit entries that have aged out, so the map cannot grow forever. */
    sweep() {
      const now = Date.now();
      for (const [ip, entry] of hits) {
        if (now - entry.first > RATE_WINDOW_MS) hits.delete(ip);
      }
    },
  };
}

function isValidEntry(e) {
  return (
    e &&
    typeof e.name === 'string' &&
    e.name.length > 0 &&
    Number.isFinite(e.height) &&
    e.height > 0
  );
}

function sort(list) {
  // Ties go to whoever got there first — a score you have held all evening
  // should not be pushed down by someone matching it later.
  list.sort((a, b) => b.height - a.height || (a.at ?? 0) - (b.at ?? 0));
}
