/**
 * Built-in smoke scenes used by `play.html` when no project is given. They
 * exercise the 2D renderer + physics + scripting, and the WebGL renderer.
 * Not shipped as demos; the demos worker owns `public/demos/`.
 */
import { createEmptyScene, type SceneData } from '../core/ecs/Scene';
import type { ScriptSource } from '../scripting/types';
import { computeBounds, computeNormals, type MeshData } from '../render/webgl/Mesh';

export const smokeScripts: ScriptSource[] = [
  {
    name: 'PlayerController',
    source: `
defineScript({
  name: 'PlayerController',
  props: { speed: { type: 'number', default: 6 }, jump: { type: 'number', default: 11 } },
  onStart(ctx) {
    const cc = ctx.get('CharacterController2D');
    cc.moveSpeed = ctx.props.speed;
    cc.jumpSpeed = ctx.props.jump;
  },
  onOwnerInput(ctx, snap) {
    const cc = ctx.get('CharacterController2D');
    cc.move(snap.axes.moveX || 0);
    if (snap.pressed.includes('jump')) cc.jump();
    if (snap.released.includes('jump')) cc.jumpReleased();
    const sprite = ctx.get('Shape');
    if (sprite) sprite.fill.setHex(cc.grounded ? '#4cc2ff' : '#ff7a3d');
  },
  onCollisionEnter(ctx, other, info) {
    if (info.impulse > 8) { const cam = ctx.getOn(ctx.find('Camera'), 'Camera2D'); if (cam) cam.shake = 0.15; }
  },
});`,
  },
  {
    name: 'Spinner',
    source: `
defineScript({
  name: 'Spinner',
  props: { speed: { type: 'number', default: 1 } },
  onUpdate(ctx, dt) {
    const t = ctx.transform;
    t.setEuler(ctx.time.elapsed * 0.4 * ctx.props.speed, ctx.time.elapsed * ctx.props.speed, 0);
    t.position.y = 1 + Math.sin(ctx.time.elapsed * 1.5) * 0.3;
    t.markDirty();
  },
});`,
  },
  {
    name: 'Orbit',
    source: `
defineScript({
  name: 'Orbit',
  props: { distance: { type: 'number', default: 9 }, yaw: { type: 'number', default: 0.7 }, pitch: { type: 'number', default: 0.45 }, autoRotate: { type: 'boolean', default: true }, maxDistance: { type: 'number', default: 40 } },
  onStart(ctx) { ctx.state.yaw = ctx.props.yaw; ctx.state.pitch = ctx.props.pitch; ctx.state.dist = ctx.props.distance; },
  onUpdate(ctx, dt) {
    const m = ctx.input.mouse; const s = ctx.state;
    if (m.held(0)) { s.yaw -= m.delta.x * 0.005; s.pitch = ctx.math.clamp(s.pitch + m.delta.y * 0.005, 0.05, 1.5); }
    if (m.wheel) s.dist = ctx.math.clamp(s.dist * (1 + Math.sign(m.wheel) * 0.1), 3, ctx.props.maxDistance);
    if (!m.held(0) && ctx.props.autoRotate) s.yaw += dt * 0.15;
    const cp = Math.cos(s.pitch);
    ctx.transform.setPosition(Math.sin(s.yaw) * cp * s.dist, Math.sin(s.pitch) * s.dist, Math.cos(s.yaw) * cp * s.dist);
  },
});`,
  },
  {
    name: 'DayCycle',
    source: `
defineScript({
  name: 'DayCycle',
  props: { speed: { type: 'number', default: 0 } },
  onUpdate(ctx, dt) {
    if (!ctx.props.speed) return;
    const sky = ctx.get('SkySettings');
    if (sky) sky.timeOfDay = (sky.timeOfDay + dt * ctx.props.speed) % 24;
  },
});`,
  },
  {
    name: 'Bob',
    source: `
defineScript({
  name: 'Bob',
  props: { amplitude: { type: 'number', default: 0.3 }, speed: { type: 'number', default: 1 }, spin: { type: 'number', default: 0.6 } },
  onStart(ctx) { ctx.state.y = ctx.transform.position.y; ctx.state.phase = ctx.transform.position.x * 0.7; },
  onUpdate(ctx, dt) {
    const t = ctx.transform;
    t.position.y = ctx.state.y + Math.sin(ctx.time.elapsed * ctx.props.speed + ctx.state.phase) * ctx.props.amplitude;
    t.setEuler(0, ctx.time.elapsed * ctx.props.spin, 0);
    t.markDirty();
  },
});`,
  },
  {
    name: 'Bouncer',
    source: `
defineScript({
  name: 'Bouncer',
  onCollisionEnter(ctx, other, info) {
    if (info.impulse > 6) {
      const em = ctx.get('ParticleEmitter');
      if (em) em.burst(12);
    }
  },
});`,
  },
];

