import type { Component, ComponentMeta, FieldMeta } from '../core/ecs/Component';
import type { Registry } from '../core/ecs/Registry';

/**
 * Component types replicated by default on every `NetworkIdentity` entity.
 * `Transform` is handled separately (quantized), so this list is for game
 * state components such as health or score.
 */
const replicatedTypes = new Map<string, ReadonlySet<string> | null>();

/**
 * Mark a component type as replicated host → clients. Every serializable
 * (non-transient) field is sent unless `fields` narrows the set. Works
 * without editing the core registry; components can alternatively set
 * `replicate: true` on their `ComponentMeta` or `sync: true` on a field's
 * `FieldMeta` (both read via structural typing).
 *
 * ```ts
 * markReplicated('Health');              // whole component
 * markReplicated('Player', ['score']);   // only `score`
 * ```
 */
export function markReplicated(type: string, fields?: readonly string[]): void {
  replicatedTypes.set(type, fields ? new Set(fields) : null);
}

/** Remove a type from the global replication list. */
export function unmarkReplicated(type: string): void {
  replicatedTypes.delete(type);
}

/** Types marked with {@link markReplicated}. */
export function replicatedTypeNames(): string[] {
  return Array.from(replicatedTypes.keys());
}

interface ReplicateMeta extends ComponentMeta { replicate?: boolean }
interface SyncFieldMeta extends FieldMeta { sync?: boolean }

/** Types that never replicate as "props" (handled elsewhere or purely local). */
const EXCLUDED = new Set(['Transform', 'NetworkIdentity', 'NetTransform', 'PlayerInput', 'Script', 'Name']);

/**
 * Decide whether `type` replicates for an entity and which fields. Returns
 * `null` when the type is not replicated; an empty set means "all
 * serializable fields".
 */
export function replicationFieldsFor(registry: Registry, type: string, extraTypes: readonly string[]): ReadonlySet<string> | null {
  if (EXCLUDED.has(type)) return null;
  if (extraTypes.includes(type)) return replicatedTypes.get(type) ?? EMPTY;
  if (replicatedTypes.has(type)) return replicatedTypes.get(type) ?? EMPTY;
  const entry = registry.get(type);
  if (!entry) return null;
  if ((entry.meta as ReplicateMeta).replicate) return EMPTY;
  let picked: Set<string> | null = null;
  for (const [name, meta] of Object.entries(entry.fields)) {
    if ((meta as SyncFieldMeta).sync && !meta.transient) (picked ??= new Set()).add(name);
  }
  return picked;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Serialize the replicated fields of a component as a JSON string (stable key
 * order from the registry). Returns `''` when nothing is replicated.
 */
export function serializeReplicated(registry: Registry, component: Component, fields: ReadonlySet<string>): string {
  const all = registry.serialize(component);
  if (fields.size === 0) return JSON.stringify(all);
  const out: Record<string, unknown> = {};
  for (const k of fields) if (k in all) out[k] = all[k];
  return JSON.stringify(out);
}
