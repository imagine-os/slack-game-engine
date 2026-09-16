import type { Color, Vec2, Vec3, Vec3Like } from '../core/math';
import type { World } from '../core/ecs/World';
import type { DebugDraw } from './DebugDraw';

/** Per-frame renderer statistics. */
export interface RenderStats {
  drawCalls: number;
  /** Sprites/shapes (2D) or triangles (3D) drawn. */
  primitives: number;
  /** Instanced batches (3D). */
  batches: number;
}

/** Options shared by both renderers. */
export interface RendererOptions {
  /** World units to pixels (2D) or unused (3D). Default 32 (2D). */
  pixelsPerUnit?: number;
  /** Render at device pixel ratio for crisp output. Default true. */
  hidpi?: boolean;
  /** Snap sprites to whole pixels and disable smoothing (pixel-art). Default false. */
  pixelPerfect?: boolean;
  /** Clear colour (CSS or Color). */
  clearColor?: string;
  /** Preserve the WebGL drawing buffer (for screenshots). Default false. */
  preserveDrawingBuffer?: boolean;
}

/** Services a renderer needs from its host (a subset of the Engine). */
export interface RendererHost {
  readonly world: World;
  /** Look up a loaded asset (image, atlas, gltf...). */
  getAsset<T = unknown>(id: string): T | undefined;
  /** Report a non-fatal problem. */
  warn(message: string): void;
}

/**
 * Common contract for `Canvas2DRenderer` and `WebGLRenderer`. The Engine owns
 * one renderer and calls {@link render} once per frame in the `render` phase
 * with the fixed-step interpolation alpha.
 */
export interface Renderer {
  readonly kind: '2d' | '3d';
  readonly canvas: HTMLCanvasElement;
  /** Logical size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Device pixel ratio in use. */
  readonly pixelRatio: number;
  /** Background clear colour. */
  readonly clearColor: Color;
  /** World-space debug primitives flushed every frame. */
  readonly debug: DebugDraw;
  /** Stats from the last frame. */
  readonly stats: RenderStats;
  /** World units to pixels (2D). */
  pixelsPerUnit: number;

  /** Attach to the host. Called once by the Engine. */
  init(host: RendererHost): void;
  /** Resize the backing store. */
  resize(width: number, height: number, pixelRatio?: number): void;
  /** Draw the world using the active camera. */
  render(world: World, alpha: number): void;
  /** Canvas CSS pixel → world position (2D: on the camera plane; 3D: on the y=0 ground plane). */
  screenToWorld(sx: number, sy: number, out: Vec3): Vec3;
  /** World position → canvas CSS pixel. */
  worldToScreen(p: Vec3Like, out: Vec2): Vec2;
  /** Release GPU/DOM resources. */
  dispose(): void;
}

/** Sort key helper: layer then order, stable. */
export function compareLayerOrder(a: { layer: number; order: number }, b: { layer: number; order: number }): number {
  return a.layer - b.layer || a.order - b.order;
}
