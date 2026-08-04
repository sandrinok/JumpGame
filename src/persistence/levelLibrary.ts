import type { Level } from '../world/types';

/** One entry of GET /api/levels. Mirrors server/levels.mjs. */
export interface LevelSummary {
  /** Filename including the extension, e.g. "dev.json" — the id everywhere else. */
  name: string;
  size: number;
  /** Last write, epoch milliseconds. */
  modified: number;
  /** null when the server declined to parse it (too large, or not a level). */
  placements: number | null;
}

/**
 * Level names the server will accept, without the extension.
 *
 * The same rule as LEVEL_NAME in server/levels.mjs, checked here only so a bad
 * name is refused while it is being typed rather than after a round trip. The
 * server does not trust this.
 */
const NAME = /^[a-zA-Z0-9_-]{1,59}$/;

export function isValidLevelName(name: string): boolean {
  return NAME.test(name);
}

/** "my level" -> "my_level". Best effort, for turning a typed title into a name. */
export function toLevelName(input: string): string {
  return input
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 59)
    .toLowerCase();
}

export async function listLevels(): Promise<LevelSummary[]> {
  const res = await fetch('/api/levels', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`levels: ${res.status}`);
  const body = (await res.json()) as { levels?: LevelSummary[] };
  return body.levels ?? [];
}

/**
 * Fetch one level by filename.
 *
 * Deliberately the same public path the game itself loads from, so what the
 * editor opens is exactly what a player would get — not a second read path that
 * could drift from it.
 */
export async function fetchLevel(name: string): Promise<Level> {
  const res = await fetch(`/levels/${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`level ${name}: ${res.status}`);
  return (await res.json()) as Level;
}
