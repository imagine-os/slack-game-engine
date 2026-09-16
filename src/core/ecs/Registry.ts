import { Vec2, Vec3, Quat, Color, Rect } from '../math';
import type { Component, ComponentClass, ComponentMeta, FieldMeta, FieldType } from './Component';

/** Resolved registry entry for one component type. */
export interface RegistryEntry {
  type: string;
  cls: ComponentClass;
  meta: ComponentMeta;
  /** Serialized default values from a freshly constructed instance. */
  defaults: Record<string, unknown>;
  /** Field metadata (declared merged over inferred). Order matches declaration order. */
  fields: Record<string, FieldMeta>;
}

/** Callback that maps an entity id from serialized data to a live one. */
export type EntityRemap = (id: number) => number;

/** Fields that live on the base `Component` and are never serialized. */
const RESERVED_FIELDS = new Set(['entity', 'type']);

/**
 * Maps component type names to classes, default values and inspector metadata.
 *
 * The Registry is the single source of truth for component serialization: it
 * converts component instances to plain JSON-safe records and back, handles
 * math value types (Vec2/Vec3/Quat/Color/Rect) and remaps entity references.
 * Editors use {@link RegistryEntry.fields} to render inspectors generically.
 */
export class Registry {
  private entries = new Map<string, RegistryEntry>();

  /** Register a component class. Re-registering the same type replaces it. */
  register<T extends Component>(cls: ComponentClass<T>, meta: ComponentMeta = {}): this {
    const type = cls.type;
    if (!type || type === 'Component') {
      throw new Error(`Component class ${cls.name} must define a unique static "type"`);
    }
    const instance = new cls();
    const fields = inferFields(instance, meta.fields ?? {});
    const entry: RegistryEntry = { type, cls, meta: { unique: true, ...meta }, defaults: {}, fields };
    entry.defaults = this.serializeWith(entry, instance);
    this.entries.set(type, entry);
    return this;
  }

  unregister(type: string): boolean {
    return this.entries.delete(type);
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  get(type: string): RegistryEntry | undefined {
    return this.entries.get(type);
  }

  /** Throwing variant of {@link get}. */
  require(type: string): RegistryEntry {
    const e = this.entries.get(type);
    if (!e) throw new Error(`Component type "${type}" is not registered`);
    return e;
  }

  /** All registered type names in registration order. */
  types(): string[] {
    return Array.from(this.entries.keys());
  }

  /** All entries in registration order. */
  all(): RegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Entries grouped by `meta.category` (for editor menus). */
  byCategory(): Map<string, RegistryEntry[]> {
    const out = new Map<string, RegistryEntry[]>();
    for (const e of this.entries.values()) {
      const cat = e.meta.category ?? 'General';
      let list = out.get(cat);
      if (!list) out.set(cat, (list = []));
      list.push(e);
    }
    return out;
  }

  /** Construct a fresh instance of a registered type. */
  create(type: string): Component {
    return new (this.require(type).cls)();
  }

  /** Field metadata (declared merged over inferred) for a type. */
  fields(type: string): Record<string, FieldMeta> {
    return this.require(type).fields;
  }

  /** JSON-safe default values for a type. */
  defaults(type: string): Record<string, unknown> {
    return structuredClone(this.require(type).defaults);
  }

  /** Convert a component instance to a plain JSON-safe record. Transient fields are skipped. */
  serialize(component: Component, remap?: EntityRemap): Record<string, unknown> {
    return this.serializeWith(this.require(component.type), component, remap);
  }

  /**
   * Populate `into` (or a fresh instance) from a plain record. Unknown keys are
   * ignored; math value types are copied into existing instances.
   */
  deserialize<T extends Component = Component>(
    type: string,
    data: Record<string, unknown>,
    into?: T,
    remap?: EntityRemap,
  ): T {
    const entry = this.require(type);
    const target = (into ?? new entry.cls()) as T;
    this.applyProps(target, data, remap);
    return target;
  }

  /** Assign a partial set of plain values onto a component, respecting field types. */
  applyProps(component: Component, data: Record<string, unknown>, remap?: EntityRemap): void {
    const entry = this.require(component.type);
    const c = component as unknown as Record<string, unknown>;
    for (const key of Object.keys(data)) {
      if (RESERVED_FIELDS.has(key)) continue;
      const meta = entry.fields[key];
      const value = data[key];
      if (meta?.transient) continue;
      const current = c[key];
      if (meta?.type === 'entity' && typeof value === 'number') {
        c[key] = remap ? remap(value) : value;
      } else if (isCopyable(current) && value !== null && typeof value === 'object') {
        current.copy(value as never);
      } else if (Array.isArray(value)) {
        c[key] = value.map((v) => (meta?.type === 'entity' && remap && typeof v === 'number' ? remap(v) : cloneValue(v)));
      } else if (value !== null && typeof value === 'object') {
        c[key] = cloneValue(value);
      } else {
        c[key] = value;
      }
    }
  }

  private serializeWith(entry: RegistryEntry, component: Component, remap?: EntityRemap): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const c = component as unknown as Record<string, unknown>;
    for (const key of Object.keys(entry.fields)) {
      const meta = entry.fields[key];
      if (meta.transient) continue;
      const v = c[key];
      if (typeof v === 'function' || v === undefined) continue;
      if (meta.type === 'entity' && typeof v === 'number') out[key] = remap ? remap(v) : v;
      else out[key] = toPlain(v);
    }
    return out;
  }
}

