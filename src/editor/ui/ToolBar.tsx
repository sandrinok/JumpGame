import { Move3d, Rotate3d, Scale3d, Magnet, CloudFog } from 'lucide-react';
import { cn } from './cn';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';
import type { GizmoMode } from './uiStore';

const TOOLS: Array<{ mode: GizmoMode; label: string; key: string; Icon: typeof Move3d }> = [
  { mode: 'translate', label: 'Move', key: 'G', Icon: Move3d },
  { mode: 'rotate', label: 'Rotate', key: 'R', Icon: Rotate3d },
  { mode: 'scale', label: 'Scale', key: 'S', Icon: Scale3d },
];

/**
 * Transform tools and the two toggles you reach for constantly.
 *
 * The shortcuts existed before this, but nothing on screen showed which tool
 * was active or that they existed at all — you had to open a collapsed panel
 * to find out. Sitting under the menubar keeps it next to the other chrome
 * without covering the viewport.
 */
export function ToolBar(): JSX.Element {
  const { gizmoMode, snapEnabled, fogEnabled } = useEditorUi();
  const a = useEditorActions();

  return (
    <div className="absolute top-3 left-[290px] flex items-center gap-1 rounded-md border border-border bg-card/95 backdrop-blur px-1 h-9 shadow-lg">
      {TOOLS.map(({ mode, label, key, Icon }) => (
        <button
          key={mode}
          type="button"
          title={`${label} (${key})`}
          onClick={() => a.setGizmoMode(mode)}
          className={cn(
            'flex items-center gap-1.5 h-7 px-2 rounded text-xs transition-colors',
            gizmoMode === mode
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
          <span
            className={cn(
              'text-[10px] font-mono',
              gizmoMode === mode ? 'opacity-70' : 'opacity-50',
            )}
          >
            {key}
          </span>
        </button>
      ))}

      <div className="w-px h-5 bg-border mx-1" />

      <Toggle
        active={snapEnabled}
        title="Snap to grid (N)"
        onClick={() => a.setSnap(!snapEnabled)}
        Icon={Magnet}
        label="Snap"
      />
      <Toggle
        active={fogEnabled}
        title="Distance fog (F) — off while editing so far geometry stays readable"
        onClick={() => a.setFog(!fogEnabled)}
        Icon={CloudFog}
        label="Fog"
      />
    </div>
  );
}

function Toggle({
  active,
  title,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  title: string;
  onClick(): void;
  Icon: typeof Move3d;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 h-7 px-2 rounded text-xs transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
