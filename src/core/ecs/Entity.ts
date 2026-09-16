/**
 * Entities are plain integer ids. The high 12 bits hold a generation counter
 * so that stale references to a destroyed-and-reused slot can be detected.
 */
export type Entity = number;

/** Sentinel for "no entity". */
export const NULL_ENTITY: Entity = 0;

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;

/** Extract slot index from an entity id. */
export function entityIndex(e: Entity): number {
  return e & INDEX_MASK;
}

/** Extract generation from an entity id. */
export function entityGeneration(e: Entity): number {
  return e >>> INDEX_BITS;
}

/** Build an entity id from index + generation. Index 0 is reserved for NULL. */
export function makeEntity(index: number, generation: number): Entity {
  return ((generation << INDEX_BITS) | index) >>> 0;
}

/** Maximum simultaneously live entities. */
export const MAX_ENTITIES = INDEX_MASK;
