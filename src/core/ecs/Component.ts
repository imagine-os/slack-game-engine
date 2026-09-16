import type { Entity } from './Entity';

/**
 * Base class for all components. Subclasses declare a unique static `type`
 * string used for serialization and Registry lookups, and plain data fields
 * which the Registry can introspect via {@link ComponentMeta}.
 *
 * Components should be pure data where possible; behaviour lives in systems.
 */
export abstract class Component {
  /** Unique type name (e.g. `"Transform"`). Must be overridden. */
  static readonly type: string = 'Component';

  /** Entity this instance is attached to (set by the World). */
  entity: Entity = 0;

  /** Convenience accessor for the static type name. */
  get type(): string {
    return (this.constructor as typeof Component).type;
  }

  /** Called after the component is attached to an entity in a world. */
  onAttach?(): void;
  /** Called just before the component is removed or its entity destroyed. */
  onDetach?(): void;
}

/** Constructor type for a component class. */
export interface ComponentClass<T extends Component = Component> {
  new (): T;
  readonly type: string;
}

/** Field kinds an inspector can render generically. */
export type FieldType =
  | 'number'
  | 'integer'
  | 'string'
  | 'boolean'
  | 'vec2'
  | 'vec3'
  | 'quat'
  | 'color'
  | 'rect'
  | 'enum'
  | 'asset'
  | 'entity'
  | 'json';

/** Inspector metadata for a single component field. */
export interface FieldMeta {
  /** Field kind. */
  type: FieldType;
  /** Human-readable label. Defaults to the field name. */
  label?: string;
  /** Tooltip / help text. */
  description?: string;
  /** For `number`/`integer`: slider/clamp range. */
  min?: number;
  max?: number;
  step?: number;
  /** For `enum`: allowed values. */
  options?: readonly string[];
  /** For `asset`: which asset kind (`image`, `audio`, `atlas`, `gltf`, `json`, `text`, `any`). */
  assetKind?: string;
  /** Hide from the inspector (still serialized). */
  hidden?: boolean;
  /** Read-only in the inspector. */
  readonly?: boolean;
  /** Do not serialize this field (runtime-only). */
  transient?: boolean;
}

/** Metadata describing a component type for editors and serialization. */
export interface ComponentMeta {
  /** Category shown in "Add Component" menus. */
  category?: string;
  /** Short description. */
  description?: string;
  /** Icon hint (emoji or icon name) for editors. */
  icon?: string;
  /** Field metadata keyed by property name. Fields not listed are inferred. */
  fields?: Record<string, FieldMeta>;
  /** If true only one per entity (default true). */
  unique?: boolean;
  /** Component types automatically added alongside this one. */
  requires?: readonly string[];
}
