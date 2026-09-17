/**
 * Engine plugin exposing the procgen library to sandboxed project scripts as
 * `ctx.engine.procgen`: world creation, mesh registration on the renderer
 * (with per-material fallback groups), renderer feature detection and a few
 * host services scripts cannot reach themselves (URL params, local storage,
 * clipboard). Install with `engine.use(procgenPlugin)`.
 */
import type { Engine, EnginePlugin } from '../core/Engine';
import type { MeshData } from '../render/webgl/Mesh';
import type { GeneratedMesh, MaterialHint, RGB } from './MeshBuilder';
import * as builder from './MeshBuilder';
import * as noise from './noise';
import * as palettes from './palettes';
import * as seeds from './seed';
import { generateIsland } from './island';
import { generateTree } from './tree';
import { generateCrystal, generateRock } from './rock';
import { generateCloud } from './cloud';
import { generateArch, generateColumn, generateStoneLantern, generateStoneRing } from './ruins';
import { generateGlider } from './glider';
import { generateBird } from './bird';
import { generateRing } from './ring';
import * as props from './props';
import { ChunkTracker, WorldGenerator, type WorldOptions } from './world';

/** One registered material group: the mesh name to put in `MeshRenderer.mesh` plus its material. */
export interface RegisteredGroup extends MaterialHint {
  name: string;
  mesh: string;
  color: RGB;
  triangles: number;
}

/** What `registerGenerated` returns: names usable by `MeshRenderer`. */
export interface RegisteredMesh {
  /** Merged mesh with vertex colours (draw with a white material when the renderer supports colours). */
  mesh: string;
  groups: RegisteredGroup[];
  bounds: builder.Bounds;
  triangles: number;
}

/** Renderer capabilities detected at install time (all false headless). */
export interface RendererFeatures {
  /** `MeshData.colors` are honoured. */
  vertexColors: boolean;
  /** `renderer.sky` with `timeOfDay`. */
  sky: boolean;
  /** `renderer.post` settings. */
  post: boolean;
  shadows: boolean;
  water: boolean;
  wind: boolean;
  lods: boolean;
}

/** Host services for scripts (safe subset; every method degrades to a no-op headless). */
export interface HostEnv {
  /** URL search parameter of the page. */
  param(name: string): string | null;
  /** Rewrite the page URL parameters without reloading. */
  setParam(name: string, value: string | null): void;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  copyText(text: string): Promise<boolean>;
  /** Current page URL with extra parameters (invite links). */
  urlWith(params: Record<string, string | null>): string;
  navigate(url: string): void;
  readonly isTouch: boolean;
  /** Milliseconds since the epoch (wall clock; not for simulation). */
  now(): number;
}

export interface ProcgenAPI {
  readonly noise: typeof noise;
  readonly builder: typeof builder;
  readonly palettes: typeof palettes;
  readonly seeds: typeof seeds;
  readonly generators: {
    island: typeof generateIsland; tree: typeof generateTree; rock: typeof generateRock; crystal: typeof generateCrystal; cloud: typeof generateCloud;
    arch: typeof generateArch; column: typeof generateColumn; stoneRing: typeof generateStoneRing; stoneLantern: typeof generateStoneLantern;
    glider: typeof generateGlider; bird: typeof generateBird; ring: typeof generateRing;
    turbine: typeof props.generateTurbine; turbineBlades: typeof props.generateTurbineBlades; windsock: typeof props.generateWindsock;
    paperLantern: typeof props.generatePaperLantern; balloon: typeof props.generateBalloon; mote: typeof props.generateMote; windStreak: typeof props.generateWindStreak; feather: typeof props.generateFeather;
  };
  readonly features: RendererFeatures;
  readonly env: HostEnv;
  /** Build a world for a seed phrase. */
  createWorld(seed: string, opts?: WorldOptions): WorldGenerator;
  createTracker(world: WorldGenerator): ChunkTracker;
  /** The world currently played (set by the world streamer so other scripts can query it). */
  world: WorldGenerator | null;
  /** Register raw mesh data under a name (no-op without a WebGL renderer). Returns true when registered. */
  registerMesh(name: string, data: MeshData): boolean;
  /** Register a generated object: merged mesh as `name`, groups as `name/<group>`. Cached per name. */
  registerGenerated(name: string, generated: GeneratedMesh): RegisteredMesh;
  /** Registered descriptor for a name, if any. */
  registered(name: string): RegisteredMesh | undefined;
  /** Register a world library key (`tree-meadow-pine-0`) and return its descriptor. */
  registerLibrary(world: WorldGenerator, key: string): RegisteredMesh;
  /** Apply a group's material hints to a MeshRenderer-like component. */
  applyMaterial(target: Record<string, unknown>, group: RegisteredGroup): void;
  /** Names registered so far. */
  readonly names: string[];
}

interface RendererLike {
  kind?: string;
  addMesh?(name: string, data: MeshData): void;
  removeMesh?(name: string): void;
  sky?: unknown;
  post?: unknown;
  shadows?: unknown;
  features?: Partial<RendererFeatures>;
}

function detectFeatures(engine: Engine): RendererFeatures {
  const r = engine.renderer as RendererLike | null;
  const declared = r?.features ?? {};
  const has = (k: keyof RendererFeatures, fallback: boolean) => (declared[k] !== undefined ? !!declared[k] : fallback);
  return {
    vertexColors: has('vertexColors', false),
    sky: has('sky', !!r?.sky),
    post: has('post', !!r?.post),
    shadows: has('shadows', !!r?.shadows),
    water: has('water', false),
    wind: has('wind', false),
    lods: has('lods', false),
  };
}

