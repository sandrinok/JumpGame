export interface Command {
  label: string;
  do(): void;
  undo(): void;
}

const MAX = 100;

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  /** Commands collected since beginBatch(), or null when not batching. */
  private batch: Command[] | null = null;
  /**
   * Fired whenever the level changes through the history — recorded, undone or
   * redone. clear() does not fire it: it is used when the level is replaced
   * wholesale, and the caller decides what that means for unsaved state.
   */
  onChange: (() => void) | null = null;

  /** Run a command and record it. */
  exec(cmd: Command): void {
    cmd.do();
    this.push(cmd);
  }

  /** Record a command that has already been applied (e.g. gizmo drag). */
  record(cmd: Command): void {
    this.push(cmd);
  }

  /**
   * Start collecting commands into a single undo step.
   *
   * Continuous edits fire a command per input event — scrubbing a number field
   * across 60 pixels produces 60 of them, which would bury everything else in
   * the 100-deep stack and make undo useless. Nesting is ignored, so an
   * unbalanced endBatch cannot strand the history in collecting mode.
   */
  beginBatch(): void {
    if (this.batch) return;
    this.batch = [];
  }

  /** Collapse everything since beginBatch() into one entry. */
  endBatch(label: string): void {
    const cmds = this.batch;
    this.batch = null;
    if (!cmds || cmds.length === 0) return;
    if (cmds.length === 1) {
      this.push(cmds[0]);
      return;
    }
    this.push({
      label,
      do: () => {
        for (const c of cmds) c.do();
      },
      undo: () => {
        // Reverse order: each command holds absolute before/after values, so
        // unwinding backwards lands on the state before the first one.
        for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo();
      },
    });
  }

  private push(cmd: Command): void {
    this.onChange?.();
    if (this.batch) {
      this.batch.push(cmd);
      return;
    }
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.onChange?.();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.do();
    this.undoStack.push(cmd);
    this.onChange?.();
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.batch = null;
  }
}
