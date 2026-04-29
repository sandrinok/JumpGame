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

export function InspectorPanel(): JSX.Element | null {
  const { selection, selectionAsset } = useEditorUi();
  const actions = useEditorActions();

  if (!selection || !selectionAsset) {
    return (
      <Card className="absolute bottom-3 right-3 w-[280px]">
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
    <Card className="absolute bottom-3 right-3 w-[280px] max-h-[80vh] overflow-y-auto">
      <CardHeader>
        <CardTitle>{p.id}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-[10px] leading-relaxed text-muted-foreground space-y-0.5">
          <div className="break-all">uid: {p.uid}</div>
          <div>pos: {fmt(p.pos)}</div>
          <div>rot°: {fmt(toDeg(p.rot))}</div>
          <div>scale: {fmt(p.scale)}</div>
        </div>

        {!isPrimitive ? (
          <>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Collider</div>
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
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Collider overrides (absolute)
              </div>
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
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">Primitive box (collider follows visual)</div>
        )}
      </CardContent>
    </Card>
  );
}

function updateParams(
  next: { offset?: Vec3; size?: Vec3; rot?: Vec3 },
  actions: ReturnType<typeof useEditorActions>,
  prev: { offset?: Vec3; size?: Vec3; rot?: Vec3 } | undefined,
): void {
  // strip undefined keys
  const cleaned: typeof next = {};
  if (next.offset) cleaned.offset = next.offset;
  if (next.size) cleaned.size = next.size;
  if (next.rot) cleaned.rot = next.rot;
  const empty = Object.keys(cleaned).length === 0;
  if (empty && !prev) return;
  actions.changeColliderParams(empty ? null : cleaned);
}

function fmt(v: [number, number, number]): string {
  return `${v[0].toFixed(2)}, ${v[1].toFixed(2)}, ${v[2].toFixed(2)}`;
}

function toDeg(v: Vec3): Vec3 {
  return [(v[0] * 180) / Math.PI, (v[1] * 180) / Math.PI, (v[2] * 180) / Math.PI];
}

function toRad(v: Vec3): Vec3 {
  return [(v[0] * Math.PI) / 180, (v[1] * Math.PI) / 180, (v[2] * Math.PI) / 180];
}
