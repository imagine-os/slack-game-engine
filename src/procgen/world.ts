/**
 * World generator for Driftwind: a seed becomes an archipelago laid out along
 * a spiral flow path (so a glider always has a route), biomes per region,
 * decorations per island, cloud layers, wind currents, a race course of gate
 * rings, spawn points and a chunk API for streaming.
 *
 * Everything is derived from the seed deterministically and lazily: island
 * meshes and decorations are generated the first time `islandDetail(id)` is
 * asked for, so large worlds cost nothing until visited.
 */
import { Random } from '../core/math/Random';
import type { Vec3Like } from '../core/math/Vec3';
import { generateBird } from './bird';
import { generateCloud } from './cloud';
import { generateGlider } from './glider';
import { type IslandResult, generateIsland } from './island';
import { type GeneratedMesh, mixRGB, rgb } from './MeshBuilder';
import { Noise, hash2i } from './noise';
import { BIOME_IDS, type BiomeId, LIVERIES, PALETTES, type Palette } from './palettes';
import { generateBalloon, generateFeather, generateMote, generatePaperLantern, generateTurbine, generateTurbineBlades, generateWindStreak, generateWindsock } from './props';
import { generateRing } from './ring';
import { generateCrystal, generateRock } from './rock';
import { generateArch, generateColumn, generateStoneLantern, generateStoneRing } from './ruins';
import { normalizeSeed, seedValue } from './seed';
import { generateTree, pickSpecies } from './tree';

export interface WorldOptions {
  /** Number of islands along the flow path. Default 34. */
  islands?: number;
  /** Distance between consecutive islands along the path. Default 92. */
  spacing?: number;
  /** Streaming chunk size in world units. Default 160. */
  chunkSize?: number;
  /** Number of race gates. Default 12. */
  gates?: number;
  /** Cloud count. Default 70. */
  clouds?: number;
}

export interface IslandSpec {
  id: number;
  name: string;
  seed: number;
  position: Vec3Like;
  radius: number;
  height: number;
  depth: number;
  biome: BiomeId;
  terraces: number;
  ruggedness: number;
  waterfalls: number;
  /** Progress along the flow path (0 start .. 1 end). */
  t: number;
  chunk: string;
}

export type DecorationKind = 'tree' | 'rock' | 'crystal' | 'arch' | 'column' | 'stonering' | 'stone-lantern' | 'turbine' | 'turbine-blades' | 'windsock' | 'lantern' | 'balloon';

/** One placed instance of a shared library mesh. */
export interface Decoration {
  kind: DecorationKind;
  /** Library key (see {@link WorldGenerator.library}). */
  key: string;
  position: Vec3Like;
  yaw: number;
  scale: number;
  /** Animation hint for the runtime (spin, bob, sway). */
  animate?: 'spin' | 'bob' | 'sway';
}

export interface FlockSpec { center: Vec3Like; radius: number; count: number }

export interface IslandDetail {
  spec: IslandSpec;
  island: IslandResult;
  /** Low-poly variant for distant rendering. */
  lod: IslandResult;
  decorations: Decoration[];
  /** Collectible light motes (world space). */
  motes: Vec3Like[];
  flock: FlockSpec | null;
  palette: Palette;
}

export interface RingSpec {
  index: number;
  position: Vec3Like;
  /** Heading of the gate's through-axis (radians about Y, 0 = -Z). */
  yaw: number;
  radius: number;
  chunk: string;
}

export interface WindCurrent {
  id: number;
  points: Vec3Like[];
  strength: number;
  radius: number;
}

export interface CloudSpec {
  id: number;
  /** Library key `cloud-<variant>`. */
  key: string;
  position: Vec3Like;
  scale: number;
  yaw: number;
  chunk: string;
  /** Drift speed along +X (units/s). */
  drift: number;
}

export interface SpawnPoint { position: Vec3Like; yaw: number }

export interface ChunkContent {
  key: string;
  islands: IslandSpec[];
  clouds: CloudSpec[];
  rings: RingSpec[];
}

/** Result of {@link WorldGenerator.collide}. */
export interface WorldHit {
  island: IslandSpec;
  push: Vec3Like;
  normal: Vec3Like;
  depth: number;
}

