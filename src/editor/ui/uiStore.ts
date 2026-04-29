import type { ResolvedAsset } from '../../world/registry';
import type { RenderedPlacement } from '../../world/level';
import type { DebugMode } from '../../physics/debugView';
import type { Placement } from '../../world/types';

/**
 * Editor UI state shared between the (TS) Editor controller and the (React)
 * UI tree. Editor writes; UI subscribes and re-renders.
 */
export interface EditorUiState {
  visible: boolean;
  /** All asset entries known to the registry (for the palette) */
  assets: ResolvedAsset[];
  /** Currently picked palette asset id */
  paletteCurrent: string | null;
  /** Currently selected placement (if any) */
  selection: RenderedPlacement | null;
  /** Asset of selected placement (resolved by registry) */
  selectionAsset: ResolvedAsset | null;
  /** Force re-render seed when placement transform mutates externally */
  selectionVersion: number;
  snapEnabled: boolean;
  colliderView: DebugMode;
  /** uids that are hidden in editor (not persisted) */
  hidden: Set<string>;
  /** uids that are locked in editor (not persisted) */
  locked: Set<string>;
  /** monotonic counter, bumped whenever placements are added/removed */
  placementsVersion: number;
  /** snapshot of all level placements for the outliner */
  placements: Placement[];
}

export type Listener = () => void;

const initial: EditorUiState = {
  visible: false,
  assets: [],
  paletteCurrent: null,
  selection: null,
  selectionAsset: null,
  selectionVersion: 0,
  snapEnabled: true,
  colliderView: 'off',
  hidden: new Set(),
  locked: new Set(),
  placementsVersion: 0,
  placements: [],
};

let state: EditorUiState = initial;
const listeners = new Set<Listener>();

export const uiStore = {
  get(): EditorUiState {
    return state;
  },
  set(partial: Partial<EditorUiState>): void {
    state = { ...state, ...partial };
    for (const l of listeners) l();
  },
  bumpSelection(): void {
    state = { ...state, selectionVersion: state.selectionVersion + 1 };
    for (const l of listeners) l();
  },
  bumpPlacements(): void {
    state = { ...state, placementsVersion: state.placementsVersion + 1 };
    for (const l of listeners) l();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