let nextId = 1;
function entity(name: string, components: Record<string, Record<string, unknown>>, parent?: number) {
  const e = { id: nextId++, name, parent, components: Object.entries(components).map(([type, data]) => ({ type, data })) };
  if (parent === undefined) delete (e as { parent?: number }).parent;
  return e;
}

export function smokeScene2D(): SceneData {
  nextId = 1;
  const scene = createEmptyScene('Smoke2D');
  scene.settings = { gravity: { x: 0, y: -24 } };
  const camera = entity('Camera', {
    Transform: { position: { x: 0, y: 2, z: 0 } },
    Camera2D: { zoom: 0.9, followSmoothing: 5, followOffset: { x: 0, y: 1.5 }, backgroundColor: { r: 0.07, g: 0.08, b: 0.12, a: 1 }, ambientLight: { r: 0.55, g: 0.55, b: 0.65, a: 1 } },
    AudioListener: {},
  });
  scene.entities.push(camera);
  scene.entities.push(entity('Ground', {
    Transform: { position: { x: 0, y: -1, z: 0 } },
    RigidBody2D: { bodyType: 'static', friction: 0.8 },
    BoxCollider2D: { width: 40, height: 2 },
    Shape: { kind: 'rect', width: 40, height: 2, fill: { r: 0.22, g: 0.25, b: 0.33, a: 1 }, layer: -5 },
  }));
  for (let i = 0; i < 4; i++) {
    scene.entities.push(entity(`Platform${i}`, {
      Transform: { position: { x: -8 + i * 5.5, y: 1.5 + (i % 2) * 2, z: 0 } },
      RigidBody2D: { bodyType: 'static' },
      BoxCollider2D: { width: 3, height: 0.5 },
      Shape: { kind: 'rect', width: 3, height: 0.5, fill: { r: 0.3, g: 0.35, b: 0.45, a: 1 }, layer: -4 },
    }));
  }
  const player = entity('Player', {
    Transform: { position: { x: -4, y: 1, z: 0 } },
    RigidBody2D: { fixedRotation: true, friction: 0.2, restitution: 0 },
    BoxCollider2D: { width: 0.8, height: 1.4 },
    CharacterController2D: {},
    Shape: { kind: 'rect', width: 0.8, height: 1.4, fill: { r: 0.3, g: 0.76, b: 1, a: 1 }, layer: 1 },
    PlayerInput: { owner: 'local' },
    Script: { script: 'PlayerController', props: { speed: 7, jump: 12 } },
    Light2D: { radius: 6, intensity: 1.2, color: { r: 1, g: 0.95, b: 0.8, a: 1 } },
    Tag: { tags: ['player'] },
  });
  scene.entities.push(player);
  scene.entities.push(entity('Label', {
    Transform: { position: { x: 0, y: 5.5, z: 0 } },
    Text: { text: 'Forge Engine · 2D smoke test', size: 0.6, color: { r: 1, g: 1, b: 1, a: 0.9 }, outlineWidth: 0.04 },
  }));
  const colors = ['#ff7a3d', '#8b7dff', '#4cc2ff', '#ffd166', '#06d6a0', '#ef476f'];
  for (let i = 0; i < 14; i++) {
    const c = colors[i % colors.length];
    const r = parseInt(c.slice(1, 3), 16) / 255, g = parseInt(c.slice(3, 5), 16) / 255, b = parseInt(c.slice(5, 7), 16) / 255;
    const isBall = i % 2 === 0;
    scene.entities.push(entity(`Bouncer${i}`, {
      Transform: { position: { x: -6 + i * 0.95, y: 6 + (i % 3) * 1.5, z: 0 }, rotation: { x: 0, y: 0, z: Math.sin(i * 0.3), w: Math.cos(i * 0.3) } },
      RigidBody2D: { restitution: isBall ? 0.75 : 0.2, friction: 0.5, velocity: { x: (i % 3) - 1, y: 0 } },
      ...(isBall ? { CircleCollider2D: { radius: 0.35 } } : { BoxCollider2D: { width: 0.7, height: 0.7 } }),
      Shape: isBall ? { kind: 'circle', radius: 0.35, fill: { r, g, b, a: 1 } } : { kind: 'rect', width: 0.7, height: 0.7, fill: { r, g, b, a: 1 } },
      ParticleEmitter: { emitting: false, rate: 0, maxParticles: 60, lifetime: 0.5, speed: 3, spread: Math.PI, startSize: 0.15, endSize: 0, startColor: { r, g, b, a: 1 }, endColor: { r, g, b, a: 0 }, gravity: { x: 0, y: -5 } },
      Script: { script: 'Bouncer', props: {} },
    }));
  }
  scene.entities.push(entity('Embers', {
    Transform: { position: { x: 6, y: 0.2, z: 0 } },
    ParticleEmitter: { rate: 25, lifetime: 1.6, speed: 2, spread: 0.4, startSize: 0.25, endSize: 0.02, gravity: { x: 0, y: 1.5 }, startColor: { r: 1, g: 0.6, b: 0.2, a: 0.9 }, endColor: { r: 1, g: 0.1, b: 0, a: 0 } },
    Light2D: { radius: 4, intensity: 0.9, color: { r: 1, g: 0.5, b: 0.2, a: 1 } },
  }));
  // Camera follows the player.
  (camera.components[1].data as { follow: number }).follow = player.id;
  return scene;
}

