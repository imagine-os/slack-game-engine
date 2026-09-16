import { EventEmitter } from '../../core/EventEmitter';

/** A named, discoverable editor action (menus, toolbar, palette, shortcuts). */
export interface Action {
  id: string;
  title: string;
  category?: string;
  /** e.g. `Mod+S`, `Shift+Delete`, `F`, `?` */
  shortcut?: string;
  icon?: string;
  /** Shortcut also fires while a text field is focused. */
  global?: boolean;
  /** Hide from the palette. */
  hidden?: boolean;
  enabled?: () => boolean;
  checked?: () => boolean;
  run: () => void | Promise<void>;
}

export interface ActionEvents extends Record<string, unknown> {
  change: void;
  ran: string;
}

/** Central registry of editor actions. */
export class ActionRegistry {
  readonly events = new EventEmitter<ActionEvents>();
  private actions = new Map<string, Action>();

  register(...actions: Action[]): void {
    for (const a of actions) this.actions.set(a.id, a);
    this.events.emit('change', undefined);
  }

  get(id: string): Action | undefined { return this.actions.get(id); }
  all(): Action[] { return Array.from(this.actions.values()); }
  byCategory(cat: string): Action[] { return this.all().filter((a) => a.category === cat); }

  isEnabled(id: string): boolean {
    const a = this.actions.get(id);
    return !!a && (a.enabled?.() ?? true);
  }

  run(id: string): boolean {
    const a = this.actions.get(id);
    if (!a || !(a.enabled?.() ?? true)) return false;
    void a.run();
    this.events.emit('ran', id);
    return true;
  }
}
