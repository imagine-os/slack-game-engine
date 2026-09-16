import { EventEmitter } from '../EventEmitter';
import type { Component, ComponentClass } from './Component';
import { type Entity, NULL_ENTITY, entityIndex, entityGeneration, makeEntity, MAX_ENTITIES } from './Entity';
import { Query } from './Query';
import { defaultRegistry, Registry } from './Registry';
import { PHASES, type Phase, type System } from './System';
import { Name, Tag } from './components';
import { Transform } from './Transform';

/** Events emitted by a {@link World}. */
export interface WorldEvents extends Record<string, unknown> {
  entityCreated: Entity;
  /** Emitted before the entity's components are detached. */
  entityDestroyed: Entity;
  componentAdded: { entity: Entity; component: Component };
  componentRemoved: { entity: Entity; component: Component };
  systemAdded: System;
  systemRemoved: System;
  cleared: void;
}

/** Type or class argument accepted by component accessors. */
export type ComponentRef<T extends Component = Component> = ComponentClass<T> | string;

/** Per-type dense storage. */
class ComponentStore {
  readonly components: Component[] = [];
  readonly entities: Entity[] = [];
  readonly index = new Map<Entity, number>();

  get(e: Entity): Component | undefined {
    const i = this.index.get(e);
    return i === undefined ? undefined : this.components[i];
  }

  add(e: Entity, c: Component): void {
    this.index.set(e, this.components.length);
    this.components.push(c);
    this.entities.push(e);
  }

  remove(e: Entity): Component | undefined {
    const i = this.index.get(e);
    if (i === undefined) return undefined;
    const c = this.components[i];
    const last = this.components.length - 1;
    if (i !== last) {
      this.components[i] = this.components[last];
      this.entities[i] = this.entities[last];
      this.index.set(this.entities[i], i);
    }
    this.components.pop();
    this.entities.pop();
    this.index.delete(e);
    return c;
  }
}

/**
 * The ECS container: entities are integer ids, components are class instances
 * stored per type, systems run in ordered phases. Queries are cached and kept
 * incrementally up to date.
 */
export class World {
  readonly registry: Registry;
  readonly events = new EventEmitter<WorldEvents>();

  private generations: number[] = [0];
  private alive: boolean[] = [false];
  private freeList: number[] = [];
  private entityTypes = new Map<Entity, Set<string>>();
  private stores = new Map<string, ComponentStore>();
  private queries = new Map<string, Query>();
  private systems = new Map<Phase, System[]>();
  private liveCount = 0;
  private pendingDestroy: Entity[] = [];

  constructor(registry: Registry = defaultRegistry) {
    this.registry = registry;
    for (const p of PHASES) this.systems.set(p, []);
  }

  // ------------------------------------------------------------------ entities

  /** Create an entity. If `name` is given a {@link Name} component is attached. A {@link Transform} is always attached. */
  createEntity(name?: string): Entity {
    let index: number;
    if (this.freeList.length) {
      index = this.freeList.pop()!;
    } else {
      index = this.generations.length;
      if (index > MAX_ENTITIES) throw new Error('Entity limit reached');
      this.generations.push(0);
      this.alive.push(false);
    }
    this.alive[index] = true;
    const e = makeEntity(index, this.generations[index]);
    this.entityTypes.set(e, new Set());
    this.liveCount++;
    this.addComponent(e, Transform);
    if (name !== undefined) this.addComponent(e, Name, { name });
    this.events.emit('entityCreated', e);
    return e;
  }

  /** Create an entity without a Transform (for pure data/singleton entities). */
  createBareEntity(): Entity {
    let index: number;
    if (this.freeList.length) index = this.freeList.pop()!;
    else {
      index = this.generations.length;
      this.generations.push(0);
      this.alive.push(false);
    }
    this.alive[index] = true;
    const e = makeEntity(index, this.generations[index]);
    this.entityTypes.set(e, new Set());
    this.liveCount++;
    this.events.emit('entityCreated', e);
    return e;
  }

