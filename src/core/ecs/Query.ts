import type { Entity } from './Entity';

/**
 * A cached set of entities matching a component signature. Queries are owned
 * and kept up to date by the {@link World}; iterate `entities` directly in hot
 * loops (it is a plain array, do not mutate it).
 */
export class Query {
  /** Live array of matching entities. Order is insertion order with swap-remove. */
  readonly entities: Entity[] = [];
  private index = new Map<Entity, number>();

  constructor(
    /** Component types that must all be present. */
    readonly all: readonly string[],
    /** Component types that must be absent. */
    readonly none: readonly string[] = [],
  ) {}

  /** Stable cache key for a signature. */
  static key(all: readonly string[], none: readonly string[] = []): string {
    return `${[...all].sort().join(',')}|${[...none].sort().join(',')}`;
  }

  get size(): number {
    return this.entities.length;
  }

  has(e: Entity): boolean {
    return this.index.has(e);
  }

  /** @internal */
  _add(e: Entity): void {
    if (this.index.has(e)) return;
    this.index.set(e, this.entities.length);
    this.entities.push(e);
  }

  /** @internal */
  _remove(e: Entity): void {
    const i = this.index.get(e);
    if (i === undefined) return;
    const last = this.entities.length - 1;
    const lastEntity = this.entities[last];
    this.entities[i] = lastEntity;
    this.index.set(lastEntity, i);
    this.entities.pop();
    this.index.delete(e);
  }

  /** @internal */
  _clear(): void {
    this.entities.length = 0;
    this.index.clear();
  }

  /** Does an entity with these component types match this query? */
  matches(types: ReadonlySet<string>): boolean {
    for (const t of this.all) if (!types.has(t)) return false;
    for (const t of this.none) if (types.has(t)) return false;
    return true;
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this.entities[Symbol.iterator]();
  }
}
