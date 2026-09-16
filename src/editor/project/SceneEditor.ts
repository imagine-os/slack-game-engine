import type { Engine } from '../../core/Engine';
import { EventEmitter } from '../../core/EventEmitter';
import type { Component } from '../../core/ecs/Component';
import { NULL_ENTITY, type Entity } from '../../core/ecs/Entity';
import { collectSubtree, SCENE_VERSION, serializeEntity, type ComponentData, type SceneData } from '../../core/ecs/Scene';
import { Transform } from '../../core/ecs/Transform';
import { Name } from '../../core/ecs/components';
import type { World } from '../../core/ecs/World';
import { shortId } from '../ui/dom';

/** Editor-only per-entity data, persisted in `scene.settings.editor`. */
export interface EntityMeta {
  guid: string;
  hidden: boolean;
  locked: boolean;
}

/** Shape of `SceneData.settings.editor`. */
export interface EditorSceneSettings {
  /** Keyed by document entity id. */
  entities?: Record<string, Partial<EntityMeta>>;
  camera?: Record<string, unknown>;
  bookmarks?: { name: string; camera: Record<string, unknown> }[];
}

/** Serialized entity subtree with stable ids (used for undo and collaboration). */
export interface EntitySnapshot {
  guid: string;
  name?: string;
  parent: string | null;
  index: number;
  hidden?: boolean;
  locked?: boolean;
  /** Components with entity references encoded as `{ $ref: guid }`. */
  components: ComponentData[];
  children: EntitySnapshot[];
}

/** Every change the editor can make to the live scene. */
export type Mutation =
  | { kind: 'entity-create'; snapshot: EntitySnapshot }
  | { kind: 'entity-delete'; guid: string }
  | { kind: 'entity-reparent'; guid: string; parent: string | null; index: number }
  | { kind: 'entity-rename'; guid: string; name: string }
  | { kind: 'component-add'; guid: string; type: string; data: Record<string, unknown> }
  | { kind: 'component-remove'; guid: string; type: string }
  | { kind: 'field-set'; guid: string; type: string; field: string; value: unknown }
  | { kind: 'meta-set'; guid: string; key: 'hidden' | 'locked'; value: boolean };

export interface SceneEditorEvents extends Record<string, unknown> {
  /** A mutation was applied (locally or from a remote peer). */
  mutated: { mutation: Mutation; remote: boolean };
  /** Hierarchy shape changed (create/delete/reparent/rename/meta). */
  structure: void;
  /** A scene was (re)loaded. */
  loaded: SceneData;
}

const EDITOR_REF = '$ref';

/**
 * Mutation API over the live editing world. Every change goes through here so
 * that undo, collaboration and dirty tracking see the same events. Entities
 * are addressed by stable guids (stored in the scene's editor settings) so
 * that edits can be exchanged between peers whose runtime ids differ.
 */
export class SceneEditor {
  readonly events = new EventEmitter<SceneEditorEvents>();
  readonly world: World;
  sceneName = 'Main';
  /** Non-editor scene settings, round-tripped on save. */
  sceneSettings: Record<string, unknown> = {};
  /** Entities owned by the editor (camera rig etc.); never serialized or listed. */
  readonly editorEntities = new Set<Entity>();

  private metaByEntity = new Map<Entity, EntityMeta>();
  private byGuid = new Map<string, Entity>();
  /** Root display order (World has no root order of its own). */
  private rootOrder: Entity[] = [];

  constructor(readonly engine: Engine) {
    this.world = engine.world;
    this.world.events.on('entityDestroyed', (e) => this.forget(e));
    this.world.events.on('cleared', () => { this.metaByEntity.clear(); this.byGuid.clear(); this.rootOrder.length = 0; this.editorEntities.clear(); });
  }

  // ------------------------------------------------------------ load / save

  /** Replace the world with a scene document, restoring editor metadata. */
  load(scene: SceneData): void {
    const res = this.engine.loadScene(scene);
    this.sceneName = scene.name;
    const { editor, ...rest } = scene.settings ?? {};
    this.sceneSettings = rest;
    const ed = (editor ?? {}) as EditorSceneSettings;
    const { entities: _ignored, ...editorRest } = ed;
    this.editorSettings = editorRest;
    const metaById = ed.entities ?? {};
    for (const [docId, e] of res.idMap) {
      const m = metaById[String(docId)];
      this.ensureMeta(e, m?.guid, m?.hidden, m?.locked);
    }
    this.rootOrder = res.roots.slice();
    this.events.emit('loaded', scene);
    this.events.emit('structure', undefined);
  }

