import { Color, Rect, Vec2, Vec3 } from '../core/math';
import { Component } from '../core/ecs/Component';
import { type Entity, NULL_ENTITY } from '../core/ecs/Entity';
import { registerComponent } from '../core/ecs/Registry';

export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';
const BLEND_OPTIONS: readonly BlendMode[] = ['normal', 'add', 'multiply', 'screen'];

/** Common sorting fields for 2D renderables. */
const LAYER_FIELDS = {
  layer: { type: 'integer', description: 'Layers draw in ascending order.' },
  order: { type: 'integer', description: 'Order within a layer.' },
} as const;

/** Orthographic 2D camera. Position and rotation come from the Transform. */
export class Camera2D extends Component {
  static override readonly type = 'Camera2D';
  /** 1 = pixelsPerUnit pixels per world unit. */
  zoom = 1;
  /** Only the highest-priority active camera renders. */
  active = true;
  priority = 0;
  /** Entity to follow (NULL_ENTITY for none). */
  follow: Entity = NULL_ENTITY;
  /** 0 = snap, higher = smoother (exponential damping rate). */
  followSmoothing = 8;
  followOffset = new Vec2();
  /** Camera position is clamped inside these world bounds when width/height > 0. */
  bounds = new Rect(0, 0, 0, 0);
  backgroundColor = new Color(0.08, 0.09, 0.12, 1);
  /** Ambient light multiplier; values below white enable the lighting pass. */
  ambientLight = new Color(1, 1, 1, 1);
  /** Snap to whole pixels for pixel art. */
  pixelPerfect = false;
  /** Screen shake amplitude in world units (decays automatically). */
  shake = 0;
  shakeDecay = 5;

  /** Visible world half-extents (filled by the renderer). */
  readonly viewHalfSize = new Vec2();
}
registerComponent(Camera2D, {
  category: 'Rendering',
  description: 'Orthographic camera for 2D scenes.',
  icon: 'camera',
  fields: {
    zoom: { type: 'number', min: 0.05, max: 20, step: 0.05 },
    follow: { type: 'entity' },
    followSmoothing: { type: 'number', min: 0, max: 30 },
    priority: { type: 'integer' },
    viewHalfSize: { type: 'vec2', transient: true, hidden: true },
    shake: { type: 'number', hidden: true, transient: true },
  },
});

/** Textured quad. `texture` is an image asset id or an atlas id (with `frame`). */
export class Sprite extends Component {
  static override readonly type = 'Sprite';
  texture = '';
  /** Atlas frame name when `texture` is an atlas. */
  frame = '';
  /** Size in world units; 0 = derive from image size / pixelsPerUnit. */
  width = 0;
  height = 0;
  /** Pivot in 0..1 (0.5, 0.5 = centered). */
  pivot = new Vec2(0.5, 0.5);
  flipX = false;
  flipY = false;
  tint = new Color(1, 1, 1, 1);
  alpha = 1;
  blend: BlendMode = 'normal';
  layer = 0;
  order = 0;
  visible = true;
  /** Source rect override in pixels (used when no atlas frame). Width 0 = whole image. */
  sourceRect = new Rect(0, 0, 0, 0);
}
registerComponent(Sprite, {
  category: 'Rendering',
  description: 'Draws an image or atlas frame.',
  icon: 'image',
  fields: {
    texture: { type: 'asset', assetKind: 'image' },
    alpha: { type: 'number', min: 0, max: 1, step: 0.01 },
    blend: { type: 'enum', options: BLEND_OPTIONS },
    ...LAYER_FIELDS,
  },
});

/** Frame-based animation driving the sibling Sprite's `frame`. */
export class AnimatedSprite extends Component {
  static override readonly type = 'AnimatedSprite';
  /** Animation name from the atlas, or empty to use `frames`. */
  animation = '';
  /** Explicit frame names when not using atlas animations. */
  frames: string[] = [];
  fps = 12;
  loop = true;
  playing = true;
  /** Playback speed multiplier. */
  speed = 1;
  /** Current time within the animation (seconds). */
  time = 0;
  /** Current frame index (read-only at runtime). */
  frameIndex = 0;
  /** True once a non-looping animation finished. */
  finished = false;

