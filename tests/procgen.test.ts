/**
 * Procedural art library: deterministic noise, MeshBuilder output, every
 * generator produces valid mesh data, worlds are reproducible per seed with a
 * flyable race course, and the pure flight helpers behave.
 */
import { describe, expect, it } from 'vitest';
import {
  ChunkTracker, MeshBuilder, Noise, WorldGenerator, addBox, addIcosphere, bankTurnRate, bounceHeading, dailySeed, gateCrossing,
  generateArch, generateBalloon, generateBird, generateCloud, generateColumn, generateCrystal, generateFeather, generateGlider,
  generateIsland, generateMote, generatePaperLantern, generateRing, generateRock, generateStoneLantern, generateStoneRing,
  generateTree, generateTurbine, generateTurbineBlades, generateWindStreak, generateWindsock, hashString, headingForward, integrateSpeed,
  mergeMeshes, meshBounds, normalizeSeed, randomSeed, rgb, seedTitle, validateMesh, yawFromDirection, PALETTES, LIVERIES,
  type GeneratedMesh, type Palette,
} from '../src/index';

const P: Palette = PALETTES.meadow;

describe('noise', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = new Noise(7), b = new Noise(7), c = new Noise(8);
    const pts = [[0.3, 1.7], [10.2, -4.1], [123.4, 56.7]] as const;
    for (const [x, y] of pts) {
      expect(a.simplex2(x, y)).toBe(b.simplex2(x, y));
      expect(a.fbm2(x, y, { octaves: 4 })).toBe(b.fbm2(x, y, { octaves: 4 }));
      expect(a.simplex3(x, y, 2.5)).toBe(b.simplex3(x, y, 2.5));
    }
    expect(pts.some(([x, y]) => a.simplex2(x, y) !== c.simplex2(x, y))).toBe(true);
  });
  it('stays in range', () => {
    const n = new Noise(3);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 2000; i++) { const v = n.simplex2(i * 0.37, i * 0.11); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    expect(lo).toBeGreaterThanOrEqual(-1.01);
    expect(hi).toBeLessThanOrEqual(1.01);
    expect(hi - lo).toBeGreaterThan(0.8);
    for (let i = 0; i < 200; i++) { const v = n.fbm2(i * 0.7, -i * 0.3); expect(Math.abs(v)).toBeLessThanOrEqual(1.01); }
    for (let i = 0; i < 200; i++) { const v = n.ridged2(i * 0.7, i * 0.2); expect(v).toBeGreaterThanOrEqual(-0.01); expect(v).toBeLessThanOrEqual(1.01); }
  });
  it('hashes strings stably', () => {
    expect(hashString('amber-lagoon-42')).toBe(hashString('amber-lagoon-42'));
    expect(hashString('amber-lagoon-42')).not.toBe(hashString('amber-lagoon-43'));
  });
});

describe('MeshBuilder', () => {
  it('builds unwelded flat-shaded triangles with colours, bounds and outward normals', () => {
    const b = new MeshBuilder();
    b.group('a', rgb('#ff0000'));
    addBox(b, { x: 2, y: 2, z: 2 });
    const m = b.build();
    expect(validateMesh(m)).toEqual([]);
    expect(m.indices.length).toBe(36);
    expect(m.positions.length).toBe(m.indices.length * 3);
    expect(m.colors.length).toBe(m.positions.length);
    expect(m.bounds).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });
    // Every face normal points away from the centre.
    for (let t = 0; t < m.indices.length; t += 3) {
      const i = m.indices[t] * 3;
      const nx = m.normals![i], ny = m.normals![i + 1], nz = m.normals![i + 2];
      const px = m.positions[i], py = m.positions[i + 1], pz = m.positions[i + 2];
      expect(nx * px + ny * py + nz * pz).toBeGreaterThan(0);
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
    }
    expect(m.colors[0]).toBeCloseTo(1); expect(m.colors[1]).toBeCloseTo(0);
  });
  it('splits colour groups and merges them back', () => {
    const b = new MeshBuilder();
    const g1 = b.group('shell', rgb('#3366cc'));
    addIcosphere(b, 1, 1);
    b.group('glow', rgb('#ffcc00'), { emissive: rgb('#ffcc00'), emissiveStrength: 2 });
    addBox(b, { x: 1, y: 1, z: 1 }, { x: 3, y: 0, z: 0 });
    void g1;
    const all = b.buildAll();
    expect(all.groups.map((g) => g.name)).toEqual(['shell', 'glow']);
    expect(all.groups[1].emissiveStrength).toBe(2);
    expect(all.groups.reduce((n, g) => n + g.triangles, 0)).toBe(all.mesh.indices.length / 3);
    const merged = mergeMeshes(all.groups.map((g) => g.data));
    expect(validateMesh(merged)).toEqual([]);
    expect(merged.indices.length).toBe(all.mesh.indices.length);
    expect(merged.bounds).toEqual(meshBounds(all.mesh.positions));
  });
});

