import { useEditorUi } from './useEditorUi';
import { EditorActionsContext, type EditorActions } from './actions';
import { PalettePanel } from './PalettePanel';
import { InspectorPanel } from './InspectorPanel';
import { Topbar } from './Topbar';
import { Outliner } from './Outliner';
import { FocusBanner } from './FocusBanner';
import { HotkeysPanel } from './HotkeysPanel';

interface Props {
  actions: EditorActions;
}

export function EditorRoot({ actions }: Props): JSX.Element | null {
  const { visible } = useEditorUi();
  if (!visible) return null;
  return (
    <EditorActionsContext.Provider value={actions}>
      <div className="editor-ui-root">
        <Topbar />
        <FocusBanner />
        <PalettePanel />
        <HotkeysPanel />
        <div className="absolute top-16 bottom-3 right-3 flex flex-col items-end gap-3 max-h-[calc(100vh-80px)]">
          <Outliner />
          <InspectorPanel />
        </div>
      </div>
    </EditorActionsContext.Provider>
  );
}