  /** Switch animation, restarting from the first frame. No-op when already playing it. */
  play(name: string, restart = false): void {
    if (this.animation === name && !restart && this.playing) return;
    this.animation = name;
    this.time = 0;
    this.frameIndex = 0;
    this.finished = false;
    this.playing = true;
  }
}
registerComponent(AnimatedSprite, {
  category: 'Rendering',
  description: 'Cycles atlas frames on the Sprite.',
  icon: 'film',
  requires: ['Sprite'],
  fields: {
    fps: { type: 'number', min: 0, max: 120 },
    frames: { type: 'json' },
    time: { type: 'number', transient: true, hidden: true },
    frameIndex: { type: 'integer', readonly: true },
    finished: { type: 'boolean', transient: true, hidden: true },
  },
});

export type ShapeKind = 'rect' | 'circle' | 'polygon' | 'line' | 'ellipse';

/** Vector shape drawn with fill and/or stroke. */
export class Shape extends Component {
  static override readonly type = 'Shape';
  kind: ShapeKind = 'rect';
  width = 1;
  height = 1;
  radius = 0.5;
  /** Flat `[x0,y0,x1,y1,...]` points for polygon/line, in local units. */
  points: number[] = [];
  fill = new Color(1, 1, 1, 1);
  filled = true;
  stroke = new Color(0, 0, 0, 1);
  /** Stroke width in world units; 0 = no stroke. */
  strokeWidth = 0;
  alpha = 1;
  blend: BlendMode = 'normal';
  layer = 0;
  order = 0;
  visible = true;
}
registerComponent(Shape, {
  category: 'Rendering',
  description: 'Rectangle, circle, polygon or line.',
  icon: 'shapes',
  fields: {
    kind: { type: 'enum', options: ['rect', 'circle', 'polygon', 'line', 'ellipse'] },
    points: { type: 'json' },
    alpha: { type: 'number', min: 0, max: 1, step: 0.01 },
    blend: { type: 'enum', options: BLEND_OPTIONS },
    ...LAYER_FIELDS,
  },
});

/** World-space text label. */
export class Text extends Component {
  static override readonly type = 'Text';
  text = 'Text';
  /** Font size in world units. */
  size = 0.5;
  font = 'system-ui, sans-serif';
  bold = false;
  color = new Color(1, 1, 1, 1);
  align: 'left' | 'center' | 'right' = 'center';
  baseline: 'top' | 'middle' | 'bottom' = 'middle';
  outline = new Color(0, 0, 0, 1);
  /** Outline width in world units; 0 = none. */
  outlineWidth = 0;
  /** Wrap width in world units; 0 = no wrap. */
  maxWidth = 0;
  alpha = 1;
  layer = 10;
  order = 0;
  visible = true;
  /** Draw in screen space (position = pixels from top-left) instead of world space. */
  screenSpace = false;
}
registerComponent(Text, {
  category: 'Rendering',
  description: 'Text label in world or screen space.',
  icon: 'type',
  fields: {
    align: { type: 'enum', options: ['left', 'center', 'right'] },
    baseline: { type: 'enum', options: ['top', 'middle', 'bottom'] },
    alpha: { type: 'number', min: 0, max: 1, step: 0.01 },
    ...LAYER_FIELDS,
  },
});

