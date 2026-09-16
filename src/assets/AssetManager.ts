import { EventEmitter } from '../core/EventEmitter';
import type { AssetKind, AssetLoader, AssetManifest, AssetManifestEntry, AssetManagerLike, Atlas, AtlasJSON } from './types';

export interface AssetEvents extends Record<string, unknown> {
  /** Progress while loading a manifest or batch. */
  progress: { loaded: number; total: number; id: string; url: string };
  loaded: { id: string; kind: AssetKind };
  error: { id: string; url: string; error: unknown };
  /** All queued loads finished. */
  complete: void;
}

interface Entry {
  id: string;
  kind: AssetKind;
  url: string;
  value: unknown;
}

/**
 * Loads, caches and hands out assets by id. Loaders are pluggable per kind.
 * Supports absolute URLs, `data:` URLs and paths relative to {@link baseUrl}.
 */
export class AssetManager implements AssetManagerLike {
  readonly events = new EventEmitter<AssetEvents>();
  /** Base URL used for relative asset paths. Defaults to the document base. */
  baseUrl: string;
  /** Hook used by the audio loader to decode buffers; set by the AudioEngine. */
  decodeAudio: ((data: ArrayBuffer) => Promise<AudioBuffer>) | null = null;

  private loaders = new Map<string, AssetLoader>();
  private cache = new Map<string, Entry>();
  private pending = new Map<string, Promise<unknown>>();

  constructor(baseUrl = './') {
    this.baseUrl = baseUrl;
    this.registerLoader('image', loadImage);
    this.registerLoader('json', (url) => this.fetchJSON(url));
    this.registerLoader('text', (url) => this.fetchText(url));
    this.registerLoader('binary', (url) => this.fetchArrayBuffer(url));
    this.registerLoader('atlas', loadAtlas);
    this.registerLoader('audio', async (url) => {
      const buf = await this.fetchArrayBuffer(url);
      if (!this.decodeAudio) throw new Error('No audio decoder available (is the AudioEngine created?)');
      return this.decodeAudio(buf);
    });
  }

  /** Register or replace the loader for a kind. */
  registerLoader<T>(kind: AssetKind, loader: AssetLoader<T>): void {
    this.loaders.set(kind, loader as AssetLoader);
  }

  hasLoader(kind: AssetKind): boolean {
    return this.loaders.has(kind);
  }

  /** Resolve a manifest-relative URL against {@link baseUrl}. Absolute and data URLs pass through. */
  resolveUrl(url: string): string {
    if (/^(data:|blob:|https?:|\/\/)/i.test(url)) return url;
    if (url.startsWith('/')) return url;
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : this.baseUrl + '/';
    return base + url.replace(/^\.\//, '');
  }

  /**
   * Load one asset. Returns the cached value when `id` is already loaded.
   * Concurrent loads of the same id share one promise.
   */
  load<T = unknown>(kind: AssetKind, url: string, id: string = url, meta?: Record<string, unknown>): Promise<T> {
    const cached = this.cache.get(id);
    if (cached) return Promise.resolve(cached.value as T);
    const inflight = this.pending.get(id);
    if (inflight) return inflight as Promise<T>;
    const loader = this.loaders.get(kind);
    if (!loader) return Promise.reject(new Error(`No loader registered for asset kind "${kind}"`));
    const entry: AssetManifestEntry = { id, kind, url, meta };
    const p = loader(this.resolveUrl(url), entry, this)
      .then((value) => {
        this.cache.set(id, { id, kind, url, value });
        this.pending.delete(id);
        this.events.emit('loaded', { id, kind });
        return value as T;
      })
      .catch((error: unknown) => {
        this.pending.delete(id);
        this.events.emit('error', { id, url, error });
        throw error;
      });
    this.pending.set(id, p);
    return p as Promise<T>;
  }

  /** Load every entry of a manifest, emitting `progress`. Failures are collected, not thrown, unless `strict`. */
  async loadManifest(manifest: AssetManifest, opts: { strict?: boolean } = {}): Promise<{ failed: AssetManifestEntry[] }> {
    if (manifest.baseUrl) this.baseUrl = manifest.baseUrl;
    return this.loadAll(manifest.assets, opts);
  }

  async loadAll(entries: readonly AssetManifestEntry[], opts: { strict?: boolean } = {}): Promise<{ failed: AssetManifestEntry[] }> {
    const total = entries.length;
    let loaded = 0;
    const failed: AssetManifestEntry[] = [];
    await Promise.all(
      entries.map(async (e) => {
        try {
          await this.load(e.kind, e.url, e.id, e.meta);
        } catch (err) {
          failed.push(e);
          if (opts.strict) throw err;
        } finally {
          loaded++;
          this.events.emit('progress', { loaded, total, id: e.id, url: e.url });
        }
      }),
    );
    this.events.emit('complete', undefined);
    return { failed };
  }

  /** Put a pre-built value into the cache (procedural textures, generated buffers). */
  set<T>(id: string, kind: AssetKind, value: T): T {
    this.cache.set(id, { id, kind, url: '', value });
    return value;
  }

  get<T = unknown>(id: string): T | undefined {
    return this.cache.get(id)?.value as T | undefined;
  }

  /** Throwing variant of {@link get}. */
  require<T = unknown>(id: string): T {
    const v = this.get<T>(id);
    if (v === undefined) throw new Error(`Asset "${id}" is not loaded`);
    return v;
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  kindOf(id: string): AssetKind | undefined {
    return this.cache.get(id)?.kind;
  }

  /** Ids of loaded assets, optionally filtered by kind. */
  ids(kind?: AssetKind): string[] {
    const out: string[] = [];
    for (const e of this.cache.values()) if (!kind || e.kind === kind) out.push(e.id);
    return out;
  }

  unload(id: string): boolean {
    return this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }

  async fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.arrayBuffer();
  }

  async fetchText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.text();
  }

  async fetchJSON<T = unknown>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return res.json() as Promise<T>;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

/** Normalize either atlas JSON flavour into {@link Atlas} and load its image. */
async function loadAtlas(url: string, entry: AssetManifestEntry, manager: AssetManagerLike): Promise<Atlas> {
  const json = await manager.fetchJSON<AtlasJSON>(url);
  const frames: Atlas['frames'] = {};
  for (const [name, f] of Object.entries(json.frames)) {
    if ('frame' in f) {
      frames[name] = { x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h, pivotX: f.pivot?.x, pivotY: f.pivot?.y };
    } else frames[name] = { ...f };
  }
  const animations: Atlas['animations'] = {};
  for (const [name, a] of Object.entries(json.animations ?? {})) {
    animations[name] = Array.isArray(a) ? { frames: a } : { ...a };
  }
  const imageRef = (entry.meta?.image as string | undefined) ?? json.image ?? json.meta?.image;
  if (!imageRef) throw new Error(`Atlas ${entry.id} does not reference an image`);
  // Image path is relative to the atlas file unless it is an already-loaded asset id.
  const imageId = `${entry.id}.image`;
  const imageUrl = /^(data:|https?:|\/)/.test(imageRef) ? imageRef : url.slice(0, url.lastIndexOf('/') + 1) + imageRef;
  await manager.load('image', imageUrl, imageId);
  return { image: imageId, frames, animations };
}
