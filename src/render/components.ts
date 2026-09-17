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
  /** Multiplier for `emissive`; values above 1 glow through bloom. */
  emissiveStrength: number;
  /** Image asset id for the base colour texture. */
  texture: string;
  unlit: boolean;
  /** Apply camera/sky fog to unlit materials. */
  unlitFog: boolean;
  wireframe: boolean;
  doubleSided: boolean;
  opacity: number;
  /** Multiply the material colour by the mesh's per-vertex colours when it has any. */
  vertexColors: boolean;
  /** Shade with per-face normals computed from screen-space derivatives (low-poly look). */
  flatShading: boolean;
  /** Vertex sway amplitude (world units at unit height) driven by the renderer wind. 0 = rigid. */
  windStrength: number;
}

/** Level-of-detail entry: use `mesh` once the camera is at least `distance` away. */
export interface LodLevel {
  mesh: string;
  distance: number;
}

/** Renders a mesh (built-in primitive or GLTF mesh) with a material. */
export class MeshRenderer extends Component implements MaterialData {
  static override readonly type = 'MeshRenderer';
  /** `cube`, `sphere`, `plane`, `cylinder`, `cone`, a mesh registered with `renderer.addMesh`, or `gltf:<assetId>[#meshIndex]`. */
  mesh = 'cube';
  color = new Color(0.8, 0.8, 0.85, 1);
  metallic = 0;
  roughness = 0.6;
  emissive = new Color(0, 0, 0, 1);
  emissiveStrength = 1;
  texture = '';
  unlit = false;
  unlitFog = true;
  wireframe = false;
  doubleSided = false;
  opacity = 1;
  visible = true;
  /** Entities with the same mesh+material are drawn in one instanced call. */
  instanced = true;
  vertexColors = true;
  flatShading = false;
  windStrength = 0;
  /** Write into the directional shadow map. */
  castShadow = true;
  /** Sample the shadow map when lit. */
  receiveShadow = true;
  /** Skip drawing when the mesh bounds are outside the camera frustum. */
  frustumCulled = true;
  /**
   * Optional LOD chain, sorted by ascending `distance`. `mesh` is used within
   * the first distance; the last level whose distance is below the camera
   * distance wins. Use an empty string to hide the mesh beyond a distance.
   */
  lods: LodLevel[] = [];
}
registerComponent(MeshRenderer, {
  category: 'Rendering 3D',
  description: 'Draws a 3D mesh.',
  icon: 'box',
  fields: {
    mesh: { type: 'string', description: 'cube | sphere | plane | cylinder | cone | <registered> | gltf:<asset>#<index>' },
    texture: { type: 'asset', assetKind: 'image' },
    metallic: { type: 'number', min: 0, max: 1, step: 0.01 },
    roughness: { type: 'number', min: 0, max: 1, step: 0.01 },
    opacity: { type: 'number', min: 0, max: 1, step: 0.01 },
    emissiveStrength: { type: 'number', min: 0, max: 20, step: 0.1 },
    windStrength: { type: 'number', min: 0, max: 2, step: 0.01 },
    lods: { type: 'json', description: '[{ mesh, distance }]' },
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
  /** Sky gradient (drawn behind everything) when no `SkySettings` component is present. */
  skyTop = new Color(0.25, 0.4, 0.7, 1);
  skyBottom = new Color(0.8, 0.85, 0.9, 1);
  skybox = true;
  /** Linear distance fog (ignored when a `SkySettings` component provides atmospheric fog). */
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
  /** Directional only: render a shadow map from this light. */
  castShadows = false;
  /** Directional only: shadows cover the camera view up to this distance (world units). */
  shadowDistance = 60;
  /** Depth bias in world units (raise to fight acne, lower to fight peter-panning). */
  shadowBias = 0.05;
  /** Offset receivers along their normal, in shadow texels. */
  shadowNormalBias = 1.5;
  /** PCF kernel radius in texels (0 = hard shadows). */
  shadowSoftness = 1;
}
registerComponent(Light, {
  category: 'Rendering 3D',
  description: 'Directional, point or ambient light.',
  icon: 'sun',
  fields: {
    kind: { type: 'enum', options: ['directional', 'point', 'ambient'] },
    intensity: { type: 'number', min: 0, max: 10, step: 0.05 },
    shadowDistance: { type: 'number', min: 1, max: 1000 },
    shadowBias: { type: 'number', min: 0, max: 1, step: 0.005 },
    shadowNormalBias: { type: 'number', min: 0, max: 10, step: 0.1 },
    shadowSoftness: { type: 'number', min: 0, max: 4, step: 0.25 },
  },
});

export type SkyMode = 'gradient' | 'procedural';

/**
 * Scene-wide sky and atmosphere. Add one to any entity: the renderer uses the
 * first enabled instance. In `procedural` mode the sun position comes from
 * `timeOfDay`, and with `driveLight` the directional light's colour and
 * direction, the hemisphere ambient and the fog colour follow it.
 */
export class SkySettings extends Component {
  static override readonly type = 'SkySettings';
  enabled = true;
  mode: SkyMode = 'procedural';
  /** Hours, 0..24 (6 = sunrise, 12 = noon, 18 = sunset). */
  timeOfDay = 17.5;
  /** Compass heading of the sun at noon, degrees (0 = +Z, 90 = +X). */
  sunAzimuth = 35;
  /** Fraction of 90 degrees the sun reaches at noon. */
  sunElevationScale = 0.8;
  /** Haze: 0 = crisp, 1 = milky horizon. */
  turbidity = 0.35;
  /** Angular size of the sun disc, degrees. */
  sunSize = 2.5;
  /** Glow around the sun (0 = none). */
  sunGlow = 1;
  /** Stars at night (0 = none). */
  stars = 1;
  /** Cloud band coverage (0 = clear). */
  clouds = 0.35;
  cloudSpeed = 1;
  cloudHeight = 0.35;
  /** Overall brightness multiplier for sky colours. */
  exposure = 1;
  /** Tint applied to the computed sky palette (white = none). */
  tint = new Color(1, 1, 1, 1);
  /** Drive the directional light (direction, colour), ambient and fog from the sun. */
  driveLight = true;
  /** Directional light intensity at noon when `driveLight` is on. */
  sunIntensity = 1.2;
  /** Faint bluish fill from the moon at night. */
  moonIntensity = 0.12;
  /** Hemisphere ambient strength. */
  ambientIntensity = 1;
  /** Atmospheric fog (exponential distance + height). */
  fogEnabled = true;
  fogDensity = 0.012;
  fogStart = 10;
  /** Height above `fogHeight` at which fog thins (1/e per unit * falloff). */
  fogHeightFalloff = 0.08;
  fogHeight = 0;
  /** Extra fog colour blend toward the sun colour when looking at it. */
  fogSunBlend = 0.6;
}
registerComponent(SkySettings, {
  category: 'Rendering 3D',
  description: 'Procedural sky, sun, ambient and fog.',
  icon: 'sun',
  fields: {
    mode: { type: 'enum', options: ['gradient', 'procedural'] },
    timeOfDay: { type: 'number', min: 0, max: 24, step: 0.05 },
    sunAzimuth: { type: 'number', min: -180, max: 180 },
    sunElevationScale: { type: 'number', min: 0.1, max: 1, step: 0.01 },
    turbidity: { type: 'number', min: 0, max: 1, step: 0.01 },
    sunSize: { type: 'number', min: 0, max: 20, step: 0.1 },
    sunGlow: { type: 'number', min: 0, max: 3, step: 0.05 },
    stars: { type: 'number', min: 0, max: 2, step: 0.05 },
    clouds: { type: 'number', min: 0, max: 1, step: 0.01 },
    exposure: { type: 'number', min: 0, max: 4, step: 0.05 },
    fogDensity: { type: 'number', min: 0, max: 0.2, step: 0.001 },
    fogHeightFalloff: { type: 'number', min: 0, max: 2, step: 0.005 },
  },
});

export type TonemapMode = 'none' | 'aces' | 'reinhard';

/**
 * Post-processing configuration. Add one to any entity to enable the HDR
 * pipeline (bloom, tonemapping, grading, vignette, FXAA); the renderer copies
 * the first enabled instance into `renderer.post` every frame.
 */
export class PostProcessSettings extends Component {
  static override readonly type = 'PostProcessSettings';
  enabled = true;
  /** Render to a half-float target when the GPU supports it. */
  hdr = true;
  /** MSAA samples for the scene target (0/1 = off). */
  msaa = 4;
  bloom = true;
  /** Scene luminance above which bloom starts. */
  bloomThreshold = 1;
  bloomSoftKnee = 0.5;
  bloomIntensity = 0.5;
  /** Blur spread multiplier. */
  bloomRadius = 1;
  exposure = 1;
  tonemap: TonemapMode = 'aces';
  saturation = 1.05;
  contrast = 1.05;
  /** Lift/gamma/gain grading (neutral: lift 0, gamma 1, gain 1). */
  lift = new Color(0, 0, 0, 1);
  gamma = new Color(1, 1, 1, 1);
  gain = new Color(1, 1, 1, 1);
  vignette = 0.3;
  vignetteSmoothness = 0.6;
  fxaa = true;
  /** Radial colour fringing at the edges (0 = off, 1 = strong). */
  chromaticAberration = 0.15;
}
registerComponent(PostProcessSettings, {
  category: 'Rendering 3D',
  description: 'Bloom, tonemapping, colour grading, vignette and FXAA.',
  icon: 'sparkles',
  fields: {
    msaa: { type: 'integer', min: 0, max: 8 },
    tonemap: { type: 'enum', options: ['none', 'aces', 'reinhard'] },
    bloomThreshold: { type: 'number', min: 0, max: 5, step: 0.05 },
    bloomSoftKnee: { type: 'number', min: 0, max: 1, step: 0.01 },
    bloomIntensity: { type: 'number', min: 0, max: 3, step: 0.05 },
    bloomRadius: { type: 'number', min: 0.25, max: 3, step: 0.05 },
    exposure: { type: 'number', min: 0, max: 5, step: 0.05 },
    saturation: { type: 'number', min: 0, max: 2, step: 0.01 },
    contrast: { type: 'number', min: 0, max: 2, step: 0.01 },
    vignette: { type: 'number', min: 0, max: 1, step: 0.01 },
    vignetteSmoothness: { type: 'number', min: 0.01, max: 1, step: 0.01 },
    chromaticAberration: { type: 'number', min: 0, max: 1, step: 0.01 },
  },
});

/**
 * Stylised water surface. Attach next to a `MeshRenderer` (typically a
 * subdivided plane); the renderer then draws that mesh with the water shader:
 * world-space sum-of-sines waves, two-tone colour by wave height, fresnel rim,
 * sun glint and animated foam. Foam appears on wave crests and where the
 * mesh's vertex colour red channel marks shore proximity (bake 1 near the
 * shore, 0 in deep water). For shaped (non-flat) water meshes such as rivers,
 * set `foamWidth` > 0 to also foam where the rest height of the surface is
 * within `foamWidth` of `shorelineHeight`.
 */
export class WaterMaterial extends Component {
  static override readonly type = 'WaterMaterial';
  deepColor = new Color(0.05, 0.28, 0.45, 1);
  shallowColor = new Color(0.2, 0.62, 0.7, 1);
  foamColor = new Color(0.95, 0.98, 1, 1);
  /** Vertical wave amplitude, world units. */
  waveAmplitude = 0.18;
  /** Wavelength of the largest wave, world units. */
  waveLength = 6;
  waveSpeed = 1;
  /** Horizontal sharpening of crests (0 = pure sine). */
  waveSteepness = 0.25;
  /** Direction of the primary wave in the XZ plane, degrees. */
  waveDirection = 20;
  /** Rest height around which shaped water meshes get a foam band (see class docs). */
  shorelineHeight = 0;
  /** Half-width of that band in world units; 0 disables it (default). */
  foamWidth = 0;
  /** Crest foam threshold (0..1 of amplitude; 1 = none). */
  crestFoam = 0.75;
  /** Reflection-like rim toward the horizon colour. */
  fresnel = 0.45;
  specular = 0.8;
  opacity = 0.85;
  flatShading = true;
}
registerComponent(WaterMaterial, {
  category: 'Rendering 3D',
  description: 'Animated stylised water for the sibling MeshRenderer.',
  icon: 'waves',
  requires: ['MeshRenderer'],
  fields: {
    waveAmplitude: { type: 'number', min: 0, max: 5, step: 0.01 },
    waveLength: { type: 'number', min: 0.1, max: 200 },
    waveSpeed: { type: 'number', min: 0, max: 10, step: 0.05 },
    waveSteepness: { type: 'number', min: 0, max: 1, step: 0.01 },
    waveDirection: { type: 'number', min: -180, max: 180 },
    foamWidth: { type: 'number', min: 0, max: 10, step: 0.05 },
    crestFoam: { type: 'number', min: 0, max: 1, step: 0.01 },
    fresnel: { type: 'number', min: 0, max: 1, step: 0.01 },
    specular: { type: 'number', min: 0, max: 3, step: 0.05 },
    opacity: { type: 'number', min: 0, max: 1, step: 0.01 },
  },
});

/** Helper: default orbit camera controller parameters (used by `OrbitController`). */
export const DEFAULT_ORBIT_TARGET: Readonly<Vec3> = Object.freeze(new Vec3(0, 0, 0));
