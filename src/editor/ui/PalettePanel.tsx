import { Card, CardContent, CardHeader, CardTitle } from './components/card';
import { Button } from './components/button';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';

export function PalettePanel(): JSX.Element {
  const { assets, paletteCurrent } = useEditorUi();
  const actions = useEditorActions();

  return (
    <Card className="absolute top-16 left-3 w-[230px] max-h-[75vh] flex flex-col">
      <CardHeader>
        <CardTitle>Assets</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto flex flex-col gap-1">
        {assets.length === 0 && (
          <div className="text-xs text-muted-foreground italic">No assets loaded</div>
        )}
        {assets.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={paletteCurrent === a.id ? 'default' : 'secondary'}
            className="justify-start font-normal"
            onClick={() => actions.selectPaletteId(a.id)}
          >
            {a.id}
          </Button>
        ))}
      </CardContent>
      <div className="px-3 pb-3 text-[10px] leading-relaxed text-muted-foreground border-t border-border pt-2">
        <div className="font-semibold text-foreground/80 mb-1">Edit mode (F1)</div>
        <div>Cam: hold RMB + WASD/QE · Shift fast · Alt slow</div>
        <div>LMB select · Enter/B place selected asset</div>
        <div>G translate · R rotate · S scale</div>
        <div>X delete · Ctrl+D duplicate · Esc deselect</div>
        <div>N snap · C collider view (cycle)</div>
        <div>Ctrl+Z undo · Ctrl+S save · Ctrl+O load</div>
      </div>
    </Card>
  );
}
