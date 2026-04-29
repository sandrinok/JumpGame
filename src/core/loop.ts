export type UpdateFn = (dt: number) => void;
export type RenderFn = () => void;

const FIXED_DT = 1 / 60;
const MAX_ACCUM = 0.25;

export function startLoop(update: UpdateFn, render: RenderFn): void {
  let last = performance.now() / 1000;
  let accum = 0;

  const tick = () => {
    const now = performance.now() / 1000;
    let frame = now - last;
    last = now;
    if (frame > MAX_ACCUM) frame = MAX_ACCUM;
    accum += frame;

    while (accum >= FIXED_DT) {
      update(FIXED_DT);
      accum -= FIXED_DT;
    }

    render();
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}
