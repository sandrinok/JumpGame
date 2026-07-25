import { ScrubInput } from './ScrubInput';
import type { Vec3 } from '../../world/types';

interface Props {
  label: string;
  value: Vec3 | undefined;
  /** Units per pixel while dragging a component. */
  step?: number;
  onChange(v: Vec3 | undefined): void;
}

const AXIS_TINT = ['text-red-400', 'text-green-400', 'text-blue-400'];

export function Vec3Input({ label, value, step = 0.05, onChange }: Props): JSX.Element {
  const setAxis = (i: number, n: number): void => {
    // Collider params start out undefined (meaning "use the derived default"),
    // so editing one axis has to materialise the whole vector.
    const next: Vec3 = value ? ([...value] as Vec3) : [0, 0, 0];
    next[i] = n;
    onChange(next);
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="relative flex-1">
          {/* Axis tint: three identical boxes makes it far too easy to scrub
              the wrong one. */}
          <span
            className={`pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-[9px] font-mono ${AXIS_TINT[i]}`}
          >
            {'XYZ'[i]}
          </span>
          <ScrubInput value={value?.[i]} step={step} onChange={(n) => setAxis(i, n)} placeholder="–" />
        </div>
      ))}
    </div>
  );
}
