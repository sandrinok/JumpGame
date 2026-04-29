import { useEffect, useState } from 'react';
import { Input } from './components/input';
import type { Vec3 } from '../../world/types';

interface Props {
  label: string;
  value: Vec3 | undefined;
  onChange(v: Vec3 | undefined): void;
}

export function Vec3Input({ label, value, onChange }: Props): JSX.Element {
  const [text, setText] = useState<[string, string, string]>(toText(value));

  useEffect(() => {
    setText(toText(value));
  }, [value]);

  const commit = (i: number, raw: string): void => {
    const next: [string, string, string] = [...text] as [string, string, string];
    next[i] = raw;
    setText(next);
    const allBlank = next.every((s) => s.trim() === '');
    if (allBlank) {
      onChange(undefined);
      return;
    }
    const parsed = next.map((s) => {
      const t = s.trim();
      if (t === '') return 0;
      const n = parseFloat(t);
      return Number.isFinite(n) ? n : 0;
    }) as Vec3;
    onChange(parsed);
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {[0, 1, 2].map((i) => (
        <Input
          key={i}
          value={text[i]}
          onChange={(e) => commit(i, e.currentTarget.value)}
          placeholder="–"
          className="text-center"
        />
      ))}
    </div>
  );
}

function toText(v: Vec3 | undefined): [string, string, string] {
  if (!v) return ['', '', ''];
  return [round(v[0]), round(v[1]), round(v[2])];
}

function round(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}
