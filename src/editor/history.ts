export interface Command {
  label: string;
  do(): void;
  undo(): void;
}

const MAX = 100;

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  /** Run a command and record it. */
  exec(cmd: Command): void {
    cmd.do();
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Record a command that has already been applied (e.g. gizmo drag). */
  record(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.do();
    this.undoStack.push(cmd);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
