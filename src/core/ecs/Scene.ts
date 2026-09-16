import type { Entity } from './Entity';
import { NULL_ENTITY } from './Entity';
import { Name } from './components';
import { Transform } from './Transform';
import type { World } from './World';

/** Current scene schema version. Bump when the format changes; see {@link migrateScene}. */
export const SCENE_VERSION = 1;

/** Serialized component. */
export interface ComponentData {
  type: string;
  data: Record<string, unknown>;
}

/** Serialized entity. `id` is only meaningful inside the containing document. */
export interface EntityData {
  id: number;
  name?: string;
  /** Parent entity id within the document, if any. */
  parent?: number;
  components: ComponentData[];
}

/** Serialized scene document. */
export interface SceneData {
  version: number;
  name: string;
  entities: EntityData[];
  /** Free-form scene settings (background color, gravity override, etc.). */
  settings?: Record<string, unknown>;
}

/** Serialized prefab: an entity subtree with root first. Ids are document-local. */
export interface PrefabData {
  version: number;
  name: string;
  entities: EntityData[];
}

/** Options for {@link loadScene} / {@link instantiatePrefab}. */
export interface DeserializeOptions {
  /** Remove existing entities first (scene only). Default true for scenes. */
  clear?: boolean;
  /** Parent for root entities (prefabs). */
  parent?: Entity;
  /** Called for unknown component types instead of throwing. */
  onUnknownComponent?: (entity: Entity, data: ComponentData) => void;
}

/** Result of loading a document into a world. */
export interface LoadResult {
  /** Map from document id to live entity. */
  idMap: Map<number, Entity>;
  /** Root entities created (document order). */
  roots: Entity[];
}

/** Serialize one entity (without children). */
export function serializeEntity(world: World, e: Entity, remap: (id: number) => number = (x) => x): EntityData {
  const out: EntityData = { id: remap(e), components: [] };
  const name = world.getComponent(e, Name);
  if (name) out.name = name.name;
  const parent = world.getParent(e);
  if (parent !== NULL_ENTITY) out.parent = remap(parent);
  for (const c of world.getComponents(e)) {
    if (!world.registry.has(c.type)) continue;
    const data = world.registry.serialize(c, remap);
    if (c.type === Transform.type) delete data.parent;
    out.components.push({ type: c.type, data });
  }
  return out;
}

/** Collect an entity and all descendants, parents before children. */
export function collectSubtree(world: World, root: Entity, out: Entity[] = []): Entity[] {
  out.push(root);
  for (const c of world.getChildren(root)) collectSubtree(world, c, out);
  return out;
}

/** Serialize the whole world into a versioned {@link SceneData}. */
export function saveScene(world: World, name = 'Scene', settings?: Record<string, unknown>): SceneData {
  const order: Entity[] = [];
  for (const r of world.roots()) collectSubtree(world, r, order);
  // Include bare entities (no Transform) too.
  for (const e of world.entities()) if (!world.hasComponent(e, Transform)) order.push(e);
  const ids = new Map<number, number>();
  order.forEach((e, i) => ids.set(e, i + 1));
  const remap = (id: number) => ids.get(id) ?? 0;
  const scene: SceneData = {
    version: SCENE_VERSION,
    name,
    entities: order.map((e) => serializeEntity(world, e, remap)),
  };
  if (settings) scene.settings = settings;
  return scene;
}

/** Load a scene document into the world. Clears existing entities by default. */
export function loadScene(world: World, scene: SceneData, opts: DeserializeOptions = {}): LoadResult {
  const data = migrateScene(scene);
  if (opts.clear !== false) world.clear();
  return instantiateEntities(world, data.entities, opts);
}

/** Create a prefab from an entity subtree. */
export function createPrefab(world: World, root: Entity, name = world.nameOf(root)): PrefabData {
  const order = collectSubtree(world, root);
  const ids = new Map<number, number>();
  order.forEach((e, i) => ids.set(e, i + 1));
  const remap = (id: number) => ids.get(id) ?? 0;
  const entities = order.map((e) => serializeEntity(world, e, remap));
  delete entities[0].parent;
  return { version: SCENE_VERSION, name, entities };
}

/** Instantiate a prefab; returns the new root entity. */
export function instantiatePrefab(
  world: World,
  prefab: PrefabData,
  overrides: DeserializeOptions & { position?: { x: number; y: number; z?: number }; name?: string } = {},
): Entity {
  const result = instantiateEntities(world, prefab.entities, overrides);
  const root = result.roots[0];
  if (root === undefined) throw new Error('Prefab has no entities');
  if (overrides.position) {
    const t = world.getComponent(root, Transform);
    t?.setPosition(overrides.position.x, overrides.position.y, overrides.position.z ?? t.position.z);
  }
  if (overrides.name) {
    const n = world.getComponent(root, Name);
    if (n) n.name = overrides.name;
    else world.addComponent(root, Name, { name: overrides.name });
  }
  return root;
}

/** Shared instantiate logic; entities must be ordered parents before children. */
export function instantiateEntities(world: World, entities: readonly EntityData[], opts: DeserializeOptions = {}): LoadResult {
  const idMap = new Map<number, Entity>();
  const roots: Entity[] = [];
  // First pass: create all entities so entity references can be remapped.
  for (const ed of entities) {
    const hasTransform = ed.components.some((c) => c.type === Transform.type);
    const e = hasTransform ? world.createEntity() : world.createBareEntity();
    idMap.set(ed.id, e);
  }
  const remap = (id: number) => idMap.get(id) ?? NULL_ENTITY;
  // Second pass: components.
  for (const ed of entities) {
    const e = idMap.get(ed.id)!;
    for (const cd of ed.components) {
      if (!world.registry.has(cd.type)) {
        if (opts.onUnknownComponent) opts.onUnknownComponent(e, cd);
        else throw new Error(`Unknown component type "${cd.type}" in scene data`);
        continue;
      }
      const existing = world.getComponent(e, cd.type);
      if (existing) {
        const { parent: _ignored, ...rest } = cd.data;
        world.registry.applyProps(existing, rest, remap);
      } else {
        const c = world.registry.deserialize(cd.type, cd.data, undefined, remap);
        world.addComponent(e, c);
      }
    }
    if (ed.name !== undefined) {
      const n = world.getComponent(e, Name);
      if (n) n.name = ed.name;
      else world.addComponent(e, Name, { name: ed.name });
    }
  }
  // Third pass: hierarchy.
  for (const ed of entities) {
    const e = idMap.get(ed.id)!;
    if (!world.hasComponent(e, Transform)) continue;
    const parent = ed.parent !== undefined ? idMap.get(ed.parent) : undefined;
    if (parent !== undefined) world.setParent(e, parent);
    else {
      roots.push(e);
      if (opts.parent) world.setParent(e, opts.parent);
    }
  }
  world.updateTransforms();
  return { idMap, roots };
}

/** Upgrade older scene documents to the current version. */
export function migrateScene(scene: SceneData): SceneData {
  if (scene.version === SCENE_VERSION) return scene;
  if (scene.version > SCENE_VERSION) {
    throw new Error(`Scene version ${scene.version} is newer than supported ${SCENE_VERSION}`);
  }
  // Version 0 / missing: identical layout without a version field.
  return { ...scene, version: SCENE_VERSION };
}

/** Deep-clone a scene document. */
export function cloneScene(scene: SceneData): SceneData {
  return structuredClone(scene);
}

/** Create an empty scene document. */
export function createEmptyScene(name = 'Untitled'): SceneData {
  return { version: SCENE_VERSION, name, entities: [], settings: {} };
}