const ISLAND_ADJ = ['Amber', 'Hollow', 'Quiet', 'Gilded', 'Misty', 'Windward', 'Lantern', 'Mossy', 'Broken', 'Sunlit', 'Ember', 'Feather', 'Cloud', 'Silver', 'Twilight', 'Coral', 'Whistling', 'Ivory', 'Drifting', 'Ancient'];
const ISLAND_NOUN = ['Spire', 'Reach', 'Hold', 'Shelf', 'Perch', 'Crown', 'Steps', 'Rest', 'Bastion', 'Garden', 'Anvil', 'Cradle', 'Watch', 'Terrace', 'Throne', 'Roost', 'Shoal', 'Bower', 'Landing', 'Keep'];

/** Track which chunks are active for a moving observer (streaming helper). */
export class ChunkTracker {
  readonly active = new Set<string>();

  constructor(readonly world: WorldGenerator) {}

  /** Update for the observer position; returns chunks that came into and went out of range. */
  update(pos: Vec3Like, radius: number): { entered: string[]; exited: string[] } {
    const wanted = new Set(this.world.chunksAround(pos, radius));
    const entered: string[] = [], exited: string[] = [];
    for (const k of wanted) if (!this.active.has(k)) { this.active.add(k); entered.push(k); }
    for (const k of Array.from(this.active)) if (!wanted.has(k)) { this.active.delete(k); exited.push(k); }
    return { entered, exited };
  }

  clear(): string[] {
    const out = Array.from(this.active);
    this.active.clear();
    return out;
  }
}

export class WorldGenerator {
  readonly seed: string;
  readonly seedValue: number;
  readonly chunkSize: number;
  readonly islands: IslandSpec[] = [];
  /** Sampled flow path (world space). */
  readonly path: Vec3Like[] = [];
  readonly rings: RingSpec[] = [];
  readonly winds: WindCurrent[] = [];
  readonly clouds: CloudSpec[] = [];
  /** Altitude range of the archipelago (for floors/ceilings). */
  readonly bounds: { minY: number; maxY: number; radius: number };
  /** Palette of the world's dominant biome (sky tint, glider defaults). */
  readonly primaryBiome: BiomeId;

  private details = new Map<number, IslandDetail>();
  private chunks = new Map<string, ChunkContent>();
  private lib = new Map<string, GeneratedMesh>();
  private noise: Noise;

  constructor(seed: string, opts: WorldOptions = {}) {
    this.seed = normalizeSeed(seed);
    this.seedValue = seedValue(this.seed);
    this.chunkSize = opts.chunkSize ?? 160;
    const rng = new Random(this.seedValue);
    this.noise = new Noise(this.seedValue ^ 0x77);
    const count = opts.islands ?? 34;
    const spacing = opts.spacing ?? 92;

    // ---- flow path: a widening spiral with altitude swells.
    const turns = 2.1, r0 = 70, r1 = r0 + spacing * count / (Math.PI * 2 * 1.35);
    const samples = 400;
    const baseY = 55;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const a = t * turns * Math.PI * 2 + this.noise.simplex2(t * 3, 0.5) * 0.12;
      const r = r0 + (r1 - r0) * t + this.noise.simplex2(t * 5 + 3, 1.5) * spacing * 0.25;
      const y = baseY + Math.sin(t * Math.PI * 3.3) * 22 + this.noise.simplex2(t * 4 + 9, 7) * 10;
      this.path.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
    }