const GENERATORS: Record<string, () => GeneratedMesh> = {
  island: () => { const r = generateIsland(11, { radius: 18, height: 7, depth: 16, palette: P, terraces: 2, waterfalls: 1 }); return { mesh: r.mesh, groups: r.groups }; },
  'island-lod': () => { const r = generateIsland(11, { radius: 18, height: 7, depth: 16, palette: PALETTES.lagoon, lod: 1 }); return { mesh: r.mesh, groups: r.groups }; },
  pine: () => generateTree(1, { species: 'pine', palette: P }),
  broadleaf: () => generateTree(2, { species: 'broadleaf', palette: P }),
  palm: () => generateTree(3, { species: 'palm', palette: PALETTES.lagoon }),
  dead: () => generateTree(4, { species: 'dead', palette: PALETTES.dusk }),
  rock: () => generateRock(5, { palette: P }),
  crystal: () => generateCrystal(6, { palette: PALETTES.crest }),
  cloud: () => generateCloud(7, {}),
  arch: () => generateArch(8, P),
  column: () => generateColumn(9, P),
  stoneRing: () => generateStoneRing(10, P),
  stoneLantern: () => generateStoneLantern(P),
  glider: () => generateGlider({ livery: LIVERIES[0] }),
  'glider-lod': () => generateGlider({ livery: LIVERIES[2], lod: 1 }),
  birdUp: () => generateBird({ pose: 'up' }),
  birdDown: () => generateBird({ pose: 'down' }),
  birdGlide: () => generateBird({ pose: 'glide' }),
  ring: () => generateRing({ palette: P }),
  turbine: () => generateTurbine(P),
  turbineBlades: () => generateTurbineBlades(P),
  windsock: () => generateWindsock(P),
  lantern: () => generatePaperLantern(P),
  balloon: () => generateBalloon(12, P),
  mote: () => generateMote(),
  windStreak: () => generateWindStreak(),
  feather: () => generateFeather(),
};

describe('generators', () => {
  for (const [name, make] of Object.entries(GENERATORS)) {
    it(`${name}: valid mesh data with colour groups`, () => {
      const g = make();
      expect(validateMesh(g.mesh), name).toEqual([]);
      expect(g.mesh.indices.length / 3, `${name} triangles`).toBeGreaterThanOrEqual(2);
      expect(g.groups.length, `${name} groups`).toBeGreaterThan(0);
      for (const grp of g.groups) expect(validateMesh(grp.data), `${name}/${grp.name}`).toEqual([]);
      expect(g.groups.reduce((n, grp) => n + grp.data.indices.length, 0)).toBe(g.mesh.indices.length);
      const b = g.mesh.bounds;
      const extents = [0, 1, 2].filter((k) => b.max[k] - b.min[k] > 0).length;
      expect(extents, `${name} is not degenerate`).toBeGreaterThanOrEqual(2);
      for (const v of g.mesh.positions) expect(Number.isFinite(v)).toBe(true);
    });
  }
  it('islands are deterministic per seed and their shape answers height/collision queries', () => {
    const a = generateIsland(21, { radius: 16, height: 6, depth: 14, palette: PALETTES.ember });
    const b = generateIsland(21, { radius: 16, height: 6, depth: 14, palette: PALETTES.ember });
    const c = generateIsland(22, { radius: 16, height: 6, depth: 14, palette: PALETTES.ember });
    expect(Array.from(a.mesh.positions.slice(0, 300))).toEqual(Array.from(b.mesh.positions.slice(0, 300)));
    expect(Array.from(a.mesh.positions.slice(0, 300))).not.toEqual(Array.from(c.mesh.positions.slice(0, 300)));
    expect(a.shape.contains(0, a.shape.heightAt(0, 0) - 1, 0)).toBe(true);
    expect(a.shape.contains(40, 0, 40)).toBe(false);
    expect(a.shape.heightAt(0, 0)).toBeGreaterThan(0);
    const hit = a.shape.resolve(0, a.shape.heightAt(0, 0) - 0.5, 0, 1);
    expect(hit).not.toBeNull();
    expect(hit!.push.y).toBeGreaterThan(0);
  });
});

describe('seeds', () => {
  it('normalises and titles seeds', () => {
    expect(normalizeSeed('  Amber Lagoon 42 ')).toBe('amber-lagoon-42');
    expect(normalizeSeed('')).not.toBe('');
    expect(seedTitle('amber-lagoon-42')).toBe('Amber Lagoon 42');
    expect(normalizeSeed(randomSeed())).toMatch(/^[a-z]+-[a-z]+-\d+$/);
    expect(dailySeed(new Date('2026-09-17T12:00:00Z'))).toBe(dailySeed(new Date('2026-09-17T23:00:00Z')));
    expect(dailySeed(new Date('2026-09-17T12:00:00Z'))).not.toBe(dailySeed(new Date('2026-09-18T12:00:00Z')));
  });
});