/** Grid of tiles from a tileset image. Tile index 0 is empty; indices are 1-based. */
export class Tilemap extends Component {
  static override readonly type = 'Tilemap';
  /** Tileset image asset id. */
  tileset = '';
  /** Tile size in the tileset image, pixels. */
  tileWidth = 16;
  tileHeight = 16;
  /** Tiles per row in the tileset image (0 = derive from image width). */
  columns = 0;
  /** Map size in tiles. */
  width = 16;
  height = 16;
  /** Tile size in world units. */
  tileSize = 1;
  /** Row-major tile indices, row 0 at the top (drawn downward from the origin). */
  data: number[] = [];
  /** Tile indices treated as solid by the physics tilemap collider helper. Empty = all non-zero. */
  solid: number[] = [];
  alpha = 1;
  layer = -10;
  order = 0;
  visible = true;

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x] ?? 0;
  }

  set(x: number, y: number, tile: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    if (this.data.length < this.width * this.height) this.data.length = this.width * this.height;
    this.data[y * this.width + x] = tile;
  }

  isSolid(x: number, y: number): boolean {
    const t = this.get(x, y);
    if (t === 0) return false;
    return this.solid.length === 0 || this.solid.includes(t);
  }
}
registerComponent(Tilemap, {
  category: 'Rendering',
  description: 'Tile grid drawn from a tileset image.',
  icon: 'grid',
  fields: {
    tileset: { type: 'asset', assetKind: 'image' },
    data: { type: 'json', hidden: true },
    solid: { type: 'json' },
    ...LAYER_FIELDS,
  },
});

/** Pooled particle record (renderer-internal but exposed for custom systems). */
export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; rotation: number; spin: number; seed: number;
}

/** CPU particle emitter with an internal pool. */
export class ParticleEmitter extends Component {
  static override readonly type = 'ParticleEmitter';
  emitting = true;
  /** Particles per second. */
  rate = 20;
  maxParticles = 200;
  lifetime = 1;
  lifetimeVariation = 0.3;
  speed = 3;
  speedVariation = 1;
  /** Emission direction in radians and half-angle spread. */
  angle = Math.PI / 2;
  spread = Math.PI / 6;
  gravity = new Vec2(0, -3);
  /** Emission area half-size (0 = point). */
  areaSize = new Vec2();
  startSize = 0.3;
  endSize = 0;
  sizeVariation = 0.1;
  startColor = new Color(1, 0.8, 0.3, 1);
  endColor = new Color(1, 0.2, 0, 0);
  /** Optional image asset; empty draws soft circles. */
  texture = '';
  blend: BlendMode = 'add';
  spin = 0;
  drag = 0;
  /** Emit in world space (particles are not moved by the emitter afterwards). */
  worldSpace = true;
  layer = 5;
  order = 0;
  visible = true;

  /** Live particles (runtime). */
  readonly particles: Particle[] = [];
  /** @internal */
  _pool: Particle[] = [];
  /** @internal accumulated emission */
  _accum = 0;
  /** @internal one-shot burst request */
  _burst = 0;

  /** Emit `count` particles immediately on the next update. */
  burst(count: number): void {
    this._burst += count;
  }

  /** Remove all live particles. */
  clear(): void {
    for (const p of this.particles) this._pool.push(p);
    this.particles.length = 0;
  }
}
registerComponent(ParticleEmitter, {
  category: 'Rendering',
  description: 'CPU particle system.',
  icon: 'sparkles',
  fields: {
    texture: { type: 'asset', assetKind: 'image' },
    blend: { type: 'enum', options: BLEND_OPTIONS },
    angle: { type: 'number', min: -Math.PI, max: Math.PI, step: 0.01 },
    spread: { type: 'number', min: 0, max: Math.PI, step: 0.01 },
    particles: { type: 'json', transient: true, hidden: true },
    ...LAYER_FIELDS,
  },
});

/** Point light for the 2D lighting pass (drawn additively into the light map). */
export class Light2D extends Component {
  static override readonly type = 'Light2D';
  color = new Color(1, 0.9, 0.7, 1);
  intensity = 1;
  radius = 5;
  /** 0..1 fraction of the radius that is fully lit. */
  falloff = 0.2;
  enabled = true;
}
registerComponent(Light2D, {
  category: 'Rendering',
  description: 'Radial light for 2D scenes.',
  icon: 'sun',
  fields: { intensity: { type: 'number', min: 0, max: 5, step: 0.05 }, falloff: { type: 'number', min: 0, max: 1, step: 0.01 } },
});

