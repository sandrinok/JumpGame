export class Input {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  scrollDY = 0;
  pointerLocked = false;

  constructor(target: HTMLElement = document.body) {
    window.addEventListener('keydown', (e) => {
      const k = e.code;
      if (!this.keys.has(k)) this.justPressed.add(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    target.addEventListener('click', () => {
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

  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  endFrame(): void {
    this.justPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.scrollDY = 0;
  }
}