  /** Destroy an entity and (recursively) its Transform children. */
  destroyEntity(e: Entity): void {
    if (!this.isAlive(e)) return;
    const t = this.getComponent(e, Transform);
    if (t) {
      for (const child of t.children.slice()) this.destroyEntity(child);
      if (t.parent !== NULL_ENTITY) this.setParent(e, NULL_ENTITY);
    }
    this.events.emit('entityDestroyed', e);
    const types = this.entityTypes.get(e)!;
    for (const type of Array.from(types)) this.removeComponentByType(e, type, true);
    this.entityTypes.delete(e);
    const index = entityIndex(e);
    this.alive[index] = false;
    this.generations[index] = (this.generations[index] + 1) & 0xfff;
    this.freeList.push(index);
    this.liveCount--;
  }

  /** Queue destruction until the end of the current phase (safe inside system loops). */
  destroyEntityDeferred(e: Entity): void {
    this.pendingDestroy.push(e);
  }

  /** Flush deferred destroys. Called automatically after each phase. */
  flushDestroyed(): void {
    if (!this.pendingDestroy.length) return;
    const list = this.pendingDestroy;
    this.pendingDestroy = [];
    for (const e of list) this.destroyEntity(e);
  }

  isAlive(e: Entity): boolean {
    if (e === NULL_ENTITY) return false;
    const i = entityIndex(e);
    return this.alive[i] === true && this.generations[i] === entityGeneration(e);
  }

  get entityCount(): number {
    return this.liveCount;
  }

  /** All live entities (snapshot array). */
  entities(): Entity[] {
    return Array.from(this.entityTypes.keys());
  }

  // ---------------------------------------------------------------- components

  /**
   * Attach a component. Pass a class (constructed via the registry if
   * registered) or a pre-built instance. `init` values are applied through
   * the registry so math types are copied properly.
   */
  addComponent<T extends Component>(e: Entity, ref: ComponentClass<T> | T, init?: Partial<T> | Record<string, unknown>): T {
    this.assertAlive(e);
    const instance = typeof ref === 'function' ? new ref() : ref;
    const type = instance.type;
    const entry = this.registry.get(type);
    if (entry?.meta.unique !== false && this.hasComponent(e, type)) {
      throw new Error(`Entity ${e} already has component "${type}"`);
    }
    if (init) {
      if (entry) this.registry.applyProps(instance, init as Record<string, unknown>);
      else Object.assign(instance, init);
    }
    instance.entity = e;
    let store = this.stores.get(type);
    if (!store) this.stores.set(type, (store = new ComponentStore()));
    store.add(e, instance);
    const types = this.entityTypes.get(e)!;
    types.add(type);
    if (entry?.meta.requires) {
      for (const req of entry.meta.requires) if (!types.has(req)) this.addComponent(e, this.registry.require(req).cls);
    }
    this.updateQueriesFor(e, types);
    instance.onAttach?.();
    this.events.emit('componentAdded', { entity: e, component: instance });
    return instance;
  }

  /** Add a component by registered type name with plain init data. */
  addComponentByType(e: Entity, type: string, init?: Record<string, unknown>): Component {
    return this.addComponent(e, this.registry.require(type).cls, init);
  }

  getComponent<T extends Component>(e: Entity, ref: ComponentRef<T>): T | undefined {
    const type = typeof ref === 'string' ? ref : ref.type;
    return this.stores.get(type)?.get(e) as T | undefined;
  }

  /** Like {@link getComponent} but throws when missing. */
  requireComponent<T extends Component>(e: Entity, ref: ComponentRef<T>): T {
    const c = this.getComponent(e, ref);
    if (!c) throw new Error(`Entity ${e} lacks component "${typeof ref === 'string' ? ref : ref.type}"`);
    return c;
  }

  /** Get or add. */
  ensureComponent<T extends Component>(e: Entity, cls: ComponentClass<T>): T {
    return this.getComponent(e, cls) ?? this.addComponent(e, cls);
  }

  hasComponent(e: Entity, ref: ComponentRef): boolean {
    const type = typeof ref === 'string' ? ref : ref.type;
    return this.entityTypes.get(e)?.has(type) ?? false;
  }

  removeComponent(e: Entity, ref: ComponentRef): boolean {
    const type = typeof ref === 'string' ? ref : ref.type;
    return this.removeComponentByType(e, type, false);
  }

  /** All components on an entity. */
  getComponents(e: Entity): Component[] {
    const types = this.entityTypes.get(e);
    if (!types) return [];
    const out: Component[] = [];
    for (const t of types) {
      const c = this.stores.get(t)?.get(e);
      if (c) out.push(c);
    }
    return out;
  }