  /** Editor-only settings blob for the current scene (camera, bookmarks…). */
  editorSettings: Omit<EditorSceneSettings, 'entities'> = {};

  /** Serialize the scene, excluding editor entities and writing guid metadata. */
  serialize(name = this.sceneName): SceneData {
    const order: Entity[] = [];
    for (const r of this.roots()) collectSubtree(this.world, r, order);
    for (const e of this.world.entities()) if (!this.world.hasComponent(e, Transform) && !this.editorEntities.has(e)) order.push(e);
    const ids = new Map<number, number>();
    order.forEach((e, i) => ids.set(e, i + 1));
    const remap = (id: number): number => ids.get(id) ?? 0;
    const entities: Record<string, Partial<EntityMeta>> = {};
    const scene: SceneData = {
      version: SCENE_VERSION,
      name,
      entities: order.map((e) => {
        const m = this.metaByEntity.get(e);
        if (m) {
          const rec: Partial<EntityMeta> = { guid: m.guid };
          if (m.hidden) rec.hidden = true;
          if (m.locked) rec.locked = true;
          entities[String(ids.get(e))] = rec;
        }
        return serializeEntity(this.world, e, remap);
      }),
      settings: { ...this.sceneSettings, editor: { ...this.editorSettings, entities } },
    };
    return scene;
  }

  // -------------------------------------------------------------- lookups

  guidOf(e: Entity): string | undefined { return this.metaByEntity.get(e)?.guid; }
  entityOf(guid: string): Entity | undefined { const e = this.byGuid.get(guid); return e !== undefined && this.world.isAlive(e) ? e : undefined; }
  metaOf(e: Entity): EntityMeta | undefined { return this.metaByEntity.get(e); }
  /** True for live, user-editable (non editor-owned) entities. */
  isEditable(e: Entity): boolean { return this.world.isAlive(e) && !this.editorEntities.has(e); }

  /** Root entities in display order. */
  roots(): Entity[] {
    const live = new Set(this.world.roots().filter((e) => !this.editorEntities.has(e)));
    const out = this.rootOrder.filter((e) => live.has(e));
    for (const e of live) if (!out.includes(e)) out.push(e);
    this.rootOrder = out;
    return out;
  }

  /** Child entities of `e` (or roots for NULL_ENTITY). */
  childrenOf(e: Entity): readonly Entity[] {
    return e === NULL_ENTITY ? this.roots() : this.world.getChildren(e);
  }

  /** Index of `e` among its siblings. */
  indexOf(e: Entity): number {
    const parent = this.world.getParent(e);
    return this.childrenOf(parent).indexOf(e);
  }

  /** All editable entities, parents before children. */
  all(): Entity[] {
    const out: Entity[] = [];
    for (const r of this.roots()) collectSubtree(this.world, r, out);
    return out;
  }

  /** Register an editor-owned entity (excluded from hierarchy, picking and saving). */
  markEditorEntity(e: Entity): void {
    this.editorEntities.add(e);
    const i = this.rootOrder.indexOf(e);
    if (i >= 0) this.rootOrder.splice(i, 1);
  }

  /** Make sure `e` has metadata; returns its guid. */
  ensureMeta(e: Entity, guid?: string, hidden?: boolean, locked?: boolean): EntityMeta {
    let m = this.metaByEntity.get(e);
    if (!m) {
      m = { guid: guid ?? shortId(10), hidden: !!hidden, locked: !!locked };
      this.metaByEntity.set(e, m);
      this.byGuid.set(m.guid, e);
    }
    return m;
  }

  private forget(e: Entity): void {
    const m = this.metaByEntity.get(e);
    if (m) { this.metaByEntity.delete(e); if (this.byGuid.get(m.guid) === e) this.byGuid.delete(m.guid); }
    const i = this.rootOrder.indexOf(e);
    if (i >= 0) this.rootOrder.splice(i, 1);
    this.editorEntities.delete(e);
  }

