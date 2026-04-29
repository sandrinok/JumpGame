import { createContext, useContext } from 'react';
import type { ColliderParams, ColliderShape } from '../../world/types';

export interface EditorActions {
  selectPaletteId(id: string | null): void;
  placeAtCursor(id: string): void;
  changeCollider(shape: ColliderShape | null): void;
  changeColliderParams(params: ColliderParams | null): void;
}

const noop: EditorActions = {
  selectPaletteId: () => undefined,
  placeAtCursor: () => undefined,
  changeCollider: () => undefined,
  changeColliderParams: () => undefined,
};

export const EditorActionsContext = createContext<EditorActions>(noop);
export function useEditorActions(): EditorActions {
  return useContext(EditorActionsContext);
}
