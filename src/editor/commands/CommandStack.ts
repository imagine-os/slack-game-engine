import { EventEmitter } from '../../core/EventEmitter';
import { CompoundCommand, type Command } from './Command';

export interface CommandStackEvents extends Record<string, unknown> {
  /** After any change to the stack or cursor. */
  change: void;
  /** After a command ran (push, redo) or was undone. */
  executed: { command: Command; kind: 'push' | 'undo' | 'redo' | 'merge' };
}

/**
 * Linear undo/redo history. Pushing a command executes it and truncates any
 * redo entries. Commands pushed within `mergeWindowMs` of a mergeable top
 * entry are merged into it (coalesces drags and typing). `beginGroup` /
 * `endGroup` collect several pushes into one compound step.
 */
export class CommandStack {
  readonly events = new EventEmitter<CommandStackEvents>();
  /** Maximum history length. */
  limit = 200;
  /** Time window for coalescing consecutive mergeable commands. */
  mergeWindowMs = 800;

  private items: Command[] = [];
  private cursor = 0; // number of executed commands
  private lastPushAt = 0;
  private group: { label: string; commands: Command[] } | null = null;
  private groupDepth = 0;
  /** When set, pushes only execute (used while applying remote edits). */
  suspended = false;

  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.items.length; }
  get length(): number { return this.items.length; }
  get index(): number { return this.cursor; }
  /** Executed commands, oldest first. */
  get history(): readonly Command[] { return this.items; }
  get undoLabel(): string | null { return this.cursor > 0 ? this.items[this.cursor - 1].label : null; }
  get redoLabel(): string | null { return this.cursor < this.items.length ? this.items[this.cursor].label : null; }

  /** Execute a command and record it. */
  push(command: Command, opts: { merge?: boolean } = {}): void {
    command.execute();
    if (this.suspended) return;
    if (this.group) { this.group.commands.push(command); return; }
    const now = Date.now();
    const top = this.cursor > 0 ? this.items[this.cursor - 1] : undefined;
    const allowMerge = opts.merge !== false && top?.merge && this.cursor === this.items.length && now - this.lastPushAt < this.mergeWindowMs;
    if (allowMerge && top!.merge!(command)) {
      this.lastPushAt = now;
      this.events.emit('executed', { command: top!, kind: 'merge' });
      this.events.emit('change', undefined);
      return;
    }
    this.items.length = this.cursor;
    this.items.push(command);
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
    this.cursor = this.items.length;
    this.lastPushAt = now;
    this.events.emit('executed', { command, kind: 'push' });
    this.events.emit('change', undefined);
  }

  /** Execute without recording (e.g. remote edits). */
  run(command: Command): void {
    command.execute();
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const c = this.items[--this.cursor];
    c.undo();
    this.lastPushAt = 0;
    this.events.emit('executed', { command: c, kind: 'undo' });
    this.events.emit('change', undefined);
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const c = this.items[this.cursor++];
    c.execute();
    this.lastPushAt = 0;
    this.events.emit('executed', { command: c, kind: 'redo' });
    this.events.emit('change', undefined);
    return true;
  }

  /** Undo or redo until `index` commands are applied. */
  jumpTo(index: number): void {
    index = Math.max(0, Math.min(this.items.length, index));
    while (this.cursor > index) this.undo();
    while (this.cursor < index) this.redo();
  }

  /** Start collecting pushes into one compound command (nestable). */
  beginGroup(label: string): void {
    if (this.groupDepth++ === 0) this.group = { label, commands: [] };
  }

  /** Close the current group and record it as one step (already executed). */
  endGroup(): void {
    if (this.groupDepth === 0) return;
    if (--this.groupDepth > 0) return;
    const g = this.group!;
    this.group = null;
    if (g.commands.length === 0) return;
    const compound = g.commands.length === 1 ? g.commands[0] : new CompoundCommand(g.label, g.commands);
    this.items.length = this.cursor;
    this.items.push(compound);
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
    this.cursor = this.items.length;
    this.lastPushAt = 0;
    this.events.emit('executed', { command: compound, kind: 'push' });
    this.events.emit('change', undefined);
  }

  /** Run `fn` inside a group. */
  transaction(label: string, fn: () => void): void {
    this.beginGroup(label);
    try { fn(); } finally { this.endGroup(); }
  }

  /** Forget everything. */
  clear(): void {
    this.items.length = 0;
    this.cursor = 0;
    this.group = null;
    this.groupDepth = 0;
    this.events.emit('change', undefined);
  }

  /** Prevent the next push from merging into the current top. */
  breakMerge(): void {
    this.lastPushAt = 0;
  }
}