  // ---------------------------------------------------- snapshots / encode

  /** Encode entity references in component data as `{ $ref: guid }`. */
  encodeData(type: string, data: Record<string, unknown>): Record<string, unknown> {
    const fields = this.world.registry.fields(type);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const meta = fields[k];
      if (meta?.type === 'entity') out[k] = this.encodeRef(v);
      else out[k] = v;
    }
    if (type === Transform.type) { delete out.parent; delete out.children; }
    return out;
  }

  /** Inverse of {@link encodeData}. Unknown references become NULL_ENTITY. */
  decodeData(type: string, data: Record<string, unknown>): Record<string, unknown> {
    const fields = this.world.registry.fields(type);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      const meta = fields[k];
      out[k] = meta?.type === 'entity' ? this.decodeRef(v) : v;
    }
    if (type === Transform.type) { delete out.parent; delete out.children; }
    return out;
  }

  encodeRef(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => this.encodeRef(x));
    if (typeof v !== 'number' || v === NULL_ENTITY) return null;
    const guid = this.guidOf(v);
    return guid ? { [EDITOR_REF]: guid } : null;
  }

  decodeRef(v: unknown): unknown {
    if (Array.isArray(v)) return v.map((x) => this.decodeRef(x));
    if (v && typeof v === 'object' && EDITOR_REF in (v as Record<string, unknown>)) {
      return this.entityOf(String((v as Record<string, unknown>)[EDITOR_REF])) ?? NULL_ENTITY;
    }
    if (typeof v === 'number') return v;
    return NULL_ENTITY;
  }

  /** Serialize a component instance with guid-encoded references. */
  serializeComponent(c: Component): Record<string, unknown> {
    return this.encodeData(c.type, this.world.registry.serialize(c));
  }

  /** Full subtree snapshot (for undo of delete, duplication and collaboration). */
  snapshot(e: Entity): EntitySnapshot {
    const m = this.ensureMeta(e);
    const parent = this.world.getParent(e);
    const snap: EntitySnapshot = {
      guid: m.guid,
      parent: parent === NULL_ENTITY ? null : this.guidOf(parent) ?? null,
      index: this.indexOf(e),
      components: [],
      children: [],
    };
    const name = this.world.getComponent(e, Name);
    if (name) snap.name = name.name;
    if (m.hidden) snap.hidden = true;
    if (m.locked) snap.locked = true;
    for (const c of this.world.getComponents(e)) {
      if (!this.world.registry.has(c.type) || c.type === Name.type) continue;
      snap.components.push({ type: c.type, data: this.serializeComponent(c) });
    }
    for (const child of this.world.getChildren(e)) snap.children.push(this.snapshot(child));
    return snap;
  }

  /** Deep copy of a snapshot with fresh guids (for duplicate / paste). */
  static regenerate(snap: EntitySnapshot, map = new Map<string, string>()): EntitySnapshot {
    const collect = (s: EntitySnapshot): void => { map.set(s.guid, shortId(10)); s.children.forEach(collect); };
    if (!map.has(snap.guid)) collect(snap);
    const remap = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(remap);
      if (v && typeof v === 'object' && EDITOR_REF in (v as Record<string, unknown>)) {
        const g = String((v as Record<string, unknown>)[EDITOR_REF]);
        return { [EDITOR_REF]: map.get(g) ?? g };
      }
      return v;
    };
    const copy = (s: EntitySnapshot): EntitySnapshot => ({
      ...s,
      guid: map.get(s.guid)!,
      parent: s.parent && map.has(s.parent) ? map.get(s.parent)! : s.parent,
      components: s.components.map((c) => ({ type: c.type, data: Object.fromEntries(Object.entries(c.data).map(([k, v]) => [k, remap(v)])) })),
      children: s.children.map(copy),
    });
    return copy(snap);
  }

  // ------------------------------------------------------------- mutations

  /** Create an entity subtree from a snapshot. Returns the root entity. */
  createEntity(snapshot: EntitySnapshot, remote = false): Entity {
    const root = this.instantiate(snapshot);
    // Second pass: resolve entity references now that all guids exist.
    this.resolveRefs(snapshot);
    this.world.updateTransforms();
    this.emit({ kind: 'entity-create', snapshot }, remote);
    this.events.emit('structure', undefined);
    return root;
  }

  private instantiate(snap: EntitySnapshot): Entity {
    const existing = this.entityOf(snap.guid);
    if (existing !== undefined) return existing;
    const hasTransform = snap.components.some((c) => c.type === Transform.type) || snap.children.length > 0 || true;
    const e = hasTransform ? this.world.createEntity(snap.name) : this.world.createBareEntity();
    this.ensureMeta(e, snap.guid, snap.hidden, snap.locked);
    for (const cd of snap.components) {
      if (!this.world.registry.has(cd.type)) continue;
      const data = this.decodeData(cd.type, cd.data);
      const current = this.world.getComponent(e, cd.type);
      if (current) { this.world.registry.applyProps(current, data); if (current instanceof Transform) current.markDirty(); }
      else this.world.addComponent(e, this.world.registry.deserialize(cd.type, data));
    }
    if (snap.name !== undefined && !this.world.hasComponent(e, Name)) this.world.addComponent(e, Name, { name: snap.name });
    const parent = snap.parent ? this.entityOf(snap.parent) ?? NULL_ENTITY : NULL_ENTITY;
    if (parent !== NULL_ENTITY) this.world.setParent(e, parent);
    this.place(e, parent, snap.index);
    for (const child of snap.children) this.instantiate(child);
    return e;
  }

  private resolveRefs(snap: EntitySnapshot): void {
    const e = this.entityOf(snap.guid);
    if (e === undefined) return;
    for (const cd of snap.components) {
      const c = this.world.getComponent(e, cd.type);
      if (!c) continue;
      const fields = this.world.registry.fields(cd.type);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cd.data)) if (fields[k]?.type === 'entity' && k !== 'parent') patch[k] = this.decodeRef(v);
      if (Object.keys(patch).length) this.world.registry.applyProps(c, patch);
    }
    for (const child of snap.children) this.resolveRefs(child);
  }

  /** Delete an entity and its descendants. */
  deleteEntity(guid: string, remote = false): void {
    const e = this.entityOf(guid);
    if (e === undefined) return;
    this.world.destroyEntity(e);
    this.emit({ kind: 'entity-delete', guid }, remote);
    this.events.emit('structure', undefined);
  }

  /** Move an entity under a new parent (guid or null for root) at `index` among siblings. */
  reparent(guid: string, parentGuid: string | null, index: number, remote = false, keepWorld = true): void {
    const e = this.entityOf(guid);
    if (e === undefined) return;
    const parent = parentGuid ? this.entityOf(parentGuid) ?? NULL_ENTITY : NULL_ENTITY;
    if (parent !== NULL_ENTITY && (parent === e || this.world.isDescendantOf(parent, e))) return;
    if (this.world.getParent(e) !== parent) this.world.setParent(e, parent, keepWorld);
    this.place(e, parent, index);
    this.world.updateTransforms();
    this.emit({ kind: 'entity-reparent', guid, parent: parentGuid, index }, remote);
    this.events.emit('structure', undefined);
  }

  /** Put `e` at `index` within its parent's child order. */
  private place(e: Entity, parent: Entity, index: number): void {
    if (parent === NULL_ENTITY) {
      const i = this.rootOrder.indexOf(e);
      if (i >= 0) this.rootOrder.splice(i, 1);
      const roots = this.roots();
      const j = roots.indexOf(e);
      if (j >= 0) roots.splice(j, 1);
      roots.splice(Math.max(0, Math.min(roots.length, index < 0 ? roots.length : index)), 0, e);
      this.rootOrder = roots;
    } else {
      const pt = this.world.getComponent(parent, Transform);
      const ct = this.world.getComponent(e, Transform);
      if (!pt || !ct) return;
      const children = pt.children as Entity[];
      const cts = pt._childTransforms;
      const i = children.indexOf(e);
      if (i < 0) return;
      children.splice(i, 1);
      cts.splice(i, 1);
      const at = Math.max(0, Math.min(children.length, index < 0 ? children.length : index));
      children.splice(at, 0, e);
      cts.splice(at, 0, ct);
    }
  }

  rename(guid: string, name: string, remote = false): void {
    const e = this.entityOf(guid);
    if (e === undefined) return;
    const n = this.world.getComponent(e, Name);
    if (n) n.name = name; else this.world.addComponent(e, Name, { name });
    this.emit({ kind: 'entity-rename', guid, name }, remote);
    this.events.emit('structure', undefined);
  }

  /** Add a component (plus any `requires`) with guid-encoded `data`. */
  addComponent(guid: string, type: string, data: Record<string, unknown> = {}, remote = false): Component | undefined {
    const e = this.entityOf(guid);
    if (e === undefined || !this.world.registry.has(type)) return undefined;
    const entry = this.world.registry.require(type);
    for (const req of entry.meta.requires ?? []) {
      if (!this.world.hasComponent(e, req) && this.world.registry.has(req)) this.addComponent(guid, req, {}, remote);
    }
    let c = this.world.getComponent(e, type);
    if (c) {
      this.world.registry.applyProps(c, this.decodeData(type, data));
    } else {
      c = this.world.registry.deserialize(type, this.decodeData(type, data));
      this.world.addComponent(e, c);
    }
    if (c instanceof Transform) c.markDirty();
    this.emit({ kind: 'component-add', guid, type, data }, remote);
    return c;
  }

  removeComponent(guid: string, type: string, remote = false): void {
    const e = this.entityOf(guid);
    if (e === undefined || type === Transform.type) return;
    if (!this.world.removeComponent(e, type)) return;
    this.emit({ kind: 'component-remove', guid, type }, remote);
  }

  /** Current guid-encoded value of one field. */
  getField(guid: string, type: string, field: string): unknown {
    const e = this.entityOf(guid);
    const c = e !== undefined ? this.world.getComponent(e, type) : undefined;
    if (!c) return undefined;
    return this.serializeComponent(c)[field];
  }

  /** Set one field from a guid-encoded plain value. */
  setField(guid: string, type: string, field: string, value: unknown, remote = false): boolean {
    const e = this.entityOf(guid);
    const c = e !== undefined ? this.world.getComponent(e, type) : undefined;
    if (!c) return false;
    const decoded = this.decodeData(type, { [field]: structuredClone(value) });
    if (!(field in decoded)) return false;
    this.world.registry.applyProps(c, decoded);
    if (c instanceof Transform) { c.markDirty(); c.updateWorldMatrix(true); }
    if (type === Name.type && field === 'name') this.events.emit('structure', undefined);
    this.emit({ kind: 'field-set', guid, type, field, value }, remote);
    return true;
  }

  setMeta(guid: string, key: 'hidden' | 'locked', value: boolean, remote = false): void {
    const e = this.entityOf(guid);
    if (e === undefined) return;
    const m = this.ensureMeta(e);
    if (m[key] === value) return;
    m[key] = value;
    this.emit({ kind: 'meta-set', guid, key, value }, remote);
    this.events.emit('structure', undefined);
  }

  /** Apply a mutation received from another peer. */
  applyRemote(m: Mutation): void {
    switch (m.kind) {
      case 'entity-create': this.createEntity(m.snapshot, true); break;
      case 'entity-delete': this.deleteEntity(m.guid, true); break;
      case 'entity-reparent': this.reparent(m.guid, m.parent, m.index, true, false); break;
      case 'entity-rename': this.rename(m.guid, m.name, true); break;
      case 'component-add': this.addComponent(m.guid, m.type, m.data, true); break;
      case 'component-remove': this.removeComponent(m.guid, m.type, true); break;
      case 'field-set': this.setField(m.guid, m.type, m.field, m.value, true); break;
      case 'meta-set': this.setMeta(m.guid, m.key, m.value, true); break;
    }
  }

  /** True when an entity or any ancestor is hidden. */
  isHidden(e: Entity): boolean {
    let cur = e;
    while (cur !== NULL_ENTITY) {
      if (this.metaByEntity.get(cur)?.hidden) return true;
      cur = this.world.getParent(cur);
    }
    return false;
  }

  isLocked(e: Entity): boolean {
    let cur = e;
    while (cur !== NULL_ENTITY) {
      if (this.metaByEntity.get(cur)?.locked) return true;
      cur = this.world.getParent(cur);
    }
    return false;
  }

  private emit(mutation: Mutation, remote: boolean): void {
    this.events.emit('mutated', { mutation, remote });
  }
}