export function smokeScene3D(): SceneData {
  nextId = 1;
  const scene = createEmptyScene('Smoke3D');
  scene.entities.push(entity('Camera', {
    Transform: { position: { x: 6, y: 4, z: 7 } },
    Camera3D: { fov: 55, fogEnabled: true, fogNear: 15, fogFar: 45, fogColor: { r: 0.8, g: 0.85, b: 0.9, a: 1 }, lookAt: 3 },
    Script: { script: 'Orbit', props: { distance: 10 } },
    AudioListener: {},
  }));
  scene.entities.push(entity('Sun', {
    Transform: { position: { x: 5, y: 10, z: 5 }, rotation: { x: -0.4, y: 0.35, z: 0.15, w: 0.83 } },
    Light: { kind: 'directional', intensity: 1.1, color: { r: 1, g: 0.96, b: 0.9, a: 1 } },
  }));
  scene.entities.push(entity('Cube', {
    Transform: { position: { x: 0, y: 1, z: 0 } },
    MeshRenderer: { mesh: 'cube', color: { r: 1, g: 0.48, b: 0.24, a: 1 }, roughness: 0.35, metallic: 0.2 },
    Script: { script: 'Spinner', props: { speed: 1 } },
  }));
  scene.entities.push(entity('Ambient', { Transform: {}, Light: { kind: 'ambient', intensity: 0.25, color: { r: 0.6, g: 0.7, b: 1, a: 1 } } }));
  scene.entities.push(entity('Ground', {
    Transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 30, y: 1, z: 30 } },
    MeshRenderer: { mesh: 'plane', color: { r: 0.3, g: 0.36, b: 0.3, a: 1 }, roughness: 0.9 },
  }));
  scene.entities.push(entity('Lamp', {
    Transform: { position: { x: -2.5, y: 1.5, z: 1.5 } },
    Light: { kind: 'point', intensity: 2.5, range: 8, color: { r: 0.4, g: 0.7, b: 1, a: 1 } },
    MeshRenderer: { mesh: 'sphere', color: { r: 0.4, g: 0.7, b: 1, a: 1 }, emissive: { r: 0.4, g: 0.7, b: 1, a: 1 }, unlit: true },
  }));
  const ring = 9;
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2;
    scene.entities.push(entity(`Pillar${i}`, {
      Transform: { position: { x: Math.cos(a) * 5, y: 0.75 + (i % 3) * 0.25, z: Math.sin(a) * 5 }, scale: { x: 0.6, y: 1.5 + (i % 3) * 0.5, z: 0.6 } },
      MeshRenderer: { mesh: i % 2 ? 'cylinder' : 'cube', color: { r: 0.55 + (i % 3) * 0.1, g: 0.5, b: 0.85 - (i % 3) * 0.1, a: 1 }, roughness: 0.5 },
    }));
  }
  scene.entities.push(entity('Wire', {
    Transform: { position: { x: 0, y: 1, z: 0 }, scale: { x: 3, y: 3, z: 3 } },
    MeshRenderer: { mesh: 'sphere', color: { r: 1, g: 1, b: 1, a: 0.4 }, wireframe: true, unlit: true },
  }));
  return scene;
}

