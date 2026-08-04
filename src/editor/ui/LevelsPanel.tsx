import { useState } from 'react';
import { PanelRightClose, PanelRightOpen, RefreshCw, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/card';
import { Button } from './components/button';
import { Input } from './components/input';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';
import { uiStore } from './uiStore';
import { cn } from './cn';
import { isValidLevelName, toLevelName } from '../../persistence/levelLibrary';

/** "dev.json" -> "dev". The extension is the same on every row; the name is not. */
function stem(name: string): string {
  return name.replace(/\.json$/i, '');
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * The level browser.
 *
 * Loading one replaces everything in the world — there is no merging and no
 * layering, so what you see is always exactly one level. The only thing that
 * can be lost doing it is unsaved work, which is what the confirm row guards.
 */
export function LevelsPanel(): JSX.Element {
  const { levels, levelsLoading, levelsError, currentLevel, dirty, levelsCollapsed } =
    useEditorUi();
  const actions = useEditorActions();
  /** Level the user picked while there were unsaved changes, awaiting confirmation. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saveAs, setSaveAs] = useState('');
  const [showSaveAs, setShowSaveAs] = useState(false);

  const toggleCollapsed = (): void => uiStore.set({ levelsCollapsed: !levelsCollapsed });

  const load = (name: string): void => {
    setConfirming(null);
    void actions.loadLevelNamed(name);
  };

  const pick = (name: string): void => {
    if (dirty) setConfirming(name);
    else load(name);
  };

  const commitSaveAs = (): void => {
    const name = toLevelName(saveAs);
    if (!isValidLevelName(name)) return;
    void actions.saveLevelNamed(name).then(() => {
      setSaveAs('');
      setShowSaveAs(false);
    });
  };

  if (levelsCollapsed) {
    return (
      <Card className="w-auto self-end shrink-0">
        <button
          onClick={toggleCollapsed}
          title="Show levels"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs hover:bg-accent/40"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
          <span>
            Levels{currentLevel ? ` — ${stem(currentLevel)}` : ''}
            {dirty ? ' •' : ''}
          </span>
        </button>
      </Card>
    );
  }

  const typedName = toLevelName(saveAs);
  const nameOk = isValidLevelName(typedName);

  return (
    <Card className="w-[230px] shrink-0 flex flex-col max-h-[45vh]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Levels</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void actions.refreshLevels()}
              title="Refresh list"
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn('h-3 w-3', levelsLoading && 'animate-spin')} />
            </button>
            <button
              onClick={toggleCollapsed}
              title="Collapse"
              className="text-muted-foreground hover:text-foreground"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto pt-0 space-y-0.5">
        {levelsError && (
          <div className="text-[11px] text-destructive-foreground bg-destructive/20 rounded px-1.5 py-1 mb-1">
            {levelsError}
          </div>
        )}
        {levels.length === 0 && !levelsLoading && !levelsError && (
          <div className="text-xs text-muted-foreground italic py-3 text-center">
            No levels on the server yet
          </div>
        )}
        {levels.map((l) => {
          const isCurrent = l.name === currentLevel;
          const isConfirming = confirming === l.name;
          return (
            <div key={l.name}>
              <button
                className={cn(
                  'w-full flex items-baseline gap-1.5 px-1.5 py-1 rounded text-xs text-left',
                  isCurrent ? 'bg-primary/20 text-foreground' : 'hover:bg-accent/60',
                )}
                onClick={() => pick(l.name)}
                disabled={levelsLoading}
                title={`${l.name} — ${(l.size / 1024).toFixed(1)} KB`}
              >
                <span className="truncate flex-1">{stem(l.name)}</span>
                {isCurrent && dirty && <span title="Unsaved changes">•</span>}
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {l.placements === null ? '—' : l.placements}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0 w-12 text-right">
                  {formatWhen(l.modified)}
                </span>
              </button>
              {isConfirming && (
                <div className="mx-1.5 my-1 rounded border border-border bg-background/60 p-1.5 space-y-1">
                  <div className="text-[11px] text-muted-foreground leading-snug">
                    Unsaved changes in {currentLevel ? stem(currentLevel) : 'this level'} will be
                    lost.
                  </div>
                  <div className="flex gap-1">
                    <Button size="xs" variant="destructive" onClick={() => load(l.name)}>
                      Discard &amp; load
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      <div className="border-t border-border p-2 space-y-1.5">
        {showSaveAs ? (
          <>
            <Input
              autoFocus
              value={saveAs}
              placeholder="new-level-name"
              onChange={(e) => setSaveAs(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSaveAs();
                if (e.key === 'Escape') setShowSaveAs(false);
              }}
            />
            <div className="flex items-center gap-1">
              <Button size="xs" onClick={commitSaveAs} disabled={!nameOk || levelsLoading}>
                Save as {nameOk ? `${typedName}.json` : '…'}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setShowSaveAs(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <Button
            size="xs"
            variant="outline"
            className="w-full"
            onClick={() => {
              setSaveAs(currentLevel ? stem(currentLevel) : '');
              setShowSaveAs(true);
            }}
          >
            <Save className="h-3 w-3" />
            Save as new level…
          </Button>
        )}
      </div>
    </Card>
  );
}
