export type UpdateFn = (dt: number) => void;
/**
 * @param alpha    how far the pending frame sits between the last two fixed
 *                 steps, 0..1 — use it to interpolate anything visual.
 * @param frameDt  real seconds since the previous rendered frame.
 */
export type RenderFn = (alpha: number, frameDt: number) => void;

const FIXED_DT = 1 / 60;
const MAX_ACCUM = 0.25;

/**
 * Fixed-timestep simulation, variable-rate rendering.
 *
 * Simulation runs at exactly 60Hz so physics stays deterministic regardless of
 * refresh rate. Rendering runs once per animation frame and receives `alpha`,
 * so anything the eye tracks — camera, character — can be interpolated between
 * the last two simulation states instead of stepping at 60Hz on a 144Hz display.
 */
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

    // Whatever is left over is how far we are into the next step.
    render(accum / FIXED_DT, frame);
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}
