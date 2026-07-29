import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/card';
import { Input } from './components/input';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';
import { ASSET_DRAG_TYPE } from '../editor';
import { createThumbnailMaker } from '../thumbnails';
import type { ResolvedAsset } from '../../world/registry';

/**
 * One shared renderer for every preview in the palette.
 *
 * Module scope rather than a hook, because it owns a WebGL context. Browsers
 * allow a limited number of those, and creating one per mount would leak them
 * every time the panel is toggled.
 */
const thumbnails = createThumbnailMaker();

/**
 * Ids sharing a prefix before it counts as a pack name rather than a family.
 *
 * Five rather than three because a pack contains groups as well: three barrels
 * share `psx_industrial_pack_barrel`, and at a lower threshold they would be
 * labelled "oil", "water" and "wine" with the word "barrel" stripped away as
 * though it were the pack's name.
 */
const PREFIX_SHARED_BY = 5;
/** A label shorter than this is no label at all, so the prefix stays. */
const MIN_LABEL = 3;

/**
 * Work out what to call each asset on its tile.
 *
 * A split pack leaves every prop carrying the pack's name —
 * `psx_industrial_pack_barrel_oil` and thirty-five siblings — and in a tile
 * eighty pixels wide all thirty-six read "psx industrial …". The distinguishing
 * part is at the end, so the shared prefix is dropped.
 *
 * Only prefixes several assets actually share, and never when what is left
 * would be shorter than a word: `city_road`, `city_road_2` and `city_road_3`
 * share "city road", and stripping it would label them "2" and "3".
 */
function labelsFor(ids: string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const parts = id.split('_');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('_');
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }

  const labels = new Map<string, string>();
  for (const id of ids) {
    const parts = id.split('_');
    let label = id;
    // Longest first, so the pack name wins over the word it starts with.
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join('_');
      if ((counts.get(prefix) ?? 0) < PREFIX_SHARED_BY) continue;
      const rest = id.slice(prefix.length + 1);
      if (rest.length >= MIN_LABEL) {
        label = rest;
        break;
      }
    }
    labels.set(id, label.replace(/[_-]+/g, ' ').trim());
  }
  return labels;
}

export function PalettePanel(): JSX.Element | null {
  const { assets, paletteCurrent, paletteVisible } = useEditorUi();
  const [filter, setFilter] = useState('');

  // Derived from the whole library, not the filtered view, so a label does not
  // change as you type.
  const labels = useMemo(() => labelsFor(assets.map((a) => a.id)), [assets]);

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
    <Card className="absolute top-16 left-3 w-[268px] max-h-[70vh] flex flex-col">
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
      <CardContent className="flex-1 overflow-y-auto">
        {assets.length === 0 && (
          <div className="text-xs text-muted-foreground italic">No assets loaded</div>
        )}
        {assets.length > 0 && shown.length === 0 && (
          <div className="text-xs text-muted-foreground italic">Nothing matches “{filter}”</div>
        )}
        <div className="grid grid-cols-3 gap-1">
          {shown.map((a) => (
            <AssetTile
              key={a.id}
              asset={a}
              label={labels.get(a.id) ?? a.id}
              selected={paletteCurrent === a.id}
            />
          ))}
        </div>
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

function AssetTile({
  asset,
  label,
  selected,
}: {
  asset: ResolvedAsset;
  label: string;
  selected: boolean;
}): JSX.Element {
  const actions = useEditorActions();
  const ref = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Rendered only once the tile is actually on screen. Drawing all hundred and
  // forty up front is a visible stall when the palette opens, and a filter
  // usually means only a handful are ever looked at.
  useEffect(() => {
    if (preview) return;
    const el = ref.current;
    if (!el) return;
    let live = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        void thumbnails.get(asset).then((url) => {
          // Scrolling past quickly enough unmounts the tile before its preview
          // is ready; the render still finishes and stays cached for next time.
          if (live) setPreview(url);
        });
      },
      { root: el.closest('[class*="overflow-y-auto"]') ?? null, rootMargin: '120px' },
    );
    observer.observe(el);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [asset, preview]);

  return (
    <button
      ref={ref}
      type="button"
      draggable
      title={asset.id}
      className={[
        'group flex flex-col items-center gap-0.5 rounded border p-1 cursor-grab active:cursor-grabbing',
        'transition-colors',
        selected
          ? 'border-primary bg-primary/15'
          : 'border-transparent bg-secondary hover:bg-secondary/70',
      ].join(' ')}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
        e.dataTransfer.effectAllowed = 'copy';
        actions.selectPaletteId(asset.id);
      }}
      onClick={() => actions.selectPaletteId(asset.id)}
      onDoubleClick={() => actions.placeAtCursor(asset.id)}
    >
      <span className="flex h-[62px] w-full items-center justify-center overflow-hidden rounded-sm bg-black/25">
        {preview ? (
          <img
            src={preview}
            alt=""
            draggable={false}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="h-3 w-3 animate-pulse rounded-full bg-muted-foreground/40" />
        )}
      </span>
      {/*
        The full id lives in the tooltip. Shown here it would wrap to four lines
        for names like fortnite_-_pizza_planet_delivery_truck and push the grid
        into a column of text again.
      */}
      <span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
    </button>
  );
}
