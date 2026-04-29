import { ChevronDown, ChevronUp, Keyboard } from 'lucide-react';
import { Card } from './components/card';
import { uiStore } from './uiStore';
import { useEditorUi } from './useEditorUi';

const ROWS: Array<[string, string]> = [
  ['F1', 'Toggle editor'],
  ['RMB + WASD/QE', 'Fly camera (Shift fast / Alt slow)'],
  ['Scroll while RMB', 'Adjust fly speed'],
  ['LMB', 'Select placement'],
  ['Enter / B', 'Place selected asset'],
  ['G/T · R · S', 'Translate · Rotate · Scale'],
  ['X / Del', 'Delete selected'],
  ['Ctrl+D', 'Duplicate selected'],
  ['Esc', 'Deselect / exit focus'],
  ['N', 'Toggle snap (0.5m / 15°)'],
  ['C', 'Cycle collider view'],
  ['Numpad 1/3/7', 'Front / Right / Top view'],
  ['Numpad 5', 'Toggle ortho'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'],
  ['Ctrl+S / Ctrl+O', 'Save / Open level'],
];

export function HotkeysPanel(): JSX.Element {
  const { hotkeysCollapsed } = useEditorUi();
  const toggle = (): void => uiStore.set({ hotkeysCollapsed: !hotkeysCollapsed });

  return (
    <Card className="absolute bottom-3 left-3 w-[300px]">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-sm font-semibold hover:bg-accent/40 rounded-t-lg"
      >
        <span className="flex items-center gap-2">
          <Keyboard className="h-3.5 w-3.5 text-muted-foreground" />
          Hotkeys
        </span>
        {hotkeysCollapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {!hotkeysCollapsed && (
        <div className="px-3 pb-3 max-h-[40vh] overflow-y-auto">
          <table className="w-full text-[11px] border-separate border-spacing-y-0.5">
            <tbody>
              {ROWS.map(([keys, label]) => (
                <tr key={keys}>
                  <td className="font-mono text-muted-foreground whitespace-nowrap pr-2 align-top">{keys}</td>
                  <td className="text-foreground/90">{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
