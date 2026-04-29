import { Card, CardContent, CardHeader, CardTitle } from './components/card';
import { Button } from './components/button';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';

export function PalettePanel(): JSX.Element | null {
  const { assets, paletteCurrent, paletteVisible } = useEditorUi();
  const actions = useEditorActions();

  if (!paletteVisible) return null;

  return (
    <Card className="absolute top-16 left-3 w-[210px] max-h-[60vh] flex flex-col">
      <CardHeader className="pb-2">
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
    </Card>
  );
}