    // ---- islands: spaced along the path by arc length, alternating sides.
    const arc: number[] = [0];
    for (let i = 1; i < this.path.length; i++) arc.push(arc[i - 1] + dist(this.path[i], this.path[i - 1]));
    const total = arc[arc.length - 1];
    const step = total / count;
    let minY = Infinity, maxY = -Infinity, maxR = 0;
    // Biomes: contiguous regions along the path, a shuffled order per seed.
    const order = rng.shuffle(BIOME_IDS.slice());
    const regions = order.length;
    for (let i = 0; i < count; i++) {
      const s = step * (i + 0.5);
      const { point, tangent, t } = this.samplePath(arc, s);
      const side = (i % 2 === 0 ? 1 : -1) * rng.range(0.55, 1);
      const nx = -tangent.z, nz = tangent.x;
      const radius = rng.range(13, 24) * (i === 0 ? 0.9 : 1);
      const lateral = spacing * 0.38 * side + rng.range(-6, 6);
      const position = { x: point.x + nx * lateral, y: point.y + rng.range(-14, -4), z: point.z + nz * lateral };
      const biome = order[Math.min(regions - 1, Math.floor(t * regions * 0.999))];
      const seed = hash2i(i, 91, this.seedValue);
      const name = `${ISLAND_ADJ[(seed >>> 3) % ISLAND_ADJ.length]} ${ISLAND_NOUN[(seed >>> 9) % ISLAND_NOUN.length]}`;
      const spec: IslandSpec = {
        id: i, name, seed, position, radius, height: radius * rng.range(0.3, 0.45), depth: radius * rng.range(0.7, 1.05), biome,
        terraces: rng.chance(0.3) ? 0 : rng.int(2, 4), ruggedness: rng.range(0.3, 0.8), waterfalls: rng.chance(0.55) ? 1 : rng.chance(0.3) ? 2 : 0,
        t, chunk: '',
      };
      spec.chunk = this.chunkKey(position.x, position.z);
      this.islands.push(spec);
      minY = Math.min(minY, position.y - spec.depth); maxY = Math.max(maxY, position.y + spec.height);
      maxR = Math.max(maxR, Math.hypot(position.x, position.z) + radius);
    }
    this.bounds = { minY, maxY, radius: maxR + 200 };
    const biomeCount = new Map<BiomeId, number>();
    for (const isl of this.islands) biomeCount.set(isl.biome, (biomeCount.get(isl.biome) ?? 0) + 1);
    this.primaryBiome = Array.from(biomeCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'meadow';

    // ---- race course: gates on the path between islands, first `gates` intervals.
    const gates = Math.min(opts.gates ?? 12, count - 1);
    for (let g = 0; g < gates; g++) {
      const s = step * (g + 1.05);
      const { point, tangent } = this.samplePath(arc, s);
      const nx = -tangent.z, nz = tangent.x;
      const off = rng.range(-8, 8);
      const position = { x: point.x + nx * off, y: point.y + rng.range(-3, 5), z: point.z + nz * off };
      const yaw = Math.atan2(-tangent.x, -tangent.z);
      const ring: RingSpec = { index: g, position, yaw, radius: rng.range(6, 8.5), chunk: this.chunkKey(position.x, position.z) };
      this.rings.push(ring);
    }

    // ---- wind currents: ribbons following stretches of the path, offset to one side.
    const windCount = 4 + Math.floor(count / 10);
    for (let w = 0; w < windCount; w++) {
      const start = rng.range(0.04, 0.85), len = rng.range(0.07, 0.13);
      const points: Vec3Like[] = [];
      const side = rng.sign() * rng.range(0.2, 0.6);
      const steps = 10;
      for (let k = 0; k <= steps; k++) {
        const s = (start + len * (k / steps)) * total;
        const { point, tangent } = this.samplePath(arc, s);
        const nx = -tangent.z, nz = tangent.x;
        const lateral = spacing * side;
        points.push({ x: point.x + nx * lateral, y: point.y + 4 + Math.sin(k * 0.7 + w) * 4, z: point.z + nz * lateral });
      }
      this.winds.push({ id: w, points, strength: rng.range(10, 18), radius: rng.range(7, 11) });
    }

    // ---- clouds: a layer below the islands, a thinner one above.
    const cloudCount = opts.clouds ?? 70;
    for (let c = 0; c < cloudCount; c++) {
      const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.range(0.05, 1)) * (maxR + 120);
      const below = rng.chance(0.72);
      const y = below ? minY - rng.range(10, 45) : maxY + rng.range(25, 60);
      const position = { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
      this.clouds.push({ id: c, key: `cloud-${c % 6}`, position, scale: rng.range(0.9, below ? 2.4 : 1.4), yaw: rng.range(0, Math.PI * 2), chunk: this.chunkKey(position.x, position.z), drift: rng.range(0.4, 1.2) });
    }

    // ---- chunk index.
    for (const isl of this.islands) this.chunk(isl.chunk).islands.push(isl);
    for (const cl of this.clouds) this.chunk(cl.chunk).clouds.push(cl);
    for (const rg of this.rings) this.chunk(rg.chunk).rings.push(rg);
  }

