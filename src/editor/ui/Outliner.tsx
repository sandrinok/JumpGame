import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, Unlock, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/card';
import { Input } from './components/input';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';
import { cn } from './cn';
import type { Placement } from '../../world/types';

interface Group {
  id: string;
  placements: Placement[];
}

export function Outliner(): JSX.Element {
  const { selection, hidden, locked, placements } = useEditorUi();
  const actions = useEditorActions();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo<Group[]>(() => {
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? placements.filter((p) => p.id.toLowerCase().includes(f) || p.uid.toLowerCase().includes(f))
      : placements;
    const byId = new Map<string, Placement[]>();
    for (const p of filtered) {
      const arr = byId.get(p.id) ?? [];
      arr.push(p);
      byId.set(p.id, arr);
    }
    return [...byId.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, ps]) => ({ id, placements: ps }));
  }, [placements, filter]);

  const selectedUid = selection?.placement.uid ?? null;

  return (
    <Card className="w-[300px] flex-1 min-h-0 flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span>Outliner</span>
          <span className="text-[10px] font-normal text-muted-foreground">
            {groups.reduce((n, g) => n + g.placements.length, 0)} items
          </span>
        </CardTitle>
        <div className="relative mt-1">
          <Search className="absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
          <Input
            value={filter}
            placeholder="Filter…"
            onChange={(e) => setFilter(e.currentTarget.value)}
            className="pl-7"
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto pt-0 space-y-1.5">
        {groups.length === 0 && (
          <div className="text-xs text-muted-foreground italic py-3 text-center">
            {filter ? 'No matches' : 'Empty level — drag a .glb or pick from the palette'}
          </div>
        )}
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          return (
            <div key={group.id}>
              <button
                className="w-full flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground py-1"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (isCollapsed) next.delete(group.id);
                  else next.add(group.id);
                  setCollapsed(next);
                }}
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                <span>{group.id}</span>
                <span className="ml-auto opacity-60">{group.placements.length}</span>
              </button>
              {!isCollapsed && (
                <div className="ml-1 border-l border-border pl-1 space-y-0.5">
                  {group.placements.map((p) => {
                    const isSelected = selectedUid === p.uid;
                    const isHidden = hidden.has(p.uid);
                    const isLocked = locked.has(p.uid);
                    return (
                      <div
                        key={p.uid}
                        className={cn(
                          'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs cursor-pointer',
                          isSelected ? 'bg-primary/20 text-foreground' : 'hover:bg-accent/60',
                          isHidden && 'opacity-50',
                        )}
                        onClick={() => actions.selectByUid(p.uid)}
                      >
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            actions.toggleHidden(p.uid);
                          }}
                          title={isHidden ? 'Show' : 'Hide'}
                        >
                          {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                        <button
                          className={cn(
                            'hover:text-foreground',
                            isLocked ? 'text-amber-400' : 'text-muted-foreground',
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            actions.toggleLocked(p.uid);
                          }}
                          title={isLocked ? 'Unlock' : 'Lock'}
                        >
                          {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                        </button>
                        <span className="truncate font-mono text-[10px]">{p.uid}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

