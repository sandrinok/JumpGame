/**
 * Which maps exist, and which one this page is playing.
 *
 * One list, in `public/levels/index.json`, read by the client here and by the
 * server when it decides which score file a submission belongs to. Keeping two
 * lists is how a map ends up playable but unable to record a score, or holding
 * a board nobody can reach.
 */

/**
 * The dressing a map expects around it.
 *
 * The flooded jungle is AI Jungle's setting, not the game's. Rendered over the
 * hand-built maps it puts a waterline through their lowest footholds and a palm
 * canopy over a scrapyard — they were built as bare structures standing on open
 * ground, and that is how they have to be drawn.
 */
export interface MapEnvironment {
  water: boolean;
  vegetation: boolean;
}

export interface MapInfo {
  /** Stable, URL-safe, and the key its high score table is filed under. */
  id: string;
  title: string;
  /** Filename inside /levels. */
  file: string;
  blurb: string;
  /** Colour used for this map's portal and board in the hub. */
  accent: string;
  author: string;
  /**
   * Whether this map can be played yet. Absent means yes.
   *
   * A map that is listed but closed still gets its portal, its emblem and its
   * board in the hub — dimmed, and labelled "coming soon". Dropping it from the
   * index instead would be the smaller change and the worse one: the hub is
   * where the game says what it is, and three doorways with one of them lit
   * says something a single doorway cannot.
   *
   * It gates the hub, which is where a map is chosen. `/play.html?map=…` still
   * loads a closed map, because that URL is how the level is worked on and
   * closing it would mean the only way to test a map is to first declare it
   * finished.
   */
  available?: boolean;
  env: MapEnvironment;
  /**
   * A model from the asset library that stands beside this map's portal.
   *
   * The point is that the hub tells you what is through a doorway before you
   * read anything on the board: a crate of sushi and a shipping container are
   * two different promises.
   */
  emblem?: string;
  /** How wide the emblem should be, in metres across its longest side. */
  emblemWidth?: number;
  /**
   * Which colour grade to finish the frame with.
   *
   * 'jungle' is the original, tuned against a flooded overgrown ruin: saturated
   * and with a deliberate blue push into the shadows. Applied to a scrapyard it
   * tints every object the same cold hue, which is what made the hand-built
   * maps read as though everything in them were made of the same material.
   */
  look?: 'jungle' | 'neutral';
}

export interface MapIndex {
  version: number;
  maps: MapInfo[];
}

const INDEX_URL = '/levels/index.json';

let cached: MapInfo[] | null = null;

/** Every map, in the order the hub should present them. */
export async function loadMaps(): Promise<MapInfo[]> {
  if (cached) return cached;
  const res = await fetch(INDEX_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`map index ${res.status}`);
  const body = (await res.json()) as MapIndex;
  if (!Array.isArray(body.maps) || body.maps.length === 0) {
    throw new Error('map index is empty');
  }
  cached = body.maps;
  return cached;
}

/**
 * The map this page was opened for.
 *
 * An unknown id falls back to the first map rather than failing: a stale
 * bookmark or a renamed map should drop you into something playable, not into
 * an error screen.
 */
export function selectedMapId(maps: MapInfo[]): string {
  const asked = new URLSearchParams(location.search).get('map');
  if (asked && maps.some((m) => m.id === asked)) return asked;
  return maps[0].id;
}

export function findMap(maps: MapInfo[], id: string): MapInfo {
  return maps.find((m) => m.id === id) ?? maps[0];
}

/** True when the player arrived from a hub portal and should not see a menu. */
export function arrivedThroughPortal(): boolean {
  return new URLSearchParams(location.search).get('go') === '1';
}

/**
 * Where to send the browser to play a map.
 *
 * The hub is the front door — `/` is the room you choose from — so the game
 * itself lives at /play.html. Anyone who bookmarked a run still lands in a
 * playable map; anyone who just opens the site is asked where they want to go.
 */
export function playUrl(id: string, immediate = true): string {
  return `/play.html?map=${encodeURIComponent(id)}${immediate ? '&go=1' : ''}`;
}

export const HUB_URL = '/';
