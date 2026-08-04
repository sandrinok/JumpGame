import { createContext, useContext } from 'react';
import type { ColliderParams, ColliderShape } from '../../world/types';
import type { DebugMode } from '../../physics/debugView';
import type { ViewName } from '../cameraController';
import type { GizmoMode } from './uiStore';

export interface EditorActions {
  selectPaletteId(id: string | null): void;
  placeAtCursor(id: string): void;
  changeTransform(pos?: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]): void;
  changeCollider(shape: ColliderShape | null): void;
  changeColliderParams(params: ColliderParams | null): void;
  // file
  newLevel(): void;
  openLevel(): void;
  saveLevel(): void;
  saveLevelAs(): void;
  importGlbs(files: File[]): Promise<void>;
  // level library
  /** Re-read the server's list of levels. */
  refreshLevels(): Promise<void>;
  /** Load a level by filename, replacing everything currently in the world. */
  loadLevelNamed(name: string): Promise<void>;
  /** Write the current level to the server under `name` (no extension). */
  saveLevelNamed(name: string): Promise<void>;
  // edit
  undo(): void;
  redo(): void;
  duplicateSelected(): void;
  deleteSelected(): void;
  // view
  setColliderView(mode: DebugMode): void;
  setSnap(enabled: boolean): void;
  setGizmoMode(mode: GizmoMode): void;
  setFog(enabled: boolean): void;
  /** Collapse every edit until endEdit() into a single undo step. */
  beginEdit(): void;
  endEdit(label: string): void;
  exitEditor(): void;
  // outliner
  selectByUid(uid: string): void;
  toggleHidden(uid: string): void;
  toggleLocked(uid: string): void;
  // camera
  snapView(view: ViewName): void;
  toggleOrtho(): void;
  enterColliderFocus(uid: string): void;
  exitColliderFocus(): void;
}

const noop: EditorActions = {
  selectPaletteId: () => undefined,
  placeAtCursor: () => undefined,
  changeTransform: () => undefined,
  changeCollider: () => undefined,
  changeColliderParams: () => undefined,
  newLevel: () => undefined,
  openLevel: () => undefined,
  saveLevel: () => undefined,
  saveLevelAs: () => undefined,
  importGlbs: async () => undefined,
  refreshLevels: async () => undefined,
  loadLevelNamed: async () => undefined,
  saveLevelNamed: async () => undefined,
  undo: () => undefined,
  redo: () => undefined,
  duplicateSelected: () => undefined,
  deleteSelected: () => undefined,
  setColliderView: () => undefined,
  setSnap: () => undefined,
  setGizmoMode: () => undefined,
  setFog: () => undefined,
  beginEdit: () => undefined,
  endEdit: () => undefined,
  exitEditor: () => undefined,
  selectByUid: () => undefined,
  toggleHidden: () => undefined,
  toggleLocked: () => undefined,
  snapView: () => undefined,
  toggleOrtho: () => undefined,
  enterColliderFocus: () => undefined,
  exitColliderFocus: () => undefined,
};

export const EditorActionsContext = createContext<EditorActions>(noop);
export function useEditorActions(): EditorActions {
  return useContext(EditorActionsContext);
}
