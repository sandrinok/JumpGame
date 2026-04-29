import { useEditorUi } from './useEditorUi';
import { EditorActionsContext, type EditorActions } from './actions';
import { PalettePanel } from './PalettePanel';
import { InspectorPanel } from './InspectorPanel';

interface Props {
  actions: EditorActions;
}

export function EditorRoot({ actions }: Props): JSX.Element | null {
  const { visible } = useEditorUi();
  if (!visible) return null;
  return (
    <EditorActionsContext.Provider value={actions}>
      <div className="editor-ui-root">
        <PalettePanel />
        <InspectorPanel />
      </div>
    </EditorActionsContext.Provider>
  );
}