  /** Component type names on an entity. */
  getComponentTypes(e: Entity): string[] {
    return Array.from(this.entityTypes.get(e) ?? []);
  }

  /** Dense array of all components of one type (do not mutate). */
  componentsOfType<T extends Component>(ref: ComponentRef<T>): readonly T[] {
    const type = typeof ref === 'string' ? ref : ref.type;
    return (this.stores.get(type)?.components ?? []) as T[];
  }

  private removeComponentByType(e: Entity, type: string, destroying: boolean): boolean {
    const store = this.stores.get(type);
    const c = store?.remove(e);
    if (!c) return false;
    c.onDetach?.();
    const types = this.entityTypes.get(e);
    if (types) {
      types.delete(type);
      if (!destroying) this.updateQueriesFor(e, types);
      else for (const q of this.queries.values()) q._remove(e);
    }
    this.events.emit('componentRemoved', { entity: e, component: c });
    return true;
  }

  // ------------------------------------------------------------------- queries

  /**
   * Get a cached query for entities having all `all` types and none of `none`.
   * Accepts classes or type names.
   */
  query(all: readonly ComponentRef[], none: readonly ComponentRef[] = []): Query {
    const allT = all.map(typeName);
    const noneT = none.map(typeName);
    const key = Query.key(allT, noneT);
    let q = this.queries.get(key);
    if (q) return q;
    q = new Query(allT, noneT);
    for (const [e, types] of this.entityTypes) if (q.matches(types)) q._add(e);
    this.queries.set(key, q);
    return q;
  }

  /** Shorthand for `query(all).entities`. */
  with(...all: ComponentRef[]): Entity[] {
    return this.query(all).entities;
  }

  /** Iterate entities with the given components, receiving component instances. */
  each<A extends Component>(a: ComponentClass<A>, fn: (e: Entity, a: A) => void): void;
  each<A extends Component, B extends Component>(
    a: ComponentClass<A>,
    b: ComponentClass<B>,
    fn: (e: Entity, a: A, b: B) => void,
  ): void;
  each<A extends Component, B extends Component, C extends Component>(
    a: ComponentClass<A>,
    b: ComponentClass<B>,
    c: ComponentClass<C>,
    fn: (e: Entity, a: A, b: B, c: C) => void,
  ): void;
  each(...args: unknown[]): void {
    const fn = args.pop() as (...xs: unknown[]) => void;
    const classes = args as ComponentClass[];
    const q = this.query(classes);
    const stores = classes.map((c) => this.stores.get(c.type)!);
    const ents = q.entities;
    const comps: unknown[] = new Array(classes.length + 1);
    for (let i = ents.length - 1; i >= 0; i--) {
      const e = ents[i];
      comps[0] = e;
      for (let j = 0; j < stores.length; j++) comps[j + 1] = stores[j].get(e);
      fn(...comps);
    }
  }

  private updateQueriesFor(e: Entity, types: Set<string>): void {
    for (const q of this.queries.values()) {
      if (q.matches(types)) q._add(e);
      else q._remove(e);
    }
  }

  // ------------------------------------------------------------------ lookups

  /** First entity whose Name component equals `name`. */
  findByName(name: string): Entity | undefined {
    const store = this.stores.get(Name.type);
    if (!store) return undefined;
    for (let i = 0; i < store.components.length; i++) {
      if ((store.components[i] as Name).name === name) return store.entities[i];
    }
    return undefined;
  }

  /** All entities carrying `tag`. */
  findByTag(tag: string): Entity[] {
    const store = this.stores.get(Tag.type);
    const out: Entity[] = [];
    if (!store) return out;
    for (let i = 0; i < store.components.length; i++) {
      if ((store.components[i] as Tag).has(tag)) out.push(store.entities[i]);
    }
    return out;
  }

  /** Name of an entity or `"Entity <id>"`. */
  nameOf(e: Entity): string {
    return this.getComponent(e, Name)?.name ?? `Entity ${e}`;
  }

  // ---------------------------------------------------------------- hierarchy