function makeEnv(): HostEnv {
  const win = typeof window !== 'undefined' ? window : null;
  const store = (): Storage | null => { try { return win?.localStorage ?? null; } catch { return null; } };
  return {
    param: (name) => (win ? new URLSearchParams(win.location.search).get(name) : null),
    setParam: (name, value) => {
      if (!win) return;
      const url = new URL(win.location.href);
      if (value === null) url.searchParams.delete(name); else url.searchParams.set(name, value);
      try { win.history.replaceState(null, '', url.toString()); } catch { /* ignore */ }
    },
    storageGet: (key) => { try { return store()?.getItem(key) ?? null; } catch { return null; } },
    storageSet: (key, value) => { try { store()?.setItem(key, value); } catch { /* ignore */ } },
    copyText: async (text) => {
      if (!win) return false;
      try { await win.navigator.clipboard.writeText(text); return true; } catch { return false; }
    },
    urlWith: (params) => {
      if (!win) return '';
      const url = new URL(win.location.href);
      for (const [k, v] of Object.entries(params)) { if (v === null) url.searchParams.delete(k); else url.searchParams.set(k, v); }
      return url.toString();
    },
    navigate: (url) => { if (win) win.location.href = url; },
    get isTouch() { return !!win && (win.navigator.maxTouchPoints > 0 || 'ontouchstart' in win); },
    now: () => Date.now(),
  };
}

/** Create the API object for an engine (used by the plugin; exported for tests). */
export function createProcgenAPI(engine: Engine): ProcgenAPI {
  const registry = new Map<string, RegisteredMesh>();
  const features = detectFeatures(engine);
  const api: ProcgenAPI = {
    noise, builder, palettes, seeds,
    generators: {
      island: generateIsland, tree: generateTree, rock: generateRock, crystal: generateCrystal, cloud: generateCloud,
      arch: generateArch, column: generateColumn, stoneRing: generateStoneRing, stoneLantern: generateStoneLantern,
      glider: generateGlider, bird: generateBird, ring: generateRing,
      turbine: props.generateTurbine, turbineBlades: props.generateTurbineBlades, windsock: props.generateWindsock,
      paperLantern: props.generatePaperLantern, balloon: props.generateBalloon, mote: props.generateMote, windStreak: props.generateWindStreak, feather: props.generateFeather,
    },
    features,
    env: makeEnv(),
    world: null,
    createWorld: (seed, opts) => new WorldGenerator(seed, opts),
    createTracker: (world) => new ChunkTracker(world),
    registerMesh: (name, data) => {
      const r = engine.renderer as RendererLike | null;
      if (!r || typeof r.addMesh !== 'function') return false;
      r.addMesh(name, data);
      return true;
    },
    registerGenerated: (name, generated) => {
      const cached = registry.get(name);
      if (cached) return cached;
      api.registerMesh(name, generated.mesh);
      const groups: RegisteredGroup[] = generated.groups.map((g) => {
        const meshName = `${name}/${g.name}`;
        api.registerMesh(meshName, g.data);
        const { data: _data, ...rest } = g;
        void _data;
        return { ...rest, mesh: meshName };
      });
      const desc: RegisteredMesh = { mesh: name, groups, bounds: generated.mesh.bounds, triangles: generated.mesh.indices.length / 3 };
      registry.set(name, desc);
      return desc;
    },
    registered: (name) => registry.get(name),
    registerLibrary: (world, key) => registry.get(key) ?? api.registerGenerated(key, world.library(key)),
    applyMaterial: (target, group) => {
      const color = target.color as { set?(r: number, g: number, b: number, a?: number): void } | undefined;
      if (color && typeof color.set === 'function') color.set(group.color.r, group.color.g, group.color.b, 1);
      const emissive = target.emissive as { set?(r: number, g: number, b: number, a?: number): void } | undefined;
      if (group.emissive && emissive && typeof emissive.set === 'function') {
        const k = features.post ? 1 : Math.min(1, group.emissiveStrength ?? 1) * 0.6;
        emissive.set(group.emissive.r * k, group.emissive.g * k, group.emissive.b * k, 1);
      }
      if (group.emissiveStrength !== undefined && 'emissiveStrength' in target) target.emissiveStrength = group.emissiveStrength;
      if (group.opacity !== undefined) target.opacity = group.opacity;
      if (group.unlit !== undefined) target.unlit = group.unlit;
      if (group.doubleSided !== undefined) target.doubleSided = group.doubleSided;
      if (group.roughness !== undefined) target.roughness = group.roughness;
      if (group.metallic !== undefined) target.metallic = group.metallic;
      if ('flatShading' in target) target.flatShading = true;
      if (group.wind !== undefined && 'windStrength' in target) target.windStrength = group.wind;
      if (group.water && 'water' in target) target.water = true;
    },
    get names() { return Array.from(registry.keys()); },
  };
  return api;
}

declare module '../core/Engine' {
  interface Engine {
    /** Procedural art library (installed by {@link procgenPlugin}). */
    procgen?: ProcgenAPI;
  }
}

/** Installs `engine.procgen`. */
export const procgenPlugin: EnginePlugin = {
  name: 'procgen',
  install(engine) {
    engine.procgen = createProcgenAPI(engine);
  },
  uninstall(engine) {
    delete engine.procgen;
  },
};
