/**
 * Undoable editor operation. `execute` applies the change (also used for redo);
 * `undo` reverts it. Commands may coalesce with a following command of the same
 * kind (slider drags, typing) by implementing `merge`.
 */
export interface Command {
  /** Human readable label shown in the history panel. */
  readonly label: string;
  execute(): void;
  undo(): void;
  /** Merge `next` into this command; return true when merged (the stack then discards `next`). */
  merge?(next: Command): boolean;
  /** Optional group key used by `merge` implementations. */
  readonly mergeKey?: string;
}

/** Run several commands as one undo step. */
export class CompoundCommand implements Command {
  constructor(readonly label: string, readonly commands: Command[]) {}

  execute(): void {
    for (const c of this.commands) c.execute();
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo();
  }
}

/** Command built from two closures. */
export class FnCommand implements Command {
  constructor(readonly label: string, private readonly doFn: () => void, private readonly undoFn: () => void, readonly mergeKey?: string) {}

  execute(): void { this.doFn(); }
  undo(): void { this.undoFn(); }
}
