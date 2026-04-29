import { useSyncExternalStore } from 'react';
import { uiStore, type EditorUiState } from './uiStore';

export function useEditorUi(): EditorUiState {
  return useSyncExternalStore(
    (l) => uiStore.subscribe(l),
    () => uiStore.get(),
    () => uiStore.get(),
  );
}
