/**
 * Shared helpers for authoring demo projects in TypeScript. Each demo module
 * exports a `build()` function returning a {@link DemoBundle}; the build
 * script (`scripts/build-demos.ts`) writes it to `public/demos/<id>/`.
 *
 * Scenes are authored against a live `World` and serialized with `saveScene`,
 * so the generated JSON is always valid for the current component registry.
 * Unknown component fields throw at build time to catch typos early.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  Engine, World, Tag, Transform, createPrefab, createProject, saveScene, defaultRegistry,
  type Entity, type PrefabData, type Project, type ProjectSettings, type SceneData, type ScriptSource, type AssetManifestEntry,
} from '../../src/index';

/** Entry of `public/demos/index.json`. */
export interface DemoIndexEntry {
  id: string;
  /** Display name (the launcher also accepts `title`). */
  name: string;
  title: string;
  description: string;
  /** Path relative to the demo folder. */
  thumbnail: string;
  renderer: '2d' | '3d';
  multiplayer: boolean;
  players: { min: number; max: number };
  tags: string[];
  /** Human-readable control hints shown on the launcher card. */
  controls: string[];
  featured: boolean;
  /** Starter templates are listed separately by the launcher and used by "New project". */
  template?: boolean;
  /** Flagship: the launcher shows it as a hero banner above the gallery. */
  hero?: boolean;
  /** Optional rendered screenshot (relative to the demo folder) the hero banner prefers over `thumbnail`. */
  heroImage?: string;
}

/** Everything the build script needs to publish one demo. */
export interface DemoBundle {
  id: string;
  entry: DemoIndexEntry;
  project: Project;
  /** Extra files relative to `public/demos/<id>/` (SVG assets, WAVs, README, thumbnail). */
  files: Record<string, string | Uint8Array>;
}

/** Fixed timestamp so regenerated projects are byte-identical. */
export const BUILD_TIME = '2026-09-16T00:00:00.000Z';

export type ComponentInit = Record<string, Record<string, unknown>>;

/**
 * Builds a scene against a live World. `entity()` accepts a map of component
 * type → field values (same shape as the JSON) and validates every field name
 * against the registry.
 */
export class SceneBuilder {
  readonly world = new World(defaultRegistry);

  entity(name: string, components: ComponentInit = {}, opts: { parent?: Entity; tags?: string[] } = {}): Entity {
    const e = this.world.createEntity(name);
    for (const [type, data] of Object.entries(components)) this.apply(e, type, data);
    if (opts.tags?.length) {
      const tag = this.world.getComponent(e, Tag) ?? this.world.addComponent(e, Tag);
      for (const t of opts.tags) tag.add(t);
    }
    if (opts.parent !== undefined) this.world.setParent(e, opts.parent);
    return e;
  }

  /** Add or update a component on an existing entity. */
  apply(e: Entity, type: string, data: Record<string, unknown>): void {
    const entry = defaultRegistry.get(type);
    if (!entry) throw new Error(`Unknown component type "${type}"`);
    for (const key of Object.keys(data)) {
      if (!(key in entry.fields)) throw new Error(`Component "${type}" has no field "${key}"`);
    }
    const existing = this.world.getComponent(e, type);
    if (existing) defaultRegistry.applyProps(existing, data);
    else this.world.addComponentByType(e, type, data);
  }

  /** Read a component to tweak it further. */
  get<T>(e: Entity, type: string): T {
    const c = this.world.getComponent(e, type);
    if (!c) throw new Error(`Entity ${e} has no ${type}`);
    return c as unknown as T;
  }

  transform(e: Entity): Transform {
    return this.world.requireComponent(e, Transform);
  }

  save(name: string, settings?: Record<string, unknown>): SceneData {
    this.world.updateTransforms();
    return saveScene(this.world, name, settings);
  }
}

/** Build a prefab from a fresh world; `fn` returns the root entity. */
export function prefab(name: string, fn: (b: SceneBuilder) => Entity): PrefabData {
  const b = new SceneBuilder();
  const root = fn(b);
  b.world.updateTransforms();
  return createPrefab(b.world, root, name);
}