// ------------------------------------------------------------------ showcase

/** Deterministic hash → 0..1. */
function hash(x: number, y: number, z = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647 ^ 0x5bd1e995)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 2D. */
function noise2(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export const SHOWCASE_WATER_LEVEL = 0.35;
const SHOWCASE_SIZE = 90;

/** Terrain height for the showcase island (used for the mesh and for placing props). */
export function showcaseTerrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z) / (SHOWCASE_SIZE * 0.5);
  const island = Math.max(0, 1 - r * r * 1.15);
  let h = noise2(x * 0.045 + 10, z * 0.045 + 10) * 6 + noise2(x * 0.12 + 3, z * 0.12 + 7) * 1.6 + noise2(x * 0.3, z * 0.3) * 0.35;
  h = (h - 2.2) * island * 1.6 + island * 2.2 - 1.4;
  // A pond near the centre and a flat camp spot.
  const pond = Math.exp(-((x - 4) * (x - 4) + (z + 3) * (z + 3)) / 60);
  h -= pond * 3;
  const camp = Math.exp(-((x + 9) * (x + 9) + (z - 5) * (z - 5)) / 28);
  h = h * (1 - camp) + 1.35 * camp;
  return h;
}

/** Builder for unwelded flat-shaded triangles with a colour per face. */
class FlatMeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];

  tri(a: number[], b: number[], c: number[], color: number[]): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.col.push(color[0], color[1], color[2]);
  }

  quad(a: number[], b: number[], c: number[], d: number[], color: number[]): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Cone/frustum ring between two heights with `segments` sides. */
  ring(y0: number, r0: number, y1: number, r1: number, segments: number, color: (i: number) => number[], cx = 0, cz = 0): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      const p00 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], p01 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const p10 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], p11 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      const c = color(i);
      if (r1 < 1e-4) this.tri(p00, p10, p01, c);
      else if (r0 < 1e-4) this.tri(p00, p11, p01, c);
      else this.quad(p00, p10, p11, p01, c);
    }
  }

  build(name: string): MeshData {
    const positions = new Float32Array(this.pos);
    const n = positions.length / 3;
    const indices = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;
    return { name, positions, colors: new Float32Array(this.col), normals: computeNormals(positions, indices), indices, bounds: computeBounds(positions) };
  }
}

function rgb(hex: string): number[] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

