import { Focus } from 'lucide-react';
import { Button } from './components/button';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';

export function FocusBanner(): JSX.Element | null {
  const { colliderFocusUid, selection } = useEditorUi();
  const actions = useEditorActions();
  if (!colliderFocusUid) return null;
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-md bg-primary text-primary-foreground px-4 py-1.5 shadow-lg">
      <Focus className="h-4 w-4" />
      <span className="text-sm font-semibold">
        Editing collider · {selection?.placement.id ?? colliderFocusUid}
      </span>
      <Button size="xs" variant="secondary" onClick={() => actions.exitColliderFocus()}>
        Done (Esc)
      </Button>
    </div>
  );
}
