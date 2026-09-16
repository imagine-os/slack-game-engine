/** Built-in asset kinds. Plugins may register more via `AssetManager.registerLoader`. */
export type AssetKind = 'image' | 'atlas' | 'audio' | 'json' | 'text' | 'binary' | 'gltf' | (string & {});

/** One entry in a project's asset manifest. */
export interface AssetManifestEntry {
  /** Stable id used by components (`Sprite.texture = 'hero'`). */
  id: string;
  kind: AssetKind;
  /** URL, relative to the manifest base URL, or a `data:` URL. */
  url: string;
  /** Loader-specific options (e.g. atlas image id). */
  meta?: Record<string, unknown>;
}

/** Asset manifest stored inside a project. */
export interface AssetManifest {
  /** Base URL that relative entries resolve against. */
  baseUrl?: string;
  assets: AssetManifestEntry[];
}

/** Sprite-sheet frame definition. */
export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pivot in 0..1 of the frame (default 0.5,0.5). */
  pivotX?: number;
  pivotY?: number;
}

/** Decoded texture atlas. */
export interface Atlas {
  /** Asset id of the backing image. */
  image: string;
  frames: Record<string, AtlasFrame>;
  /** Named animations as ordered frame names, with an optional default fps. */
  animations?: Record<string, { frames: string[]; fps?: number; loop?: boolean }>;
}

/** JSON shape accepted for atlases: either the Forge format or TexturePacker-like `{frames: {name: {frame: {x,y,w,h}}}}`. */
export interface AtlasJSON {
  image?: string;
  meta?: { image?: string };
  frames: Record<string, AtlasFrame | { frame: { x: number; y: number; w: number; h: number }; pivot?: { x: number; y: number } }>;
  animations?: Record<string, string[] | { frames: string[]; fps?: number; loop?: boolean }>;
}

/** Asynchronous loader for one kind. */
export type AssetLoader<T = unknown> = (url: string, entry: AssetManifestEntry, manager: AssetManagerLike) => Promise<T>;

/** Minimal manager surface visible to loaders (avoids a circular import). */
export interface AssetManagerLike {
  resolveUrl(url: string): string;
  load<T = unknown>(kind: AssetKind, url: string, id?: string, meta?: Record<string, unknown>): Promise<T>;
  fetchArrayBuffer(url: string): Promise<ArrayBuffer>;
  fetchText(url: string): Promise<string>;
  fetchJSON<T = unknown>(url: string): Promise<T>;
}