function vary(c: number[], amount: number, seed: number): number[] {
  const k = 1 + (hash(seed, 17) - 0.5) * amount;
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

function mixc(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Meshes used by {@link smokeSceneShowcase}; register them with `renderer.addMesh`. */
export function showcaseMeshes(): Record<string, MeshData> {
  const out: Record<string, MeshData> = {};
  // Terrain: flat-shaded grid with height-based palette.
  const segs = 72, size = SHOWCASE_SIZE;
  const terrain = new FlatMeshBuilder();
  const sand = rgb('#d8c48f'), grass = rgb('#6fae4c'), grassDark = rgb('#4f8a3a'), rock = rgb('#8a8378'), snow = rgb('#f2f4f7'), mud = rgb('#5d5140');
  const hAt = (i: number, j: number) => {
    const x = (i / segs - 0.5) * size, z = (j / segs - 0.5) * size;
    return [x, showcaseTerrainHeight(x, z), z];
  };
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      const a = hAt(i, j), b = hAt(i + 1, j), c = hAt(i + 1, j + 1), d = hAt(i, j + 1);
      const colorFor = (p: number[][], seed: number) => {
        const y = (p[0][1] + p[1][1] + p[2][1]) / 3;
        const slope = Math.max(Math.abs(p[0][1] - p[1][1]), Math.abs(p[1][1] - p[2][1]), Math.abs(p[0][1] - p[2][1])) / (size / segs);
        let col: number[];
        if (y < SHOWCASE_WATER_LEVEL - 0.6) col = mud;
        else if (y < SHOWCASE_WATER_LEVEL + 0.45) col = sand;
        else if (y > 6.5) col = mixc(rock, snow, Math.min(1, (y - 6.5) / 1.5));
        else col = mixc(grass, grassDark, noise2(p[0][0] * 0.2, p[0][2] * 0.2));
        if (slope > 0.9 && y > SHOWCASE_WATER_LEVEL + 0.45) col = mixc(col, rock, Math.min(1, (slope - 0.9) * 1.5));
        return vary(col, 0.12, seed);
      };
      // Alternate the diagonal for a less regular low-poly look.
      if ((i + j) % 2 === 0) {
        terrain.tri(a, d, b, colorFor([a, d, b], i * 131 + j));
        terrain.tri(b, d, c, colorFor([b, d, c], i * 131 + j + 7));
      } else {
        terrain.tri(a, d, c, colorFor([a, d, c], i * 131 + j));
        terrain.tri(a, c, b, colorFor([a, c, b], i * 131 + j + 7));
      }
    }
  }
  out['showcase-terrain'] = terrain.build('showcase-terrain');

  // Water: subdivided plane; red channel = shore proximity for foam.
  {
    const ws = 60, positions: number[] = [], colors: number[] = [], normals: number[] = [], indices: number[] = [];
    for (let j = 0; j <= ws; j++) {
      for (let i = 0; i <= ws; i++) {
        const x = (i / ws - 0.5) * size * 1.6, z = (j / ws - 0.5) * size * 1.6;
        positions.push(x, 0, z);
        normals.push(0, 1, 0);
        const depth = SHOWCASE_WATER_LEVEL - showcaseTerrainHeight(x, z);
        const shore = Math.max(0, Math.min(1, 1 - depth / 1.1));
        colors.push(shore, 0, 0);
      }
    }
    for (let j = 0; j < ws; j++) {
      for (let i = 0; i < ws; i++) {
        const a = j * (ws + 1) + i, b = a + ws + 1;
        if ((i + j) % 2 === 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
    const pos = new Float32Array(positions);
    out['showcase-water'] = { name: 'showcase-water', positions: pos, normals: new Float32Array(normals), colors: new Float32Array(colors), indices: new Uint16Array(indices), bounds: computeBounds(pos) };
  }

  // Trees: trunk + three canopy tiers; LOD1 = trunk + one cone.
  const trunk = rgb('#6b4a2e'), leafA = rgb('#3f8f3c'), leafB = rgb('#79b943');
  const tree = (name: string, tiers: number) => {
    const b = new FlatMeshBuilder();
    b.ring(0, 0.22, 1.1, 0.16, 6, (i) => vary(trunk, 0.2, i));
    if (tiers === 1) b.ring(0.9, 1.35, 3.6, 0, 7, (i) => vary(mixc(leafA, leafB, 0.5), 0.2, i + 30));
    else {
      b.ring(0.9, 1.4, 2.0, 0.55, 7, (i) => vary(leafA, 0.22, i + 10));
      b.ring(1.7, 1.05, 2.75, 0.35, 7, (i) => vary(mixc(leafA, leafB, 0.5), 0.22, i + 20));
      b.ring(2.45, 0.7, 3.6, 0, 7, (i) => vary(leafB, 0.22, i + 30));
    }
    out[name] = b.build(name);
  };
  tree('showcase-tree', 3);
  tree('showcase-tree-lod1', 1);

  // Rock: jittered icosahedron.
  {
    const b = new FlatMeshBuilder();
    const t = (1 + Math.sqrt(5)) / 2;
    const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
      .map((p, i) => { const l = Math.hypot(p[0], p[1], p[2]); const j = 0.75 + hash(i, 5) * 0.5; return [(p[0] / l) * 0.5 * j, (p[1] / l) * 0.4 * j, (p[2] / l) * 0.5 * j]; });
    const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const grey = rgb('#8d8a86');
    f.forEach((tri, i) => b.tri(v[tri[0]], v[tri[1]], v[tri[2]], vary(grey, 0.3, i)));
    out['showcase-rock'] = b.build('showcase-rock');
  }

  // Grass tuft: three crossed blades (double-sided in the material).
  {
    const b = new FlatMeshBuilder();
    const g = rgb('#74b84a');
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI, c = Math.cos(a) * 0.18, s = Math.sin(a) * 0.18;
      b.tri([-c, 0, -s], [c, 0, s], [0, 0.7 + hash(i, 3) * 0.3, 0], vary(g, 0.25, i));
    }
    out['showcase-grass'] = b.build('showcase-grass');
  }

  // Crystal: elongated octahedron.
  {
    const b = new FlatMeshBuilder();
    const c = rgb('#7df9ff');
    const top = [0, 1.6, 0], bottom = [0, -0.2, 0];
    const ring = [[0.35, 0.5, 0], [0, 0.5, 0.35], [-0.35, 0.5, 0], [0, 0.5, -0.35]];
    for (let i = 0; i < 4; i++) {
      const p = ring[i], q = ring[(i + 1) % 4];
      b.tri(p, q, top, vary(c, 0.4, i));
      b.tri(q, p, bottom, vary(c, 0.4, i + 4));
    }
    out['showcase-crystal'] = b.build('showcase-crystal');
  }

  // Hut: box body + pyramid roof.
  {
    const b = new FlatMeshBuilder();
    const wall = rgb('#d9c7a3'), roof = rgb('#b3492f'), door = rgb('#5a3b22');
    const w = 1.6, d = 1.4, h = 1.3;
    const c = [[-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d], [-w, h, -d], [w, h, -d], [w, h, d], [-w, h, d]];
    b.quad(c[3], c[2], c[6], c[7], vary(wall, 0.1, 1));
    b.quad(c[1], c[0], c[4], c[5], vary(wall, 0.1, 2));
    b.quad(c[2], c[1], c[5], c[6], vary(wall, 0.1, 3));
    b.quad(c[0], c[3], c[7], c[4], vary(wall, 0.1, 4));
    b.quad([-0.35, 0.01, d + 0.01], [0.35, 0.01, d + 0.01], [0.35, 0.95, d + 0.01], [-0.35, 0.95, d + 0.01], door);
    const apex = [0, h + 1.1, 0], o = 0.35;
    const r = [[-w - o, h, -d - o], [w + o, h, -d - o], [w + o, h, d + o], [-w - o, h, d + o]];
    for (let i = 0; i < 4; i++) b.tri(r[i], r[(i + 1) % 4], apex, vary(roof, 0.12, i));
    b.quad(r[0], r[3], r[2], r[1], vary(roof, 0.12, 9));
    out['showcase-hut'] = b.build('showcase-hut');
  }
  return out;
}

/**
 * Renderer showcase: vertex-coloured low-poly island with shadows,
 * post-processing, procedural sky (`timeOfDay`), water and wind.
 * `?renderer=3d&showcase=1&time=17.5[&cycle=0.2][&still=1]`.
 */
export interface ShowcaseOptions {
  /** Hours per second for the day cycle (0 = static). */
  cycleSpeed?: number;
  /** Disable the orbit auto-rotation (stable screenshots). */
  still?: boolean;
  yaw?: number;
  pitch?: number;
  distance?: number;
  post?: boolean;
  shadows?: boolean;
  clouds?: number;
}

export function smokeSceneShowcase(timeOfDay = 17.5, opts: ShowcaseOptions = {}): SceneData {
  nextId = 1;
  const scene = createEmptyScene('Showcase');
  const focus = entity('Focus', { Transform: { position: { x: -2, y: 2.2, z: 0 } } });
  scene.entities.push(focus);
  scene.entities.push(entity('Camera', {
    Transform: { position: { x: 18, y: 12, z: 24 } },
    Camera3D: { fov: 50, far: 400, lookAt: focus.id },
    Script: { script: 'Orbit', props: { distance: opts.distance ?? 34, yaw: opts.yaw ?? 0.65, pitch: opts.pitch ?? 0.36, autoRotate: !opts.still, maxDistance: 120 } },
    AudioListener: {},
  }));
  scene.entities.push(entity('Sky', {
    Transform: {},
    SkySettings: { timeOfDay, clouds: opts.clouds ?? 0.4, turbidity: 0.3, fogDensity: 0.008, fogStart: 20, fogHeightFalloff: 0.1, sunAzimuth: 40 },
    Script: { script: 'DayCycle', props: { speed: opts.cycleSpeed ?? 0 } },
  }));
  scene.entities.push(entity('Sun', {
    Transform: { position: { x: 0, y: 30, z: 0 }, rotation: { x: -0.4, y: 0.35, z: 0.15, w: 0.83 } },
    Light: { kind: 'directional', intensity: 1, castShadows: opts.shadows ?? true, shadowDistance: 80, shadowBias: 0.06, shadowNormalBias: 1.5, shadowSoftness: 1 },
  }));
  scene.entities.push(entity('Post', {
    Transform: {},
    PostProcessSettings: { enabled: opts.post ?? true, bloomThreshold: 1, bloomIntensity: 0.45, bloomRadius: 1.1, vignette: 0.32, chromaticAberration: 0.12, saturation: 1.08, contrast: 1.04, exposure: 1 },
  }));
  scene.entities.push(entity('Terrain', {
    Transform: {},
    MeshRenderer: { mesh: 'showcase-terrain', color: { r: 1, g: 1, b: 1, a: 1 }, roughness: 1, flatShading: true },
  }));
  scene.entities.push(entity('Water', {
    Transform: { position: { x: 0, y: SHOWCASE_WATER_LEVEL, z: 0 } },
    MeshRenderer: { mesh: 'showcase-water', color: { r: 1, g: 1, b: 1, a: 1 }, castShadow: false },
    WaterMaterial: { waveAmplitude: 0.12, waveLength: 5, waveSpeed: 0.8, crestFoam: 0.8 },
  }));
  scene.entities.push(entity('Hut', {
    Transform: { position: { x: -9, y: 1.32, z: 5 }, rotation: { x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) } },
    MeshRenderer: { mesh: 'showcase-hut', color: { r: 1, g: 1, b: 1, a: 1 }, roughness: 0.9, flatShading: true },
  }));
  // Campfire: emissive embers + a warm point light.
  scene.entities.push(entity('Campfire', {
    Transform: { position: { x: -5.5, y: 1.55, z: 7.5 }, scale: { x: 0.5, y: 0.35, z: 0.5 } },
    MeshRenderer: { mesh: 'sphere', color: { r: 1, g: 0.55, b: 0.2, a: 1 }, emissive: { r: 1, g: 0.45, b: 0.12, a: 1 }, emissiveStrength: 3.5, unlit: true, castShadow: false },
    Light: { kind: 'point', intensity: 1.4, range: 7, color: { r: 1, g: 0.6, b: 0.3, a: 1 } },
    Script: { script: 'Bob', props: { amplitude: 0.04, speed: 6, spin: 0 } },
  }));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    scene.entities.push(entity(`Stone${i}`, {
      Transform: { position: { x: -5.5 + Math.cos(a) * 0.9, y: 1.42, z: 7.5 + Math.sin(a) * 0.9 }, scale: { x: 0.5, y: 0.4, z: 0.5 } },
      MeshRenderer: { mesh: 'showcase-rock', color: { r: 1, g: 1, b: 1, a: 1 }, roughness: 1 },
    }));
  }
  // Crystals glow through bloom.
  const crystals = [[6, -8, '#7df9ff'], [8.5, -6.5, '#ff7ad9'], [-14, -9, '#b6ff7a'], [12, 9, '#7df9ff']] as const;
  crystals.forEach(([x, z, hex], i) => {
    const y = showcaseTerrainHeight(x, z);
    const c = rgb(hex);
    scene.entities.push(entity(`Crystal${i}`, {
      Transform: { position: { x, y: y + 0.1, z }, scale: { x: 0.9, y: 1.2 + (i % 2) * 0.4, z: 0.9 }, rotation: { x: 0, y: Math.sin(i), z: 0, w: Math.cos(i) } },
      MeshRenderer: { mesh: 'showcase-crystal', color: { r: c[0], g: c[1], b: c[2], a: 1 }, emissive: { r: c[0], g: c[1], b: c[2], a: 1 }, emissiveStrength: 1.6, roughness: 0.2, flatShading: true, vertexColors: false },
      Light: { kind: 'point', intensity: 1.2, range: 6, color: { r: c[0], g: c[1], b: c[2], a: 1 } },
    }));
  });
  // Floating marker cubes with legacy smooth shading and transparency.
  scene.entities.push(entity('Beacon', {
    Transform: { position: { x: -2, y: 5.5, z: 0 }, scale: { x: 0.8, y: 0.8, z: 0.8 } },
    MeshRenderer: { mesh: 'cube', color: { r: 1, g: 0.85, b: 0.3, a: 1 }, emissive: { r: 1, g: 0.7, b: 0.2, a: 1 }, emissiveStrength: 1.2, roughness: 0.3, metallic: 0.3 },
    Script: { script: 'Spinner', props: { speed: 1 } },
  }));
  scene.entities.push(entity('Bubble', {
    Transform: { position: { x: 2, y: 3.5, z: 4 }, scale: { x: 1.6, y: 1.6, z: 1.6 } },
    MeshRenderer: { mesh: 'sphere', color: { r: 0.6, g: 0.85, b: 1, a: 0.35 }, roughness: 0.1, metallic: 0.2, castShadow: false },
    Script: { script: 'Bob', props: { amplitude: 0.3, speed: 0.8, spin: 0 } },
  }));
  // Scatter trees, rocks and grass on land.
  const placeOn = (x: number, z: number) => showcaseTerrainHeight(x, z);
  let placed = 0;
  for (let i = 0; i < 400 && placed < 110; i++) {
    const x = (hash(i, 1) - 0.5) * SHOWCASE_SIZE * 0.92, z = (hash(i, 2) - 0.5) * SHOWCASE_SIZE * 0.92;
    const y = placeOn(x, z);
    if (y < SHOWCASE_WATER_LEVEL + 0.7 || y > 6.2) continue;
    if (Math.hypot(x + 7, z - 6) < 5) continue; // keep the camp clear
    const s = 0.7 + hash(i, 3) * 0.7;
    const rot = hash(i, 4) * Math.PI;
    scene.entities.push(entity(`Tree${placed++}`, {
      Transform: { position: { x, y: y - 0.05, z }, scale: { x: s, y: s * (0.9 + hash(i, 5) * 0.4), z: s }, rotation: { x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) } },
      MeshRenderer: { mesh: 'showcase-tree', color: { r: 1, g: 1, b: 1, a: 1 }, roughness: 0.95, flatShading: true, windStrength: 0.12, lods: [{ mesh: 'showcase-tree-lod1', distance: 45 }, { mesh: '', distance: 220 }] },
    }));
  }
  let rocks = 0;
  for (let i = 0; i < 300 && rocks < 30; i++) {
    const x = (hash(i, 11) - 0.5) * SHOWCASE_SIZE * 0.9, z = (hash(i, 12) - 0.5) * SHOWCASE_SIZE * 0.9;
    const y = placeOn(x, z);
    if (y < SHOWCASE_WATER_LEVEL - 0.2) continue;
    const s = 0.6 + hash(i, 13) * 1.6;
    scene.entities.push(entity(`Rock${rocks++}`, {
      Transform: { position: { x, y: y + 0.1 * s, z }, scale: { x: s, y: s * 0.8, z: s * (0.8 + hash(i, 14) * 0.5) }, rotation: { x: 0, y: Math.sin(hash(i, 15) * 3), z: 0, w: Math.cos(hash(i, 15) * 3) } },
      MeshRenderer: { mesh: 'showcase-rock', color: { r: 1, g: 1, b: 1, a: 1 }, roughness: 1, flatShading: true },
    }));
  }
  let tufts = 0;
  for (let i = 0; i < 900 && tufts < 260; i++) {
    const x = (hash(i, 21) - 0.5) * SHOWCASE_SIZE * 0.85, z = (hash(i, 22) - 0.5) * SHOWCASE_SIZE * 0.85;
    const y = placeOn(x, z);
    if (y < SHOWCASE_WATER_LEVEL + 0.5 || y > 5.5) continue;
    const s = 0.55 + hash(i, 23) * 0.6;
    scene.entities.push(entity(`Grass${tufts++}`, {
      Transform: { position: { x, y: y - 0.02, z }, scale: { x: s, y: s, z: s }, rotation: { x: 0, y: Math.sin(hash(i, 24) * 3), z: 0, w: Math.cos(hash(i, 24) * 3) } },
      MeshRenderer: { mesh: 'showcase-grass', color: { r: 1, g: 1, b: 1, a: 1 }, roughness: 1, doubleSided: true, castShadow: false, windStrength: 0.45, lods: [{ mesh: '', distance: 70 }] },
    }));
  }
  return scene;
}