  /** Reparent `child` under `parent` (or to root with NULL_ENTITY). Requires Transforms. */
  setParent(child: Entity, parent: Entity, keepWorldTransform = false): void {
    const ct = this.requireComponent(child, Transform);
    if (ct.parent === parent) return;
    if (parent !== NULL_ENTITY && this.isDescendantOf(parent, child)) {
      throw new Error('Cannot parent an entity to its own descendant');
    }
    if (keepWorldTransform) ct.updateWorldMatrix();
    if (ct.parent !== NULL_ENTITY) {
      const old = this.getComponent(ct.parent, Transform);
      if (old) {
        const i = old.children.indexOf(child);
        if (i >= 0) old.children.splice(i, 1);
        const j = old._childTransforms.indexOf(ct);
        if (j >= 0) old._childTransforms.splice(j, 1);
      }
    }
    ct.parent = parent;
    if (parent !== NULL_ENTITY) {
      const pt = this.requireComponent(parent, Transform);
      pt.children.push(child);
      pt._childTransforms.push(ct);
      ct._parentTransform = pt;
      if (keepWorldTransform) ct.setFromWorldMatrix(ct.worldMatrix, pt);
    } else {
      ct._parentTransform = null;
      if (keepWorldTransform) ct.setFromWorldMatrix(ct.worldMatrix, null);
    }
    ct.markDirty();
  }

  getParent(e: Entity): Entity {
    return this.getComponent(e, Transform)?.parent ?? NULL_ENTITY;
  }

  getChildren(e: Entity): readonly Entity[] {
    return this.getComponent(e, Transform)?.children ?? [];
  }

  /** Entities whose Transform has no parent. */
  roots(): Entity[] {
    const out: Entity[] = [];
    for (const t of this.componentsOfType(Transform)) if (t.parent === NULL_ENTITY) out.push(t.entity);
    return out;
  }

  isDescendantOf(e: Entity, ancestor: Entity): boolean {
    let p = this.getParent(e);
    while (p !== NULL_ENTITY) {
      if (p === ancestor) return true;
      p = this.getParent(p);
    }
    return false;
  }

  /** Recompute world matrices of the whole hierarchy (roots first). */
  updateTransforms(): void {
    const store = this.stores.get(Transform.type);
    if (!store) return;
    const list = store.components as Transform[];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.parent === NULL_ENTITY) t.updateWorldMatrix(true);
    }
  }

  // ------------------------------------------------------------------- systems

  addSystem(system: System): System {
    const list = this.systems.get(system.phase);
    if (!list) throw new Error(`Unknown phase "${system.phase}"`);
    list.push(system);
    list.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    if (system.enabled === undefined) system.enabled = true;
    system.init?.(this);
    this.events.emit('systemAdded', system);
    return system;
  }

  removeSystem(system: System): boolean {
    const list = this.systems.get(system.phase);
    if (!list) return false;
    const i = list.indexOf(system);
    if (i < 0) return false;
    list.splice(i, 1);
    system.dispose?.(this);
    this.events.emit('systemRemoved', system);
    return true;
  }

  getSystem(name: string): System | undefined {
    for (const list of this.systems.values()) for (const s of list) if (s.name === name) return s;
    return undefined;
  }

  /** Systems in a phase, in execution order. */
  systemsIn(phase: Phase): readonly System[] {
    return this.systems.get(phase) ?? [];
  }

  /** Run every enabled system in a phase, then flush deferred destroys. */
  runPhase(phase: Phase, dt: number): void {
    const list = this.systems.get(phase)!;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.enabled !== false) s.update(this, dt);
    }
    this.flushDestroyed();
  }

  // --------------------------------------------------------------------- misc

  /** Remove all entities (systems are kept). */
  clear(): void {
    for (const e of this.roots()) this.destroyEntity(e);
    for (const e of this.entities()) this.destroyEntity(e);
    this.pendingDestroy.length = 0;
    this.events.emit('cleared', undefined);
  }

  /** Remove everything including systems. */
  dispose(): void {
    this.clear();
    for (const list of this.systems.values()) {
      for (const s of list) s.dispose?.(this);
      list.length = 0;
    }
    this.queries.clear();
    this.events.clear();
  }

  private assertAlive(e: Entity): void {
    if (!this.isAlive(e)) throw new Error(`Entity ${e} is not alive`);
  }
}

function typeName(ref: ComponentRef): string {
  return typeof ref === 'string' ? ref : ref.type;
}