  private samplePath(arc: readonly number[], s: number): { point: Vec3Like; tangent: Vec3Like; t: number } {
    let i = 1;
    while (i < arc.length - 1 && arc[i] < s) i++;
    const a = this.path[i - 1], b = this.path[i];
    const f = Math.min(1, Math.max(0, (s - arc[i - 1]) / Math.max(1e-6, arc[i] - arc[i - 1])));
    const point = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f };
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    return { point, tangent: { x: tx / tl, y: 0, z: tz / tl }, t: (i - 1 + f) / (this.path.length - 1) };
  }

  // ------------------------------------------------------------------ chunks

  chunkKey(x: number, z: number): string {
    return `${Math.floor(x / this.chunkSize)},${Math.floor(z / this.chunkSize)}`;
  }

  private chunk(key: string): ChunkContent {
    let c = this.chunks.get(key);
    if (!c) this.chunks.set(key, (c = { key, islands: [], clouds: [], rings: [] }));
    return c;
  }

  /** Chunk keys whose square intersects the circle around `pos` (only chunks with content). */
  chunksAround(pos: Vec3Like, radius: number): string[] {
    const cs = this.chunkSize;
    const x0 = Math.floor((pos.x - radius) / cs), x1 = Math.floor((pos.x + radius) / cs);
    const z0 = Math.floor((pos.z - radius) / cs), z1 = Math.floor((pos.z + radius) / cs);
    const out: string[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        // Closest point of the chunk square to pos.
        const qx = Math.min(Math.max(pos.x, cx * cs), (cx + 1) * cs), qz = Math.min(Math.max(pos.z, cz * cs), (cz + 1) * cs);
        if ((qx - pos.x) ** 2 + (qz - pos.z) ** 2 > radius * radius) continue;
        const key = `${cx},${cz}`;
        if (this.chunks.has(key)) out.push(key);
      }
    }
    return out;
  }

  /** Content of a chunk (empty content for unknown keys). */
  contentOf(key: string): ChunkContent {
    return this.chunks.get(key) ?? { key, islands: [], clouds: [], rings: [] };
  }

  get chunkKeys(): string[] {
    return Array.from(this.chunks.keys());
  }

  // ----------------------------------------------------------------- islands

  palette(biome: BiomeId): Palette {
    return PALETTES[biome];
  }

  /** Full detail for an island (cached). */
  islandDetail(id: number): IslandDetail {
    let d = this.details.get(id);
    if (d) return d;
    const spec = this.islands[id];
    if (!spec) throw new Error(`No island ${id}`);
    const palette = PALETTES[spec.biome];
    const opts = { radius: spec.radius, height: spec.height, depth: spec.depth, palette, terraces: spec.terraces, ruggedness: spec.ruggedness, waterfalls: spec.waterfalls };
    const island = generateIsland(spec.seed, opts);
    const lod = generateIsland(spec.seed, { ...opts, lod: 1 });
    const rng = new Random(spec.seed ^ 0xdec0);
    const shape = island.shape;
    const decorations: Decoration[] = [];
    const P = spec.position;
    const world = (p: Vec3Like): Vec3Like => ({ x: P.x + p.x, y: P.y + p.y, z: P.z + p.z });
    const density = palette.density;
    // Trees.
    const treeCount = Math.round(density.trees * spec.radius * spec.radius * 0.032 * rng.range(0.7, 1.2));
    for (const s of shape.samplePoints(rng, treeCount, { maxSlope: 0.32, maxU: 0.84 })) {
      const species = pickSpecies(palette, rng);
      decorations.push({ kind: 'tree', key: `tree-${spec.biome}-${species}-${rng.int(0, 2)}`, position: world(s.position), yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.35), animate: 'sway' });
    }
    // Rocks.
    for (const s of shape.samplePoints(rng, Math.round(density.rocks * spec.radius * 0.22), { maxSlope: 0.6 })) {
      decorations.push({ kind: 'rock', key: `rock-${spec.biome}-${rng.int(0, 2)}`, position: world(s.position), yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.7, 1.6) });
    }
    // Crystals.
    for (const s of shape.samplePoints(rng, Math.round(density.crystals * rng.range(0, 2.5)), { maxSlope: 0.5 })) {
      decorations.push({ kind: 'crystal', key: `crystal-${spec.biome}-${rng.int(0, 1)}`, position: world(s.position), yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.4) });
    }
    // Ruins: one set on some islands, near a flat spot.
    if (rng.chance(density.ruins * 0.7)) {
      const flat = shape.samplePoints(rng, 6, { maxSlope: 0.12, maxU: 0.7 }).sort((a, b) => a.slope - b.slope)[0];
      if (flat) {
        const kind = rng.pick(['arch', 'column', 'stonering'] as const)!;
        decorations.push({ kind, key: `${kind}-${spec.biome}`, position: world(flat.position), yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.2) });
        if (rng.chance(0.6)) {
          const a = rng.range(0, Math.PI * 2), r = rng.range(3, 6);
          const lx = flat.position.x + Math.cos(a) * r, lz = flat.position.z + Math.sin(a) * r;
          const ly = shape.heightAt(lx, lz);
          if (Number.isFinite(ly)) decorations.push({ kind: 'stone-lantern', key: `stone-lantern-${spec.biome}`, position: world({ x: lx, y: ly, z: lz }), yaw: a, scale: 1 });
        }
      }
    }
    // Props.
    if (rng.chance(0.3)) {
      const top = shape.samplePoints(rng, 8, { maxSlope: 0.2, maxU: 0.6 }).sort((a, b) => b.position.y - a.position.y)[0];
      if (top) {
        const yaw = rng.range(0, Math.PI * 2);
        const pos = world(top.position);
        decorations.push({ kind: 'turbine', key: `turbine-${spec.biome}`, position: pos, yaw, scale: 1 });
        // Rotor hub: (0, 7.1, -0.75) in turbine-local space, rotated by yaw about Y.
        decorations.push({ kind: 'turbine-blades', key: `turbine-blades-${spec.biome}`, position: { x: pos.x - Math.sin(yaw) * 0.75, y: pos.y + 7.1, z: pos.z - Math.cos(yaw) * 0.75 }, yaw, scale: 1, animate: 'spin' });
      }
    }
    if (rng.chance(0.25)) {
      const s = shape.samplePoints(rng, 1, { maxSlope: 0.3, minU: 0.5, maxU: 0.8 })[0];
      if (s) decorations.push({ kind: 'windsock', key: `windsock-${spec.biome}`, position: world(s.position), yaw: rng.range(0, Math.PI * 2), scale: 1 });
    }
    const lanterns = rng.chance(0.6) ? rng.int(2, 4) : 0;
    for (let k = 0; k < lanterns; k++) {
      const a = rng.range(0, Math.PI * 2), r = spec.radius * rng.range(0.9, 1.3);
      decorations.push({ kind: 'lantern', key: `lantern-${spec.biome}`, position: world({ x: Math.cos(a) * r, y: spec.height * 0.6 + rng.range(4, 10), z: Math.sin(a) * r }), yaw: a, scale: rng.range(0.9, 1.3), animate: 'bob' });
    }
    if (rng.chance(0.14)) {
      const a = rng.range(0, Math.PI * 2), r = spec.radius * rng.range(0.4, 0.9);
      decorations.push({ kind: 'balloon', key: `balloon-${rng.int(0, 1)}`, position: world({ x: Math.cos(a) * r, y: spec.height + rng.range(14, 22), z: Math.sin(a) * r }), yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.9, 1.2), animate: 'bob' });
    }
    // Motes: light collectibles orbiting the island.
    const motes: Vec3Like[] = [];
    const moteCount = rng.int(3, 7);
    const ma = rng.range(0, Math.PI * 2);
    for (let k = 0; k < moteCount; k++) {
      const a = ma + (k / moteCount) * Math.PI * 1.2, r = spec.radius * rng.range(1.15, 1.45);
      motes.push(world({ x: Math.cos(a) * r, y: spec.height * 0.4 + rng.range(3, 12) + k * 1.2, z: Math.sin(a) * r }));
    }
    const flock: FlockSpec | null = rng.chance(0.4) ? { center: world({ x: 0, y: spec.height + 8, z: 0 }), radius: spec.radius * 1.1, count: rng.int(5, 9) } : null;
    d = { spec, island, lod, decorations, motes, flock, palette };
    this.details.set(id, d);
    return d;
  }

  /** Release cached detail (streaming out). */
  releaseDetail(id: number): void {
    this.details.delete(id);
  }

  // ---------------------------------------------------------------- library

  /**
   * Shared meshes referenced by decorations, clouds, rings and gliders,
   * generated on first request. Keys: `tree-<biome>-<species>-<n>`,
   * `rock-<biome>-<n>`, `crystal-<biome>-<n>`, `arch|column|stonering|stone-lantern|turbine|turbine-blades|windsock|lantern-<biome>`,
   * `balloon-<n>`, `cloud-<n>`, `ring`, `mote`, `wind-streak`, `feather`, `bird-up|down|glide`, `glider-<n>`.
   */
  library(key: string): GeneratedMesh {
    let m = this.lib.get(key);
    if (m) return m;
    const parts = key.split('-');
    const seed = hash2i(this.seedValue, key.length * 131 + key.charCodeAt(key.length - 1), 7);
    const biomeOf = (s: string): Palette => PALETTES[(BIOME_IDS.includes(s as BiomeId) ? s : 'meadow') as BiomeId];
    switch (parts[0]) {
      case 'tree': m = generateTree(seed, { species: parts[2] as never, palette: biomeOf(parts[1]) }); break;
      case 'rock': m = generateRock(seed, { palette: biomeOf(parts[1]) }); break;
      case 'crystal': m = generateCrystal(seed, { palette: biomeOf(parts[1]) }); break;
      case 'arch': m = generateArch(seed, biomeOf(parts[1])); break;
      case 'column': m = generateColumn(seed, biomeOf(parts[1])); break;
      case 'stonering': m = generateStoneRing(seed, biomeOf(parts[1])); break;
      case 'stone': m = generateStoneLantern(biomeOf(parts[2])); break;                    // stone-lantern-<biome>
      case 'turbine': m = parts[1] === 'blades' ? generateTurbineBlades(biomeOf(parts[2])) : generateTurbine(biomeOf(parts[1])); break;
      case 'windsock': m = generateWindsock(biomeOf(parts[1])); break;
      case 'lantern': m = generatePaperLantern(biomeOf(parts[1])); break;
      case 'balloon': m = generateBalloon(seed + Number(parts[1] ?? 0), PALETTES[this.primaryBiome]); break;
      case 'cloud': m = generateCloud(this.seedValue + Number(parts[1] ?? 0) * 977, { light: rgb('#fff6ec'), shadow: mixRGB(rgb('#d9c6e8'), PALETTES[this.primaryBiome].sand, 0.3) }); break;
      case 'ring': m = generateRing({ palette: PALETTES[this.primaryBiome], glow: PALETTES[this.primaryBiome].accent }); break;
      case 'mote': m = generateMote(PALETTES[this.primaryBiome].lantern); break;
      case 'wind': m = generateWindStreak(); break;
      case 'feather': m = generateFeather(); break;
      case 'bird': m = generateBird({ pose: (parts[1] as 'up' | 'down' | 'glide') ?? 'glide' }); break;
      case 'glider': m = generateGlider({ livery: LIVERIES[Number(parts[1] ?? 0) % LIVERIES.length] }); break;
      default: throw new Error(`Unknown library key "${key}"`);
    }
    this.lib.set(key, m);
    return m;
  }

  /** Library keys already generated. */
  get libraryKeys(): string[] {
    return Array.from(this.lib.keys());
  }

  // ------------------------------------------------------------------ queries

  /** Spawn position for player `index` near the start of the flow path, facing along it. */
  spawn(index = 0): SpawnPoint {
    const a = this.path[2], b = this.path[6];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    const row = Math.floor(index / 2), col = index % 2 === 0 ? -1 : 1;
    const lateral = col * (6 + row * 5) * (index === 0 ? 0 : 1);
    return {
      position: { x: a.x + nx * lateral - (tx / tl) * row * 10, y: a.y + 6 + row * 2, z: a.z + nz * lateral - (tz / tl) * row * 10 },
      yaw: Math.atan2(-tx / tl, -tz / tl),
    };
  }

  /** Islands whose horizontal distance to `pos` is within `range` (plus their radius). */
  nearbyIslands(pos: Vec3Like, range: number): IslandSpec[] {
    const out: IslandSpec[] = [];
    for (const isl of this.islands) {
      const dx = isl.position.x - pos.x, dz = isl.position.z - pos.z;
      const r = range + isl.radius;
      if (dx * dx + dz * dz <= r * r) out.push(isl);
    }
    return out;
  }

  /** Closest island to a point (by surface distance estimate). */
  nearestIsland(pos: Vec3Like): { island: IslandSpec; distance: number } | null {
    let best: IslandSpec | null = null, bd = Infinity;
    for (const isl of this.islands) {
      const d = Math.max(0, dist(isl.position, pos) - isl.radius);
      if (d < bd) { bd = d; best = isl; }
    }
    return best ? { island: best, distance: bd } : null;
  }

  /** Wind velocity at a point (sum of nearby currents). */
  windAt(pos: Vec3Like, out: Vec3Like = { x: 0, y: 0, z: 0 }): Vec3Like {
    out.x = out.y = out.z = 0;
    for (const w of this.winds) {
      let best = Infinity, bi = 0, bf = 0;
      for (let i = 0; i < w.points.length - 1; i++) {
        const a = w.points[i], b = w.points[i + 1];
        const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
        const l2 = abx * abx + aby * aby + abz * abz || 1;
        const f = Math.min(1, Math.max(0, ((pos.x - a.x) * abx + (pos.y - a.y) * aby + (pos.z - a.z) * abz) / l2));
        const qx = a.x + abx * f, qy = a.y + aby * f, qz = a.z + abz * f;
        const d2 = (qx - pos.x) ** 2 + (qy - pos.y) ** 2 + (qz - pos.z) ** 2;
        if (d2 < best) { best = d2; bi = i; bf = f; }
      }
      const d = Math.sqrt(best);
      if (d >= w.radius) continue;
      const a = w.points[bi], b = w.points[bi + 1];
      const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z, tl = Math.hypot(tx, ty, tz) || 1;
      const k = w.strength * (1 - d / w.radius) ** 2;
      void bf;
      out.x += (tx / tl) * k; out.y += (ty / tl) * k; out.z += (tz / tl) * k;
    }
    return out;
  }

  /** Resolve a sphere against every island it touches (soft collision). */
  collide(pos: Vec3Like, radius: number): WorldHit | null {
    let best: WorldHit | null = null;
    for (const isl of this.islands) {
      const dx = pos.x - isl.position.x, dz = pos.z - isl.position.z;
      const r = isl.radius * 1.05 + radius;
      if (dx * dx + dz * dz > r * r) continue;
      const dy = pos.y - isl.position.y;
      if (dy > isl.height + isl.radius * 0.5 + radius || dy < -isl.depth - isl.radius * 0.5 - radius) continue;
      const shape = this.islandDetail(isl.id).island.shape;
      const hit = shape.resolve(dx, dy, dz, radius);
      if (hit && (!best || hit.depth > best.depth)) best = { island: isl, push: hit.push, normal: hit.normal, depth: hit.depth };
    }
    return best;
  }

  /** Top surface height of the island under a point, or `null` when over open sky. */
  groundBelow(pos: Vec3Like): { y: number; island: IslandSpec } | null {
    for (const isl of this.nearbyIslands(pos, 0)) {
      const shape = this.islandDetail(isl.id).island.shape;
      const h = shape.heightAt(pos.x - isl.position.x, pos.z - isl.position.z);
      if (Number.isFinite(h)) return { y: isl.position.y + h, island: isl };
    }
    return null;
  }

  /** Summary for tools and tests. */
  describe(): { seed: string; islands: number; rings: number; winds: number; clouds: number; chunks: number; biome: BiomeId } {
    return { seed: this.seed, islands: this.islands.length, rings: this.rings.length, winds: this.winds.length, clouds: this.clouds.length, chunks: this.chunks.size, biome: this.primaryBiome };
  }
}

function dist(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
