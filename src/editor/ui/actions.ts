import { createContext, useContext } from 'react';
import type { ColliderParams, ColliderShape } from '../../world/types';
import type { DebugMode } from '../../physics/debugView';

export interface EditorActions {
  selectPaletteId(id: string | null): void;
  placeAtCursor(id: string): void;
  changeCollider(shape: ColliderShape | null): void;
  changeColliderParams(params: ColliderParams | null): void;
  // file
  newLevel(): void;
  openLevel(): void;
  saveLevel(): void;
  saveLevelAs(): void;
  importGlbs(files: File[]): Promise<void>;
  // edit
  undo(): void;
  redo(): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  // view
  setColliderView(mode: DebugMode): void;
  setSnap(enabled: boolean): void;
  exitEditor(): void;
}

const noop: EditorActions = {
  selectPaletteId: () => undefined,
  placeAtCursor: () => undefined,
  changeCollider: () => undefined,
  changeColliderParams: () => undefined,
  newLevel: () => undefined,
  openLevel: () => undefined,
  saveLevel: () => undefined,
  saveLevelAs: () => undefined,
  importGlbs: async () => undefined,
  undo: () => undefined,
  redo: () => undefined,
  duplicateSelected: () => undefined,
  deleteSelected: () => undefined,
  setColliderView: () => undefined,
  setSnap: () => undefined,
  exitEditor: () => undefined,
};

export const EditorActionsContext = createContext<EditorActions>(noop);
export function useEditorActions(): EditorActions {
  return useContext(EditorActionsContext);
}
