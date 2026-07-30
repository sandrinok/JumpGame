/**
 * Does this keystroke belong to a text field rather than to the game?
 *
 * Key handling is on `window`, which is what makes it work regardless of where
 * the pointer is — and also what makes typing a chat message walk the character
 * across the level and press F2 open the editor. Anything editable gets the
 * keystroke to itself.
 */
export function isTypingTarget(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

export class Input {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  scrollDY = 0;
  pointerLocked = false;
  /** When false, clicking the target does not request pointer-lock (e.g. in editor mode). */
  lockOnClick = true;

  constructor(target: HTMLElement = document.body) {
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e)) return;
      const k = e.code;
      if (!this.keys.has(k)) this.justPressed.add(k);
      this.keys.add(k);
    });
    // Releases are never filtered. A key pressed before a field took focus would
    // otherwise stay held down forever, and the character would keep walking.
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    target.addEventListener('click', () => {
      if (!this.lockOnClick) return;
      if (!this.pointerLocked) target.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === target;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      this.scrollDY += e.deltaY;
    }, { passive: true });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Forget anything held. Call when focus moves to a text field mid-stride. */
  clearKeys(): void {
    this.keys.clear();
    this.justPressed.clear();
  }

  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  /**
   * Call after each fixed simulation step. Edge-triggered keys belong to the
   * step that consumed them, or a single Space would queue a jump on every
   * step of the frame.
   */
  endStep(): void {
    this.justPressed.clear();
  }

  /**
   * Call after each rendered frame. Mouse and wheel deltas accumulate per
   * frame and are consumed by the camera during render, so they must not be
   * cleared by a simulation step that may run zero or several times per frame.
   */
  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.scrollDY = 0;
  }
}