describe('WorldGenerator', () => {
  const W = new WorldGenerator('amber-lagoon-42');
  it('is deterministic per seed', () => {
    const W2 = new WorldGenerator('Amber Lagoon 42');
    expect(W2.seed).toBe(W.seed);
    expect(W2.islands.map((i) => [i.position.x, i.position.y, i.position.z, i.biome, i.name])).toEqual(W.islands.map((i) => [i.position.x, i.position.y, i.position.z, i.biome, i.name]));
    expect(W2.rings.map((r) => r.position)).toEqual(W.rings.map((r) => r.position));
    const W3 = new WorldGenerator('misty-crest-7');
    expect(W3.islands[3].position).not.toEqual(W.islands[3].position);
  });
  it('lays out a flyable course: gates spaced sensibly, gently changing height, clear of islands', () => {
    expect(W.rings.length).toBe(12);
    for (let i = 1; i < W.rings.length; i++) {
      const a = W.rings[i - 1].position, b = W.rings[i].position;
      const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
      expect(horizontal, `gate ${i} spacing`).toBeGreaterThan(40);
      expect(horizontal, `gate ${i} spacing`).toBeLessThan(200);
      expect(Math.abs(b.y - a.y), `gate ${i} climb`).toBeLessThan(horizontal * 0.25);
    }
    for (const r of W.rings) expect(W.collide(r.position, r.radius), `gate ${r.index} clear of terrain`).toBeNull();
    for (const r of W.rings) expect(r.index).toBe(W.rings.indexOf(r));
  });
  it('spawns players in open air, spread out, facing along the course', () => {
    for (let i = 0; i < 8; i++) {
      const sp = W.spawn(i);
      expect(W.collide(sp.position, 3), `spawn ${i}`).toBeNull();
      for (let j = 0; j < i; j++) {
        const o = W.spawn(j).position;
        expect(Math.hypot(sp.position.x - o.x, sp.position.y - o.y, sp.position.z - o.z), `spawns ${i}/${j}`).toBeGreaterThan(3);
      }
    }
    const sp = W.spawn(0), f = headingForward(sp.yaw, 0);
    const g0 = W.rings[0].position;
    const dx = g0.x - sp.position.x, dz = g0.z - sp.position.z, l = Math.hypot(dx, dz);
    expect((f.x * dx + f.z * dz) / l).toBeGreaterThan(0.2);
  });
  it('streams chunks around a position and tracks enter/exit', () => {
    const keys = W.chunkKeys;
    expect(keys.length).toBeGreaterThan(5);
    expect(W.islands.every((i) => keys.includes(i.chunk))).toBe(true);
    const near = W.chunksAround(W.islands[0].position, 200);
    expect(near).toContain(W.islands[0].chunk);
    const tracker = new ChunkTracker(W);
    const first = tracker.update(W.islands[0].position, 200);
    expect(first.entered.length).toBeGreaterThan(0);
    expect(first.exited).toEqual([]);
    const far = W.islands[W.islands.length - 1].position;
    const second = tracker.update({ x: far.x + 3000, y: far.y, z: far.z }, 200);
    expect(second.exited.sort()).toEqual(first.entered.sort());
    for (const key of keys) {
      const content = W.contentOf(key);
      for (const isl of content.islands) expect(isl.chunk).toBe(key);
    }
  });
  it('answers wind, collision and ground queries', () => {
    const wind = W.winds[0];
    const p = wind.points[Math.floor(wind.points.length / 2)];
    const out = { x: 0, y: 0, z: 0 };
    W.windAt(p, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeGreaterThan(0.5);
    W.windAt({ x: p.x, y: p.y + 500, z: p.z }, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeLessThan(1e-6);
    const isl = W.islands[0];
    const inside = { x: isl.position.x, y: isl.position.y + 0.5, z: isl.position.z };
    expect(W.collide(inside, 1)).not.toBeNull();
    expect(W.collide({ x: isl.position.x, y: isl.position.y + isl.height + 60, z: isl.position.z }, 1)).toBeNull();
    const g = W.groundBelow({ x: isl.position.x, y: isl.position.y + 40, z: isl.position.z });
    expect(g).not.toBeNull();
    expect(g!.island.id).toBe(isl.id);
  });
  it('builds library meshes for every decoration and island details deterministically', () => {
    const keys = new Set<string>(['ring', 'mote', 'wind-streak', 'feather', 'bird-up', 'bird-down', 'glider-0', 'glider-5', 'cloud-0', 'cloud-5']);
    for (let i = 0; i < 6; i++) for (const d of W.islandDetail(i).decorations) keys.add(d.key);
    expect(keys.size).toBeGreaterThan(12);
    for (const key of keys) {
      const g = W.library(key);
      expect(validateMesh(g.mesh), key).toEqual([]);
      expect(W.libraryKeys).toContain(key);
    }
    const d1 = W.islandDetail(2);
    W.releaseDetail(2);
    const d2 = W.islandDetail(2);
    expect(d2.decorations.map((d) => [d.key, d.position.x, d.position.z])).toEqual(d1.decorations.map((d) => [d.key, d.position.x, d.position.z]));
    expect(d1.decorations.length).toBeGreaterThan(3);
    const desc = W.describe();
    expect(desc.islands).toBe(W.islands.length);
  });
});

describe('flight helpers', () => {
  it('heading forward points -Z at rest and follows yaw/pitch', () => {
    const f = headingForward(0, 0);
    expect(f.x).toBeCloseTo(0); expect(f.y).toBeCloseTo(0); expect(f.z).toBeCloseTo(-1);
    const r = headingForward(Math.PI / 2, 0);
    expect(r.x).toBeCloseTo(-1); expect(r.z).toBeCloseTo(0);
    const up = headingForward(0, Math.PI / 4);
    expect(up.y).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(up.x, up.y, up.z)).toBeCloseTo(1);
    expect(yawFromDirection(r.x, r.z)).toBeCloseTo(Math.PI / 2);
  });
  it('banking turns, tighter when slow, none when level', () => {
    expect(bankTurnRate(0, 1.2, 30, 30)).toBe(0);
    const fast = bankTurnRate(0.6, 1.2, 60, 30), slow = bankTurnRate(0.6, 1.2, 20, 30);
    expect(fast).toBeLessThan(0);
    expect(Math.abs(slow)).toBeGreaterThan(Math.abs(fast));
    expect(bankTurnRate(-0.6, 1.2, 30, 30)).toBeCloseTo(-bankTurnRate(0.6, 1.2, 30, 30));
  });
  it('speed settles toward cruise, dives accelerate, climbs bleed speed', () => {
    const opts = { cruise: 30, stall: 14, maxSpeed: 80, boostAccel: 20 };
    let v = 30;
    for (let i = 0; i < 120; i++) v = integrateSpeed(v, 0, 1 / 60, opts);
    expect(v).toBeCloseTo(30, 1);
    expect(integrateSpeed(30, -0.5, 0.1, opts)).toBeGreaterThan(30);
    expect(integrateSpeed(30, 0.5, 0.1, opts)).toBeLessThan(30);
    expect(integrateSpeed(30, 0, 0.1, { ...opts, boosting: true })).toBeGreaterThan(31);
    expect(integrateSpeed(30, 0, 0.1, { ...opts, braking: true })).toBeLessThan(30);
    expect(integrateSpeed(200, 0, 0.1, opts)).toBe(80);
  });
  it('detects gate crossings through the ring, not around it, with direction', () => {
    const gate = { position: { x: 10, y: 5, z: -20 }, yaw: 0, radius: 6 };
    // Flying along -Z (forward at yaw 0) through the centre.
    const hit = gateCrossing({ x: 10, y: 5, z: -18 }, { x: 10, y: 5, z: -22 }, gate);
    expect(hit).not.toBeNull();
    expect(hit!.forward).toBe(true);
    expect(hit!.radial).toBeCloseTo(0);
    expect(hit!.t).toBeCloseTo(0.5);
    // Backwards through the ring.
    expect(gateCrossing({ x: 10, y: 5, z: -22 }, { x: 10, y: 5, z: -18 }, gate)!.forward).toBe(false);
    // Past the ring outside its radius, and a segment that never reaches the plane.
    expect(gateCrossing({ x: 18, y: 5, z: -18 }, { x: 18, y: 5, z: -22 }, gate)).toBeNull();
    expect(gateCrossing({ x: 10, y: 5, z: -10 }, { x: 10, y: 5, z: -15 }, gate)).toBeNull();
    // A rotated gate.
    const g2 = { position: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2, radius: 6 };
    expect(gateCrossing({ x: 2, y: 1, z: 0 }, { x: -2, y: 1, z: 0 }, g2)!.forward).toBe(true);
  });
  it('bounces off surfaces by reflecting the velocity', () => {
    const vel = { x: 0, y: -10, z: -30 };
    const fwd = headingForward(0, -0.3);
    const b = bounceHeading(vel, fwd, { x: 0, y: 1, z: 0 });
    expect(b).not.toBeNull();
    expect(b!.pitch).toBeGreaterThan(0);
    expect(bounceHeading({ x: 0, y: 10, z: 0 }, fwd, { x: 0, y: 1, z: 0 })).toBeNull();
  });
});
