import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/card';
import { Button } from './components/button';
import { Input } from './components/input';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';
import { ASSET_DRAG_TYPE } from '../editor';

export function PalettePanel(): JSX.Element | null {
  const { assets, paletteCurrent, paletteVisible } = useEditorUi();
  const actions = useEditorActions();
  const [filter, setFilter] = useState('');

  // Every word has to match, so "city car" finds city_vehicles_cars without
  // caring about the order or the underscores between them.
  const shown = useMemo(() => {
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return assets;
    return assets.filter((a) => {
      const id = a.id.toLowerCase();
      return terms.every((t) => id.includes(t));
    });
  }, [assets, filter]);

  if (!paletteVisible) return null;

  return (
    <Card className="absolute top-16 left-3 w-[210px] max-h-[60vh] flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-baseline justify-between gap-2">
          <span>Assets</span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {shown.length === assets.length ? assets.length : `${shown.length} / ${assets.length}`}
          </span>
        </CardTitle>
        <div className="relative mt-1.5">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
            placeholder="Filter…"
            className="pl-6"
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto flex flex-col gap-1">
        {assets.length === 0 && (
          <div className="text-xs text-muted-foreground italic">No assets loaded</div>
        )}
        {assets.length > 0 && shown.length === 0 && (
          <div className="text-xs text-muted-foreground italic">Nothing matches “{filter}”</div>
        )}
        {shown.map((a) => (
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
