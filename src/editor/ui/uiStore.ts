import type { ResolvedAsset } from '../../world/registry';
import type { RenderedPlacement } from '../../world/level';
import type { DebugMode } from '../../physics/debugView';
import type { AssetColliderOverride, Placement } from '../../world/types';
import type { LevelSummary } from '../../persistence/levelLibrary';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

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
  /** Active transform gizmo. Mirrors Editor.gizmoMode so the toolbar can show it. */
  gizmoMode: GizmoMode;
  /** Scene fog. Off by default in the editor so distant geometry stays readable. */
  fogEnabled: boolean;
  colliderView: DebugMode;
  /** uids that are hidden in editor (not persisted) */
  hidden: Set<string>;
  /** uids that are locked in editor (not persisted) */
  locked: Set<string>;
  /** monotonic counter, bumped whenever placements are added/removed */
  placementsVersion: number;
  /** snapshot of all level placements for the outliner */
  placements: Placement[];
  /** snapshot of asset-level collider overrides */
  assetOverrides: Record<string, AssetColliderOverride>;
  /** uid of placement we are in edit-collider focus mode on, null = normal editor */
  colliderFocusUid: string | null;
  paletteVisible: boolean;
  outlinerCollapsed: boolean;
  hotkeysCollapsed: boolean;
  /** Levels on the server, for the level browser. Empty until first refresh. */
  levels: LevelSummary[];
  /** A listing or a level load is in flight. */
  levelsLoading: boolean;
  /** Last listing/load failure, shown in the browser. */
  levelsError: string | null;
  /** Filename of the loaded level, e.g. "dev.json". null = never saved anywhere. */
  currentLevel: string | null;
  /**
   * Edits made since the level was last loaded or saved.
   *
   * Set from the undo history, so it goes true on any recorded change and stays
   * true even if you undo back to where you started. It decides whether loading
   * another level asks first, and erring towards asking is the harmless way
   * round.
   */
  dirty: boolean;
  levelsCollapsed: boolean;
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
  gizmoMode: 'translate',
  fogEnabled: false,
  colliderView: 'off',
  hidden: new Set(),
  locked: new Set(),
  placementsVersion: 0,
  placements: [],
  assetOverrides: {},
  colliderFocusUid: null,
  paletteVisible: true,
  outlinerCollapsed: false,
  hotkeysCollapsed: true,
  levels: [],
  levelsLoading: false,
  levelsError: null,
  currentLevel: null,
  dirty: false,
  levelsCollapsed: false,
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