// ----------------------------------------------------------------------- 3D

/** Material parameters for the WebGL renderer. */
export interface MaterialData {
  color: Color;
  metallic: number;
  roughness: number;
  emissive: Color;
  /** Image asset id for the base colour texture. */
  texture: string;
  unlit: boolean;
  wireframe: boolean;
  doubleSided: boolean;
  opacity: number;
}

/** Renders a mesh (built-in primitive or GLTF mesh) with a material. */
export class MeshRenderer extends Component {
  static override readonly type = 'MeshRenderer';
  /** `cube`, `sphere`, `plane`, `cylinder`, or `gltf:<assetId>[#meshIndex]`. */
  mesh = 'cube';
  color = new Color(0.8, 0.8, 0.85, 1);
  metallic = 0;
  roughness = 0.6;
  emissive = new Color(0, 0, 0, 1);
  texture = '';
  unlit = false;
  wireframe = false;
  doubleSided = false;
  opacity = 1;
  visible = true;
  /** Entities with the same mesh+material are drawn in one instanced call. */
  instanced = true;
}
registerComponent(MeshRenderer, {
  category: 'Rendering 3D',
  description: 'Draws a 3D mesh.',
  icon: 'box',
  fields: {
    mesh: { type: 'string', description: 'cube | sphere | plane | cylinder | gltf:<asset>#<index>' },
    texture: { type: 'asset', assetKind: 'image' },
    metallic: { type: 'number', min: 0, max: 1, step: 0.01 },
    roughness: { type: 'number', min: 0, max: 1, step: 0.01 },
    opacity: { type: 'number', min: 0, max: 1, step: 0.01 },
  },
});

/** Perspective or orthographic 3D camera; looks down its Transform's -Z. */
export class Camera3D extends Component {
  static override readonly type = 'Camera3D';
  fov = 60;
  near = 0.1;
  far = 500;
  orthographic = false;
  /** Half height of the view in world units when orthographic. */
  orthoSize = 10;
  active = true;
  priority = 0;
  clearColor = new Color(0.1, 0.11, 0.14, 1);
  /** Sky gradient (drawn behind everything). */
  skyTop = new Color(0.25, 0.4, 0.7, 1);
  skyBottom = new Color(0.8, 0.85, 0.9, 1);
  skybox = true;
  fogEnabled = false;
  fogColor = new Color(0.8, 0.85, 0.9, 1);
  fogNear = 20;
  fogFar = 100;
  /** Optional entity to look at every frame. */
  lookAt: Entity = NULL_ENTITY;
}
registerComponent(Camera3D, {
  category: 'Rendering 3D',
  description: 'Perspective/orthographic camera.',
  icon: 'camera',
  fields: { fov: { type: 'number', min: 10, max: 150 }, lookAt: { type: 'entity' } },
});

export type LightType = 'directional' | 'point' | 'ambient';

/** Light source for the 3D renderer. Direction is the Transform's forward (-Z). */
export class Light extends Component {
  static override readonly type = 'Light';
  kind: LightType = 'directional';
  color = new Color(1, 1, 1, 1);
  intensity = 1;
  /** Point light range in world units. */
  range = 10;
  enabled = true;
}
registerComponent(Light, {
  category: 'Rendering 3D',
  description: 'Directional, point or ambient light.',
  icon: 'sun',
  fields: { kind: { type: 'enum', options: ['directional', 'point', 'ambient'] }, intensity: { type: 'number', min: 0, max: 10, step: 0.05 } },
});

/** Helper: default orbit camera controller parameters (used by `OrbitController`). */
export const DEFAULT_ORBIT_TARGET: Readonly<Vec3> = Object.freeze(new Vec3(0, 0, 0));
