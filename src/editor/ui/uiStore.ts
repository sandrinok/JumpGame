import type { ResolvedAsset } from '../../world/registry';
import type { RenderedPlacement } from '../../world/level';

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
}

export type Listener = () => void;

const initial: EditorUiState = {
  visible: false,
  assets: [],
  paletteCurrent: null,
  selection: null,
  selectionAsset: null,
  selectionVersion: 0,
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
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
