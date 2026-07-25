import { Card, CardContent, CardHeader, CardTitle } from './components/card';
import { Button } from './components/button';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';
import { ASSET_DRAG_TYPE } from '../editor';

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
            className="justify-start font-normal cursor-grab active:cursor-grabbing"
            draggable
            title={`Drag ${a.id} into the world, or double-click to place it`}
            onDragStart={(e) => {
              e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id);
              e.dataTransfer.effectAllowed = 'copy';
              actions.selectPaletteId(a.id);
            }}
            onClick={() => actions.selectPaletteId(a.id)}
            onDoubleClick={() => actions.placeAtCursor(a.id)}
          >
            {a.id}
          </Button>
        ))}
      </CardContent>
      {/*
        Selecting an asset used to be the only thing a click did, with placing
        hidden behind an unlabelled B / Enter shortcut and the hotkeys panel
        collapsed by default — so the palette looked broken.
      */}
      <div className="px-3 pb-2 pt-1 text-[10px] leading-tight text-muted-foreground border-t border-border">
        Drag into the world, or double-click.
        {paletteCurrent && (
          <>
            {' '}
            <span className="text-foreground">B</span> places the selected one where you point.
          </>
        )}
      </div>
    </Card>
  );
}
