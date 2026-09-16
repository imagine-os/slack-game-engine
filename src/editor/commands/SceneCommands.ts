import type { Entity } from '../../core/ecs/Entity';
import type { EntitySnapshot, SceneEditor } from '../project/SceneEditor';
import type { Command } from './Command';

/** Create an entity subtree (undo deletes it). */
export class CreateEntityCommand implements Command {
  readonly label: string;
  constructor(private readonly editor: SceneEditor, readonly snapshot: EntitySnapshot, label?: string) {
    this.label = label ?? `Create ${snapshot.name ?? 'entity'}`;
  }
  execute(): void { this.editor.createEntity(this.snapshot); }
  undo(): void { this.editor.deleteEntity(this.snapshot.guid); }
  /** The created root entity (after execute). */
  get entity(): Entity | undefined { return this.editor.entityOf(this.snapshot.guid); }
}

/** Delete entities (with descendants); undo recreates them in place. */
export class DeleteEntitiesCommand implements Command {
  readonly label: string;
  private snapshots: EntitySnapshot[] = [];
  constructor(private readonly editor: SceneEditor, private readonly guids: string[]) {
    this.label = guids.length === 1 ? 'Delete entity' : `Delete ${guids.length} entities`;
  }
  execute(): void {
    const world = this.editor.world;
    const live = this.guids.map((g) => this.editor.entityOf(g)).filter((e): e is Entity => e !== undefined);
    // Skip entities whose ancestor is also being deleted.
    const roots = live.filter((e) => !live.some((o) => o !== e && world.isDescendantOf(e, o)));
    roots.sort((a, b) => this.editor.indexOf(a) - this.editor.indexOf(b));
    this.snapshots = roots.map((e) => this.editor.snapshot(e));
    for (const s of this.snapshots) this.editor.deleteEntity(s.guid);
  }
  undo(): void {
    for (const s of this.snapshots) this.editor.createEntity(s);
  }
}

/** Move an entity in the hierarchy. */
export class ReparentCommand implements Command {
  readonly label = 'Reparent entity';
  private oldParent: string | null = null;
  private oldIndex = 0;
  constructor(private readonly editor: SceneEditor, private readonly guid: string, private readonly parent: string | null, private readonly index: number, private readonly keepWorld = true) {}
  execute(): void {
    const e = this.editor.entityOf(this.guid);
    if (e === undefined) return;
    const p = this.editor.world.getParent(e);
    this.oldParent = p ? this.editor.guidOf(p) ?? null : null;
    this.oldIndex = this.editor.indexOf(e);
    this.editor.reparent(this.guid, this.parent, this.index, false, this.keepWorld);
  }
  undo(): void { this.editor.reparent(this.guid, this.oldParent, this.oldIndex, false, this.keepWorld); }
}

export class RenameCommand implements Command {
  readonly label = 'Rename entity';
  private old = '';
  constructor(private readonly editor: SceneEditor, private readonly guid: string, private readonly name: string) {}
  execute(): void {
    const e = this.editor.entityOf(this.guid);
    this.old = e !== undefined ? this.editor.world.nameOf(e) : '';
    this.editor.rename(this.guid, this.name);
  }
  undo(): void { this.editor.rename(this.guid, this.old); }
}

/** Add a component; undo also removes components auto-added via `requires`. */
export class AddComponentCommand implements Command {
  readonly label: string;
  private added: string[] = [];
  constructor(private readonly editor: SceneEditor, private readonly guid: string, private readonly type: string, private readonly data: Record<string, unknown> = {}) {
    this.label = `Add ${type}`;
  }
  execute(): void {
    const e = this.editor.entityOf(this.guid);
    if (e === undefined) return;
    const before = new Set(this.editor.world.getComponentTypes(e));
    this.editor.addComponent(this.guid, this.type, this.data);
    this.added = this.editor.world.getComponentTypes(e).filter((t) => !before.has(t));
  }
  undo(): void { for (const t of this.added.reverse()) this.editor.removeComponent(this.guid, t); }
}

export class RemoveComponentCommand implements Command {
  readonly label: string;
  private data: Record<string, unknown> | null = null;
  constructor(private readonly editor: SceneEditor, private readonly guid: string, private readonly type: string) {
    this.label = `Remove ${type}`;
  }
  execute(): void {
    const e = this.editor.entityOf(this.guid);
    const c = e !== undefined ? this.editor.world.getComponent(e, this.type) : undefined;
    if (!c) return;
    this.data = this.editor.serializeComponent(c);
    this.editor.removeComponent(this.guid, this.type);
  }
  undo(): void { if (this.data) this.editor.addComponent(this.guid, this.type, this.data); }
}

export interface FieldTarget { guid: string; type: string; field: string; value: unknown; old?: unknown }

/**
 * Set one or more fields (multi-edit). Consecutive edits of the same targets
 * merge so that slider drags produce one undo step.
 */
export class SetFieldsCommand implements Command {
  readonly label: string;
  readonly mergeKey: string;
  constructor(private readonly editor: SceneEditor, readonly targets: FieldTarget[], label?: string) {
    const f = targets[0];
    this.label = label ?? (f ? `Set ${f.type}.${f.field}` : 'Set field');
    this.mergeKey = targets.map((t) => `${t.guid}:${t.type}.${t.field}`).sort().join('|');
  }
  execute(): void {
    for (const t of this.targets) {
      if (t.old === undefined) t.old = this.editor.getField(t.guid, t.type, t.field);
      this.editor.setField(t.guid, t.type, t.field, t.value);
    }
  }
  undo(): void {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (t.old !== undefined) this.editor.setField(t.guid, t.type, t.field, t.old);
    }
  }
  merge(next: Command): boolean {
    if (!(next instanceof SetFieldsCommand) || next.mergeKey !== this.mergeKey) return false;
    for (const t of next.targets) {
      const mine = this.targets.find((x) => x.guid === t.guid && x.type === t.type && x.field === t.field);
      if (mine) mine.value = t.value;
    }
    return true;
  }
}

export class SetMetaCommand implements Command {
  readonly label: string;
  private old = false;
  constructor(private readonly editor: SceneEditor, private readonly guid: string, private readonly key: 'hidden' | 'locked', private readonly value: boolean) {
    this.label = `${value ? 'Set' : 'Clear'} ${key}`;
  }
  execute(): void {
    const e = this.editor.entityOf(this.guid);
    this.old = e !== undefined ? !!this.editor.metaOf(e)?.[this.key] : false;
    this.editor.setMeta(this.guid, this.key, this.value);
  }
  undo(): void { this.editor.setMeta(this.guid, this.key, this.old); }
}
