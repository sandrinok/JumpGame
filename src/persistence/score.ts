import {
  clampAppearance,
  DEFAULT_APPEARANCE,
  PRINT_MAX_LENGTH,
  type Appearance,
} from '../game/character/appearance';

const KEY = 'jumpgame.score.v1';

export interface ScoreData {
  name: string;
  /**
   * Personal best per map id.
   *
   * Was a single number when there was a single map. A save written before the
   * split has one bare `best`, which is carried onto the map it must have been
   * set on — see loadScore.
   */
  bests: Record<string, number>;
  /**
   * Skin tint, as #rrggbb. Also the colour of this player's name plate and
   * their chat, which is why it stays the one field called simply "colour".
   */
  colour: string;
  /** Shirt colour as #rrggbb, or '' for no shirt. */
  shirt: string;
  /** Where the hem falls and how far the sleeves reach, in bind-pose units. */
  hem: number;
  sleeve: number;
  /** Printed across the chest. Empty for a plain shirt. */
  print: string;
  printColour: string;
  printScale: number;
  /**
   * An uploaded print, as a data URL.
   *
   * Stored alongside everything else despite being far the largest field here,
   * because localStorage is the only place it exists — there is no server copy
   * to fetch it back from, so losing it means the player uploads it again.
   */
  printImage: string;
}

/** The wearable part of a save, in the shape the renderer wants it. */
export function appearanceOf(score: ScoreData): Appearance {
  return clampAppearance({
    body: score.colour,
    shirt: score.shirt,
    hem: score.hem,
    sleeve: score.sleeve,
    print: score.print,
    printColour: score.printColour,
    printScale: score.printScale,
    printImage: score.printImage,
  });
}

/** Assigned to a first-time player so not everyone turns up the same colour. */
const PALETTE = [
  '#e5533d',
  '#f2a541',
  '#f2e14c',
  '#6cc551',
  '#3fb8af',
  '#4a8fe7',
  '#8b5cf6',
  '#e368b8',
];

export function loadScore(): ScoreData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<ScoreData>;
      return {
        name: stored.name ?? 'Player',
        bests: migrateBests(stored),
        // Saves written before colours existed have none, so one is picked now
        // rather than leaving the field empty and defaulting to grey forever.
        colour: stored.colour ?? randomColour(),
        // Saves written before shirts existed get no shirt, which is exactly
        // how those players already look to everybody else.
        shirt: stored.shirt ?? '',
        hem: stored.hem ?? DEFAULT_APPEARANCE.hem,
        sleeve: stored.sleeve ?? DEFAULT_APPEARANCE.sleeve,
        print: (stored.print ?? '').slice(0, PRINT_MAX_LENGTH),
        printColour: stored.printColour ?? '#ffffff',
        printScale: stored.printScale ?? 1,
        printImage: stored.printImage ?? '',
      };
    }
  } catch {
    // ignore
  }
  return {
    name: 'Player',
    bests: {},
    colour: randomColour(),
    shirt: '',
    hem: DEFAULT_APPEARANCE.hem,
    sleeve: DEFAULT_APPEARANCE.sleeve,
    print: '',
    printColour: '#ffffff',
    printScale: 1,
    printImage: '',
  };
}

/**
 * The map every score belonged to before maps had ids.
 *
 * There was one map and it is the one now called AI Jungle, so a legacy `best`
 * is its best. Dropping it instead would quietly reset the record of anyone who
 * had been playing, which is a bad way to introduce a feature.
 */
const LEGACY_MAP = 'ai-jungle';

function migrateBests(stored: Partial<ScoreData> & { best?: number }): Record<string, number> {
  const bests: Record<string, number> = {};
  if (stored.bests && typeof stored.bests === 'object') {
    for (const [id, value] of Object.entries(stored.bests)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) bests[id] = value;
    }
  }
  if (typeof stored.best === 'number' && stored.best > 0 && !bests[LEGACY_MAP]) {
    bests[LEGACY_MAP] = stored.best;
  }
  return bests;
}

/** This player's record on one map, or 0 if they have never finished a run on it. */
export function bestOn(score: ScoreData, map: string): number {
  return score.bests[map] ?? 0;
}

function randomColour(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

export function saveScore(data: ScoreData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}
