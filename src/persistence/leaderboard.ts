/**
 * The shared high score table, as the game sees it.
 *
 * Everything here fails quietly. A leaderboard is decoration around a game that
 * works perfectly well without one, so a server that is down, a laptop that has
 * dropped off the wifi, or a corporate proxy eating the request should cost the
 * player nothing but an empty panel.
 *
 * Every call carries a map id. There is one table per map, because ranking a
 * 260m climb up the tallest map above a 180m climb up the hardest one tells
 * nobody anything.
 */

export interface ScoreEntry {
  name: string;
  height: number;
  /** Epoch milliseconds when the run was recorded. */
  at?: number;
}

const ENDPOINT = '/api/scores';

const url = (map: string): string => `${ENDPOINT}?map=${encodeURIComponent(map)}`;
/**
 * Long enough for a slow connection, short enough that the start screen is not
 * held hostage by a server that will never answer.
 */
const TIMEOUT_MS = 4000;

/** The current board, best first. Empty if it could not be reached. */
export async function fetchScores(map: string): Promise<ScoreEntry[]> {
  try {
    const res = await fetch(url(map), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { scores?: ScoreEntry[] };
    return Array.isArray(body.scores) ? body.scores : [];
  } catch {
    return [];
  }
}

/**
 * Record a run.
 *
 * @returns the updated board, or null if the submission did not get through.
 */
export async function submitScore(
  map: string,
  name: string,
  height: number,
): Promise<ScoreEntry[] | null> {
  try {
    const res = await fetch(url(map), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, height }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { scores?: ScoreEntry[] };
    return Array.isArray(body.scores) ? body.scores : null;
  } catch {
    return null;
  }
}

/**
 * Record a run from a page that is going away.
 *
 * fetch() started during pagehide is cancelled when the document unloads, which
 * is exactly when someone who has just set their best score of the evening
 * closes the tab. sendBeacon hands the request to the browser to deliver after
 * the page is gone, which is the only thing that survives that.
 */
export function submitScoreBeacon(map: string, name: string, height: number): void {
  try {
    const blob = new Blob([JSON.stringify({ name, height })], { type: 'application/json' });
    navigator.sendBeacon(url(map), blob);
  } catch {
    // No beacon support, or the payload was refused. The score stays local.
  }
}
