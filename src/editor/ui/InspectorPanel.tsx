import { Card, CardContent, CardHeader, CardTitle } from './components/card';
import { Button } from './components/button';
import { useEditorUi } from './useEditorUi';
import { useEditorActions } from './actions';
import { Vec3Input } from './Vec3Input';
import type { ColliderShape, Vec3 } from '../../world/types';

const COLLIDER_OPTIONS: Array<{ value: ColliderShape; label: string; hint: string }> = [
  { value: 'box', label: 'Box', hint: 'AABB · fastest, very reliable' },
  { value: 'sphere', label: 'Sphere', hint: 'Ball · ideal for round props' },
  { value: 'cylinder', label: 'Cyl', hint: 'Y-aligned cylinder · pillars' },
  { value: 'capsule', label: 'Caps', hint: 'Y-aligned capsule · smooth tops' },
  { value: 'cone', label: 'Cone', hint: 'Y-aligned cone · spikes' },
  { value: 'convex', label: 'Convex', hint: 'Convex hull · good middle ground' },
  { value: 'trimesh', label: 'Tri', hint: 'Exact · slowest, only for static' },
];

export function InspectorPanel(): JSX.Element {
  const { selection, selectionAsset, colliderFocusUid } = useEditorUi();
  const actions = useEditorActions();

  if (!selection || !selectionAsset) {
    return (
      <Card className="w-[300px]">
        <CardHeader>
          <CardTitle className="text-muted-foreground italic">No selection</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const p = selection.placement;
  const def = selectionAsset.def;
  const isPrimitive = def.kind === 'primitive';
  const defaultCollider = !isPrimitive ? def.collider : null;
  const active = p.collider ?? defaultCollider;
  const params = p.colliderParams ?? {};

  return (
    <Card className="w-[300px] max-h-[45vh] overflow-y-auto shrink-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-baseline justify-between gap-2">
          <span className="truncate">{p.id}</span>
          <span className="text-[10px] font-normal text-muted-foreground font-mono shrink-0 truncate">{p.uid}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <SectionLabel>Transform</SectionLabel>
          <div className="flex flex-col gap-1.5">
            <Vec3Input
              label="Pos"
              value={p.pos}
              onChange={(v) => v && actions.changeTransform(v, undefined, undefined)}
            />
            <Vec3Input
              label="Rot°"
              value={toDeg(p.rot)}
              onChange={(v) => v && actions.changeTransform(undefined, toRad(v), undefined)}
            />
            <Vec3Input
              label="Scale"
              value={p.scale}
              onChange={(v) => v && actions.changeTransform(undefined, undefined, v)}
            />
          </div>
        </div>

        {!isPrimitive ? (
          <>
            <div>
              <SectionLabel>Collider</SectionLabel>
              <div className="grid grid-cols-4 gap-1">
                {COLLIDER_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    size="xs"
                    variant={active === opt.value ? 'default' : 'secondary'}
                    title={opt.hint}
                    onClick={() => actions.changeCollider(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              {p.collider !== undefined && p.collider !== defaultCollider && (
                <Button
                  size="xs"
                  variant="outline"
                  className="w-full mt-1.5"
                  onClick={() => actions.changeCollider(null)}
                >
                  Use asset default ({defaultCollider})
                </Button>
              )}
            </div>

            <div>
              <SectionLabel>Collider overrides (absolute)</SectionLabel>
              <div className="flex flex-col gap-1.5">
                <Vec3Input
                  label="Offset"
                  value={params.offset}
                  onChange={(v) => updateParams({ ...params, offset: v }, actions, p.colliderParams)}
                />
                <Vec3Input
                  label="Size"
                  value={params.size}
                  onChange={(v) => updateParams({ ...params, size: v }, actions, p.colliderParams)}
                />
                <Vec3Input
                  label="Rot°"
                  value={params.rot ? toDeg(params.rot) : undefined}
                  onChange={(v) => updateParams({ ...params, rot: v ? toRad(v) : undefined }, actions, p.colliderParams)}
                />
              </div>
              {(params.offset || params.size || params.rot) && (
                <Button
                  size="xs"
                  variant="outline"
                  className="w-full mt-1.5"
                  onClick={() => actions.changeColliderParams(null)}
                >
                  Reset all overrides
                </Button>
              )}
              {colliderFocusUid === p.uid ? (
                <Button
                  size="xs"
                  variant="default"
                  className="w-full mt-1.5"
                  onClick={() => actions.exitColliderFocus()}
                >
                  Done editing collider (Esc)
                </Button>
              ) : (
                <Button
                  size="xs"
                  variant="outline"
                  className="w-full mt-1.5"
                  onClick={() => actions.enterColliderFocus(p.uid)}
                >
                  Edit collider in isolation
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">Primitive box (collider follows visual)</div>
        )}
      </CardContent>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">{children}</div>;
}

function updateParams(
  next: { offset?: Vec3; size?: Vec3; rot?: Vec3 },
  actions: ReturnType<typeof useEditorActions>,
  prev: { offset?: Vec3; size?: Vec3; rot?: Vec3 } | undefined,
): void {
  const cleaned: typeof next = {};
  if (next.offset) cleaned.offset = next.offset;
  if (next.size) cleaned.size = next.size;
  if (next.rot) cleaned.rot = next.rot;
  const empty = Object.keys(cleaned).length === 0;
  if (empty && !prev) return;
  actions.changeColliderParams(empty ? null : cleaned);
}

function toDeg(v: Vec3): Vec3 {
  return [(v[0] * 180) / Math.PI, (v[1] * 180) / Math.PI, (v[2] * 180) / Math.PI];
}

function toRad(v: Vec3): Vec3 {
  return [(v[0] * Math.PI) / 180, (v[1] * Math.PI) / 180, (v[2] * Math.PI) / 180];
}