let compiler: Engine | null = null;

/**
 * Load every `.js` file of a directory as a project script. Each file must
 * call `defineScript({ name })` with a name equal to its basename; the source
 * is compiled once here so syntax errors fail the build instead of the player.
 */
export function loadScripts(dir: string): ScriptSource[] {
  compiler ??= Engine.create(null, { audio: false, renderer: 'none' });
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  const out: ScriptSource[] = [];
  for (const f of files) {
    const name = basename(f, '.js');
    const source = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n').trimEnd() + '\n';
    const def = compiler.scripting.compile(source, name);
    if (def.name !== name) throw new Error(`Script ${f} defines "${def.name}" but the file is named "${name}"`);
    out.push({ name, source });
  }
  return out;
}

export interface ProjectSpec {
  id: string;
  name: string;
  description: string;
  renderer: '2d' | '3d';
  scenes: SceneData[];
  startScene?: string;
  scripts: ScriptSource[];
  prefabs?: PrefabData[];
  assets?: AssetManifestEntry[];
  settings?: DeepPartial<ProjectSettings>;
  thumbnail?: string;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Assemble a deterministic Project document from its parts. */
export function makeProject(spec: ProjectSpec): Project {
  const p = createProject({ id: spec.id, name: spec.name, renderer: spec.renderer, author: 'Forge Engine demos' });
  p.description = spec.description;
  p.thumbnail = spec.thumbnail ?? 'thumbnail.svg';
  p.createdAt = BUILD_TIME;
  p.updatedAt = BUILD_TIME;
  p.scenes = spec.scenes;
  p.startScene = spec.startScene ?? spec.scenes[0].name;
  p.scripts = spec.scripts;
  p.prefabs = spec.prefabs ?? [];
  p.assets = { assets: spec.assets ?? [] };
  const s = spec.settings ?? {};
  p.settings = {
    ...p.settings,
    ...(s as Partial<ProjectSettings>),
    viewport: { ...p.settings.viewport, ...s.viewport },
    physics: { ...p.settings.physics, ...(s.physics as Partial<ProjectSettings['physics']>) },
    network: { ...p.settings.network, ...(s.network as Partial<ProjectSettings['network']>) },
    multiUser: { ...p.settings.multiUser, ...(s.multiUser as Partial<ProjectSettings['multiUser']>) },
    input: {
      actions: { ...p.settings.input.actions, ...(s.input?.actions as ProjectSettings['input']['actions']) },
      axes: { ...p.settings.input.axes, ...(s.input?.axes as ProjectSettings['input']['axes']) },
    },
    touchButtons: (s.touchButtons as string[] | undefined) ?? p.settings.touchButtons,
  };
  return p;
}

// ------------------------------------------------------------------ colours

export interface RGBA { r: number; g: number; b: number; a: number }

/** `#rrggbb` → engine colour object. */
export function hex(h: string, a = 1): RGBA {
  const v = h.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
}

export const v2 = (x: number, y: number) => ({ x, y });
export const v3 = (x: number, y: number, z: number) => ({ x, y, z });

/** Quaternion for Euler angles (radians, XYZ order) as a plain object. */
export function euler(x: number, y: number, z: number): { x: number; y: number; z: number; w: number } {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}

/** Rotation about Z as a quaternion. */
export function rotZ(rad: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: 0, z: Math.sin(rad / 2), w: Math.cos(rad / 2) };
}

/** Wrap SVG body markup in a document with an explicit size (required for canvas drawImage). */
export function svg(width: number, height: number, body: string, extra = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${extra}>\n${body}\n</svg>\n`;
}

/** Common thumbnail frame (320x180) with a dark gradient background. */
export function thumbnail(body: string, from = '#141a2a', to = '#0b0e16'): string {
  return svg(320, 180, `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>\n<rect width="320" height="180" fill="url(#bg)"/>\n${body}`);
}
