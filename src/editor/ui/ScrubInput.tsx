import { useEffect, useRef, useState } from 'react';
import { Input } from './components/input';
import { cn } from './cn';
import { useEditorActions } from './actions';

interface Props {
  value: number | undefined;
  /** Units per pixel dragged. Also sets the rounding of the result. */
  step: number;
  onChange(v: number): void;
  placeholder?: string;
}

/** Under this many pixels a press counts as a click, so the field still focuses. */
const DRAG_THRESHOLD = 3;

/**
 * A number field you can drag.
 *
 * Typing exact values still works, but nudging something into place by
 * selecting the text and retyping it is miserable. Dragging horizontally
 * scrubs the value the way every 3D tool does: Shift for fine, Ctrl for coarse.
 *
 * Pointer capture keeps the drag alive once the cursor leaves the field, which
 * happens almost immediately — these are about 60px wide.
 */
export function ScrubInput({ value, step, onChange, placeholder }: Props): JSX.Element {
  const [text, setText] = useState(() => format(value, step));
  const drag = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);
  const focused = useRef(false);
  const actions = useEditorActions();

  // Track external changes (gizmo drags, undo, selecting another object) but
  // never overwrite what the user is currently typing or scrubbing.
  useEffect(() => {
    if (!focused.current && !drag.current) setText(format(value, step));
  }, [value, step]);

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>): void => {
    if (e.button !== 0) return;
    drag.current = { startX: e.clientX, startValue: value ?? 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLInputElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      // One undo step for the whole drag, not one per pixel.
      actions.beginEdit();
      // pointerdown focuses the field. Leaving it focused after a scrub means
      // the editor's own hotkeys stay suppressed, so the Ctrl+Z you press right
      // after dragging goes to the text box instead of undoing the drag.
      // Pointer capture is unaffected by blurring.
      e.currentTarget.blur();
    }

    const scale = e.shiftKey ? 0.1 : e.ctrlKey || e.metaKey ? 10 : 1;
    const effective = step * scale;
    // Snap to the effective step, or floating point leaves you with values like
    // 0.30000000000000004 after a few pixels of dragging.
    const next = round(d.startValue + dx * effective, effective);
    setText(format(next, effective));
    onChange(next);
  };

  const endDrag = (e: React.PointerEvent<HTMLInputElement>): void => {
    const d = drag.current;
    if (!d) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // A press that never moved is a click: let it focus so you can type.
    if (d.moved) actions.endEdit('scrub value');
    else e.currentTarget.focus();
    drag.current = null;
  };

  return (
    <Input
      value={text}
      placeholder={placeholder}
      className={cn('text-center cursor-ew-resize')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onFocus={() => (focused.current = true)}
      onBlur={(e) => {
        focused.current = false;
        setText(format(parse(e.currentTarget.value), step));
      }}
      onChange={(e) => {
        // Keep the raw string so half-typed input like "1." or "-" survives.
        setText(e.currentTarget.value);
        const parsed = parse(e.currentTarget.value);
        if (parsed !== undefined) onChange(parsed);
      }}
    />
  );
}

function parse(raw: string): number | undefined {
  const t = raw.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function round(n: number, step: number): number {
  const decimals = decimalsFor(step);
  return Number((Math.round(n / step) * step).toFixed(decimals));
}

function decimalsFor(step: number): number {
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))));
}

function format(v: number | undefined, step: number): string {
  if (v === undefined || !Number.isFinite(v)) return '';
  // Trim trailing zeros: "1.50" reads worse than "1.5" in a narrow field.
  return String(Number(v.toFixed(decimalsFor(step))));
}
