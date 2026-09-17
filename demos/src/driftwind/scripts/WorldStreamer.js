// Builds the archipelago from the world seed with the procgen plugin
// (ctx.engine.procgen), registers generated meshes on the renderer and streams
// islands, decorations, clouds, gate rings and motes in chunks around the
// player. Also animates lanterns, motes, turbine blades and wind streaks.
function pg(ctx) { return ctx.engine.procgen || null; }

const SMALL_PROPS = new Set(['rock', 'crystal', 'stone-lantern', 'lantern', 'windsock', 'column', 'mote']);
function rgba(c) { return { r: c.r, g: c.g, b: c.b, a: 1 }; }

defineScript({
  name: 'WorldStreamer',
  description: 'Generates and streams the procedural archipelago for a seed.',
  props: {
    seed: { type: 'string', default: 'amber-lagoon-42', label: 'World seed' },
    streamRadius: { type: 'number', default: 520, min: 100, max: 2000 },
    lodDistance: { type: 'number', default: 260, min: 50, max: 2000 },
    islands: { type: 'integer', default: 40, min: 4, max: 120 },
    detail: { type: 'boolean', default: true, label: 'Trees, rocks and props' },
  },
  onStart(ctx) {
    const s = ctx.state;
    const P = pg(ctx);
    s.loaded = {}; s.anim = []; s.streaks = []; s.islandLods = []; s.ready = false; s.flocks = []; s.pending = [];
    s.tmpQ = new ctx.math.Quat();
    if (!P) {
      ctx.warn('Driftwind needs the procgen plugin (engine.use(procgenPlugin)); the world will be empty.');
      return;
    }
    const seed = P.env.param('seed') || (P.env.param('daily') ? P.seeds.dailySeed() : ctx.props.seed);
    this.build(ctx, seed);
    s.tick = ctx.timer(0.4, () => this.stream(ctx), true);
  },
  onDestroy(ctx) { this.unloadAll(ctx); },

  /** (Re)create the world for a seed: world object, shared registrations, wind streaks. */
  build(ctx, seed) {
    const s = ctx.state, P = pg(ctx);
    this.unloadAll(ctx);
    const W = P.world && P.world.seed === P.seeds.normalizeSeed(seed) ? P.world : P.createWorld(seed, { islands: ctx.props.islands });
    P.world = W;
    s.world = W;
    s.tracker = P.createTracker(W);
    const oldPrefix = s.prefix;
    s.prefix = `${W.seed}:`;
    // Free the previous seed's GPU meshes once every script has re-pointed at the new ones
    // (gliders, ghosts and speed streaks swap their meshes on the same `worldSeed` message).
    if (oldPrefix && oldPrefix !== s.prefix) ctx.timer(1, () => { if (ctx.state.prefix !== oldPrefix) P.unregisterPrefix(oldPrefix); });
    // Wind currents are global: a trail of translucent streaks that flow along each spline.
    const streakDesc = this.reg(ctx, 'wind-streak');
    for (const wind of W.winds) {
      let length = 0;
      for (let i = 1; i < wind.points.length; i++) length += dist(wind.points[i], wind.points[i - 1]);
      const n = Math.max(6, Math.round(length / 3.2));
      for (let k = 0; k < n; k++) {
        const e = this.spawnObject(ctx, 'Wind Streak', streakDesc, wind.points[0], 0, 1, null);
        const off = { x: (hash(k * 7 + wind.id) - 0.5) * wind.radius * 1.4, y: (hash(k * 13 + 3) - 0.5) * wind.radius * 1.2, z: (hash(k * 17 + 5) - 0.5) * wind.radius * 1.4 };
        s.streaks.push({ entity: e, t: ctx.getOn(e, 'Transform'), wind, s: (k / n) * length, length, off, speed: wind.strength * 0.9 });
      }
    }
    this.spawnSea(ctx);
    // Global wind for foliage sway follows the first wind current's heading.
    const r = ctx.engine.renderer;
    if (r && r.wind && W.winds.length) {
      const w0 = W.winds[0].points, a = w0[0], b = w0[Math.min(3, w0.length - 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      r.wind.direction.set(dx / l, 0, dz / l);
      r.wind.strength = 1;
    }
    s.ready = true;
    this.stream(ctx);
  },

  /** Register a library key under the world's prefix (idempotent). */
  reg(ctx, key) {
    const P = pg(ctx), s = ctx.state;
    const name = s.prefix + key;
    return P.registered(name) || P.registerGenerated(name, s.world.library(key));
  },

  /**
   * Entity for a generated object. On a vertex-colour renderer the plain lit
   * groups share one merged mesh (`desc.base`) and only emissive, transparent,
   * wind or water groups get their own child; otherwise one child per colour
   * group carries the palette colour. `opts.hideAt` hides the object beyond a
   * distance through `MeshRenderer.lods`; `opts.castShadow` overrides shadows.
   */
  spawnObject(ctx, name, desc, position, yaw, scale, tag, parent, opts) {
    const w = ctx.world, P = pg(ctx), F = P.features;
    const e = w.createEntity(name);
    const t = w.getComponent(e, 'Transform');
    t.setPosition(position.x, position.y, position.z);
    t.setEuler(0, yaw, 0);
    t.setScale(scale, scale, scale);
    if (tag) w.addComponentByType(e, 'Tag', { tags: [tag] });
    if (parent !== undefined) w.setParent(e, parent);
    const parts = F.vertexColors && desc.base ? [desc.base].concat(desc.special) : desc.groups;
    for (const g of parts) {
      const c = w.createEntity(g.name);
      w.setParent(c, e);
      const mr = w.addComponentByType(c, 'MeshRenderer', { mesh: g.mesh });
      P.applyMaterial(mr, g);
      if (opts && opts.castShadow !== undefined && F.shadows) mr.castShadow = opts.castShadow;
      if (opts && opts.hideAt && F.lods) mr.lods = [{ mesh: '', distance: opts.hideAt / Math.max(0.05, scale) }];
      if (g.water && F.water) {
        // Ponds on islands: the stylised water material replaces the flat colour.
        const pal = P.palettes.PALETTES[(opts && opts.biome) || this.biomeOf(ctx, position)];
        mr.castShadow = false;
        w.addComponentByType(c, 'WaterMaterial', {
          deepColor: rgba(P.builder.shade(pal.water, 0.7)), shallowColor: rgba(pal.water), foamColor: rgba(pal.foam),
          waveAmplitude: 0.03, waveLength: 1.6, waveSpeed: 0.5, waveSteepness: 0.1, crestFoam: 0.9, fresnel: 0.35, specular: 0.7, opacity: 0.9, flatShading: true,
        });
      }
    }
    return e;
  },

  biomeOf(ctx, position) {
    const W = ctx.state.world;
    const hit = W && W.nearestIsland(position);
    return hit ? hit.island.biome : (W ? W.primaryBiome : 'meadow');
  },

  /** The sea: a large water plane far below the islands that follows the player (waves are world-space, so moving it is seamless). */
  spawnSea(ctx) {
    const s = ctx.state, P = pg(ctx), W = s.world;
    if (!P.features.water || !P.features.vertexColors) return;
    const name = `${s.prefix}sea`;
    if (!P.registered(name)) {
      const n = 64, size = 7000, pos = [], nrm = [], col = [], idx = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        pos.push((i / n - 0.5) * size, 0, (j / n - 0.5) * size); nrm.push(0, 1, 0); col.push(0, 0, 0);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + n + 1;
        if ((i + j) % 2 === 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
      const positions = new Float32Array(pos);
      const mesh = { positions, normals: new Float32Array(nrm), colors: new Float32Array(col), indices: new Uint16Array(idx), bounds: P.builder.meshBounds(positions) };
      P.registerGenerated(name, { mesh, groups: [{ name: 'sea', color: { r: 1, g: 1, b: 1 }, data: mesh, triangles: idx.length / 3, water: true }] });
    }
    const pal = P.palettes.PALETTES[W.primaryBiome];
    const e = ctx.world.createEntity('Sea');
    s.seaY = W.bounds.seaLevel !== undefined ? W.bounds.seaLevel : W.bounds.minY - 130;
    const t = ctx.getOn(e, 'Transform');
    t.setPosition(0, s.seaY, 0);
    const mr = ctx.world.addComponentByType(e, 'MeshRenderer', { mesh: name, castShadow: false, frustumCulled: false });
    mr.color.set(1, 1, 1, 1);
    const B = P.builder;
    ctx.world.addComponentByType(e, 'WaterMaterial', {
      // Deep, saturated blue-teal; a touch of the biome's water colour keeps worlds distinct. The shader
      // desaturates the golden-hour sun for water and fogStrength/fogTint keep the warm haze from washing it out.
      deepColor: rgba(B.mixRGB(B.rgb('#062f5c'), pal.water, 0.15)), shallowColor: rgba(B.mixRGB(B.rgb('#1690b8'), pal.water, 0.28)), foamColor: rgba(B.mixRGB(pal.foam, B.rgb('#ffffff'), 0.5)),
      waveAmplitude: 1.1, waveLength: 34, waveSpeed: 0.55, waveSteepness: 0.22, crestFoam: 0.84, fresnel: 0.55, specular: 1.35, opacity: 1, flatShading: false,
      fogStrength: 0.55, fogTint: { r: 0.6, g: 0.82, b: 1, a: 1 },
    });
    s.sea = { entity: e, t };
  },

  /** Flat unit-radius disc on the sea surface (fake island reflection / shadow, waterfall splash). */
  spawnSeaDisc(ctx, key, x, z, radius, lift) {
    const s = ctx.state;
    const e = this.spawnObject(ctx, key, this.reg(ctx, key), { x, y: s.seaY + lift, z }, 0, 1, null, undefined, { castShadow: false });
    ctx.getOn(e, 'Transform').setScale(radius, 1, radius);
    return e;
  },

  focus(ctx) {
    for (const e of ctx.findAll('glider')) {
      const pi = ctx.getOn(e, 'PlayerInput');
      if (pi && (pi.owner === 'local' || pi.owner === ctx.net.localId)) return ctx.getOn(e, 'Transform').position;
    }
    const cam = ctx.find('Camera');
    return cam ? ctx.getOn(cam, 'Transform').position : { x: 0, y: 50, z: 0 };
  },

  /**
   * Load/unload chunks around the focus and switch island LODs. Entered chunks are queued
   * (nearest first) and drained by `onUpdate` under a time budget, so a seed change or the
   * first load never blocks the main thread for seconds (which would starve the network
   * heartbeats and get a guest dropped from the room); only the chunk under the focus loads
   * synchronously so the world beneath the player is never empty.
   */
  stream(ctx) {
    const s = ctx.state, W = s.world;
    if (!s.ready) return;
    const pos = this.focus(ctx);
    const { entered, exited } = s.tracker.update(pos, ctx.props.streamRadius);
    for (const key of exited) { this.unloadChunk(ctx, key); const i = s.pending.indexOf(key); if (i >= 0) s.pending.splice(i, 1); }
    for (const key of entered) if (!s.pending.includes(key)) s.pending.push(key);
    const here = W.chunkKey(pos.x, pos.z);
    const hi = s.pending.indexOf(here);
    if (hi >= 0) { s.pending.splice(hi, 1); this.loadChunk(ctx, here); }
    const cs = W.chunkSize;
    const d2 = (key) => { const [cx, cz] = key.split(',').map(Number); const x = (cx + 0.5) * cs - pos.x, z = (cz + 0.5) * cs - pos.z; return x * x + z * z; };
    s.pending.sort((a, b) => d2(a) - d2(b));
    if (s.sea) s.sea.t.setPosition(Math.round(pos.x / 100) * 100, s.seaY, Math.round(pos.z / 100) * 100);
    const lodD2 = ctx.props.lodDistance * ctx.props.lodDistance;
    for (const isl of s.islandLods) {
      const dx = isl.position.x - pos.x, dz = isl.position.z - pos.z;
      const far = dx * dx + dz * dz > lodD2;
      if (far !== isl.far) {
        isl.far = far;
        for (const mr of isl.hi) mr.visible = !far;
        for (const mr of isl.lo) mr.visible = far;
      }
    }
  },

  /** Load queued chunks for at most `budgetMs` of wall-clock time (at least one per call). */
  drain(ctx, budgetMs) {
    const s = ctx.state, P = pg(ctx);
    if (!s.pending.length) return;
    const start = P.env.now();
    do {
      const key = s.pending.shift();
      if (s.tracker.active.has(key) && !s.loaded[key]) this.loadChunk(ctx, key);
    } while (s.pending.length && P.env.now() - start < budgetMs);
  },

  loadChunk(ctx, key) {
    const s = ctx.state, W = s.world;
    if (s.loaded[key]) return;
    const content = W.contentOf(key);
    const chunk = { entities: [], anim: [], lods: [], flocks: [] };
    s.loaded[key] = chunk;
    for (const isl of content.islands) this.spawnIsland(ctx, isl, chunk);
    for (const cloud of content.clouds) {
      const e = this.spawnObject(ctx, `Cloud ${cloud.id}`, this.reg(ctx, cloud.key), cloud.position, cloud.yaw, cloud.scale, 'cloud', undefined, { castShadow: false });
      for (const c of ctx.world.getChildren(e)) { const mr = ctx.getOn(c, 'MeshRenderer'); if (mr) { mr.flatShading = false; mr.roughness = 1; } }
      chunk.entities.push(e);
      const rec = { kind: 'drift', t: ctx.getOn(e, 'Transform'), base: cloud.position, speed: cloud.drift, phase: cloud.id };
      chunk.anim.push(rec); s.anim.push(rec);
    }
    for (const ring of content.rings) {
      const desc = this.reg(ctx, 'ring');
      const e = this.spawnObject(ctx, `Gate ${ring.index + 1}`, desc, ring.position, ring.yaw, ring.radius / 6, 'ring');
      ctx.world.addComponentByType(e, 'Script', { script: 'Ring', props: { index: ring.index } });
      chunk.entities.push(e);
      // Lantern trail lining the approach.
      if (ring.lanterns && ctx.props.detail) {
        const lanternDesc = this.reg(ctx, `lantern-${W.primaryBiome}`);
        ring.lanterns.forEach((p, k) => {
          const le = this.spawnObject(ctx, 'Trail Lantern', lanternDesc, p, ring.yaw, 0.8, null, undefined, { hideAt: 480, castShadow: false });
          chunk.entities.push(le);
          const rec = { kind: 'bob', t: ctx.getOn(le, 'Transform'), base: p, phase: k * 0.9 + ring.index, speed: 1 };
          chunk.anim.push(rec); s.anim.push(rec);
        });
      }
    }
  },

  spawnIsland(ctx, spec, chunk) {
    const s = ctx.state, P = pg(ctx), W = s.world;
    const detail = W.islandDetail(spec.id);
    const hiDesc = P.registered(`${s.prefix}island-${spec.id}`) || P.registerGenerated(`${s.prefix}island-${spec.id}`, detail.island);
    const loDesc = P.registered(`${s.prefix}island-${spec.id}-lod`) || P.registerGenerated(`${s.prefix}island-${spec.id}-lod`, detail.lod);
    const root = this.spawnObject(ctx, spec.name, hiDesc, spec.position, 0, 1, 'island', undefined, { biome: spec.biome });
    ctx.world.addComponentByType(root, 'Script', { script: 'Island', props: { id: spec.id, name: spec.name, biome: spec.biome, radius: spec.radius } });
    const hi = [], lo = [];
    for (const c of ctx.world.getChildren(root)) { const mr = ctx.getOn(c, 'MeshRenderer'); if (mr) hi.push(mr); }
    const lodRoot = this.spawnObject(ctx, `${spec.name} (far)`, loDesc, spec.position, 0, 1, null, undefined, { biome: spec.biome });
    for (const c of ctx.world.getChildren(lodRoot)) { const mr = ctx.getOn(c, 'MeshRenderer'); if (mr) { mr.visible = false; lo.push(mr); } }
    const lod = { position: spec.position, hi, lo, far: false };
    chunk.entities.push(root, lodRoot);
    chunk.lods.push(lod); s.islandLods.push(lod);
    if (s.sea) {
      // Fake reflection: a dark disc on the sea under the island; waterfalls continue as long ribbons down to a splash.
      chunk.entities.push(this.spawnSeaDisc(ctx, 'sea-shade', spec.position.x, spec.position.z, spec.radius * 1.15, 0.6));
      if (detail.island.waterfalls && detail.island.waterfalls.length && (spec.landmark || (spec.radius >= 20 && spec.crownOf === undefined && spec.id % 3 === 0))) {
        const fallDesc = this.reg(ctx, 'waterfall');
        for (const a of detail.island.waterfalls) {
          const top = { x: spec.position.x + a.x, y: spec.position.y + a.y - 0.5, z: spec.position.z + a.z };
          const drop = top.y - s.seaY;
          if (drop <= 0) continue;
          const fe = this.spawnObject(ctx, 'Waterfall', fallDesc, top, Math.atan2(a.x, a.z), 1, null, undefined, { castShadow: false, hideAt: 460 });
          ctx.getOn(fe, 'Transform').setScale(spec.landmark ? 1.5 : 1, drop, spec.landmark ? 1.5 : 1);
          chunk.entities.push(fe);
          chunk.entities.push(this.spawnSeaDisc(ctx, 'sea-splash', top.x, top.z, spec.landmark ? 3.5 : 2.2, 0.9));
        }
      }
    }
    if (ctx.props.detail) {
      for (const d of detail.decorations) {
        const small = SMALL_PROPS.has(d.kind);
        const e = this.spawnObject(ctx, d.kind, this.reg(ctx, d.key), d.position, d.yaw, d.scale, null, undefined, { hideAt: small ? 320 : 460, castShadow: small ? false : undefined });
        chunk.entities.push(e);
        if (d.animate && d.animate !== 'sway') {
          const rec = { kind: d.animate, t: ctx.getOn(e, 'Transform'), base: d.position, yaw: d.yaw, phase: d.position.x * 0.37 + d.position.z * 0.11, speed: d.kind === 'turbine-blades' ? 1.6 : 1 };
          chunk.anim.push(rec); s.anim.push(rec);
        }
      }
      const moteDesc = this.reg(ctx, 'mote');
      for (const m of detail.motes) {
        const e = this.spawnObject(ctx, 'Mote', moteDesc, m, 0, 1, 'mote', undefined, { hideAt: 260, castShadow: false });
        chunk.entities.push(e);
        const rec = { kind: 'mote', t: ctx.getOn(e, 'Transform'), base: m, phase: m.x * 0.5 + m.y, speed: 1 };
        chunk.anim.push(rec); s.anim.push(rec);
      }
      if (detail.flock) {
        const fe = ctx.world.createEntity(`Flock ${spec.name}`);
        ctx.getOn(fe, 'Transform').setPosition(detail.flock.center.x, detail.flock.center.y, detail.flock.center.z);
        ctx.world.addComponentByType(fe, 'Script', { script: 'Flock', props: { count: detail.flock.count, radius: detail.flock.radius, meshPrefix: s.prefix } });
        chunk.entities.push(fe);
      }
    }
  },

  unloadChunk(ctx, key) {
    const s = ctx.state;
    const chunk = s.loaded[key];
    if (!chunk) return;
    delete s.loaded[key];
    for (const e of chunk.entities) if (ctx.world.isAlive(e)) ctx.destroy(e);
    if (chunk.anim.length) s.anim = s.anim.filter((a) => !chunk.anim.includes(a));
    if (chunk.lods.length) s.islandLods = s.islandLods.filter((l) => !chunk.lods.includes(l));
  },

  unloadAll(ctx) {
    const s = ctx.state;
    if (s.loaded) for (const key of Object.keys(s.loaded)) this.unloadChunk(ctx, key);
    if (s.streaks) for (const st of s.streaks) if (ctx.world.isAlive(st.entity)) ctx.destroy(st.entity);
    if (s.sea && ctx.world.isAlive(s.sea.entity)) ctx.destroy(s.sea.entity);
    s.sea = null;
    s.loaded = {}; s.anim = []; s.streaks = []; s.islandLods = []; s.pending = [];
    if (s.tracker) s.tracker.clear();
  },

  onMessage(ctx, name, data) {
    if (name === 'worldSeed') {
      const P = pg(ctx);
      if (!P) return;
      const seed = P.seeds.normalizeSeed(data.seed);
      if (ctx.state.world && ctx.state.world.seed === seed) return;
      this.build(ctx, seed);
    }
  },

  onUpdate(ctx, dt) {
    const s = ctx.state;
    if (!s.ready) return;
    this.drain(ctx, 6);
    const time = ctx.time.elapsed;
    for (const a of s.anim) {
      const t = a.t;
      switch (a.kind) {
        case 'bob': t.position.y = a.base.y + Math.sin(time * 0.7 + a.phase) * 0.6; t.markDirty(); break;
        case 'mote': t.position.y = a.base.y + Math.sin(time * 1.6 + a.phase) * 0.35; t.setEuler(0, time * 1.2 + a.phase, 0); break;
        case 'spin': t.rotation.setAxisAngle(UP_AXIS, a.yaw); t.rotation.multiply(s.tmpQ.setAxisAngle(FWD_AXIS, time * a.speed)); t.markDirty(); break;
        case 'drift': t.position.x = a.base.x + Math.sin(time * 0.02 * a.speed + a.phase) * 25; t.markDirty(); break;
      }
    }
    for (const st of s.streaks) {
      st.s += st.speed * dt;
      if (st.s > st.length) st.s -= st.length;
      const p = pointOn(st.wind.points, st.s);
      st.t.setPosition(p.x + st.off.x, p.y + st.off.y, p.z + st.off.z);
      const q = pointOn(st.wind.points, Math.min(st.length, st.s + 2));
      st.t.updateWorldMatrix();
      st.t.lookAt(new ctx.math.Vec3(q.x + st.off.x, q.y + st.off.y, q.z + st.off.z));
    }
  },
});

const UP_AXIS = { x: 0, y: 1, z: 0 };
const FWD_AXIS = { x: 0, y: 0, z: 1 };
function hash(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function pointOn(points, s) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i], points[i - 1]);
    if (acc + d >= s) { const f = d > 0 ? (s - acc) / d : 0; const a = points[i - 1], b = points[i]; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }; }
    acc += d;
  }
  return points[points.length - 1];
}