function isCopyable(v: unknown): v is { copy(o: unknown): unknown } {
  return v !== null && typeof v === 'object' && typeof (v as { copy?: unknown }).copy === 'function';
}

function cloneValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  return structuredClone(v);
}

function toPlain(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (typeof (v as { toJSON?: unknown }).toJSON === 'function') return (v as { toJSON(): unknown }).toJSON();
  if (Array.isArray(v)) return v.map(toPlain);
  if (v instanceof Float32Array || v instanceof Float64Array || v instanceof Int32Array) return Array.from(v);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) out[k] = toPlain((v as Record<string, unknown>)[k]);
  return out;
}

/** Infer field types from a default instance, letting declared metadata win. */
function inferFields(instance: Component, declared: Record<string, FieldMeta>): Record<string, FieldMeta> {
  const out: Record<string, FieldMeta> = {};
  const obj = instance as unknown as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (RESERVED_FIELDS.has(key) || key.startsWith('_')) continue;
    const v = obj[key];
    const inferred = inferType(v);
    const d = declared[key];
    if (typeof v === 'function') continue;
    if (!inferred && !d) {
      // Unknown runtime-only object: keep it out of serialization.
      out[key] = { type: 'json', transient: true, hidden: true };
      continue;
    }
    out[key] = { ...d, type: d?.type ?? inferred ?? 'json' };
  }
  for (const key of Object.keys(declared)) if (!out[key]) out[key] = declared[key];
  return out;
}

function inferType(v: unknown): FieldType | undefined {
  switch (typeof v) {
    case 'number': return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'object':
      if (v === null) return 'json';
      if (v instanceof Vec2) return 'vec2';
      if (v instanceof Vec3) return 'vec3';
      if (v instanceof Quat) return 'quat';
      if (v instanceof Color) return 'color';
      if (v instanceof Rect) return 'rect';
      if (Array.isArray(v)) return 'json';
      if (Object.getPrototypeOf(v) === Object.prototype) return 'json';
      return undefined;
    default:
      return undefined;
  }
}

/** Process-wide default registry. Engine and World use it unless given another. */
export const defaultRegistry = new Registry();

/** Convenience: register into the default registry. */
export function registerComponent<T extends Component>(cls: ComponentClass<T>, meta?: ComponentMeta): ComponentClass<T> {
  defaultRegistry.register(cls, meta);
  return cls;
}
