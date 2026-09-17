// Builds the archipelago from the world seed with the procgen plugin
// (ctx.engine.procgen), registers generated meshes on the renderer and streams
// islands, decorations, clouds, gate rings and motes in chunks around the
// player. Also animates lanterns, motes, turbine blades and wind streaks.
function pg(ctx) { return ctx.engine.procgen || null; }

defineScript({
  name: 'WorldStreamer',
  description: 'Generates and streams the procedural archipelago for a seed.',
  props: {
    seed: { type: 'string', default: 'amber-lagoon-42', label: 'World seed' },
    streamRadius: { type: 'number', default: 520, min: 100, max: 2000 },
    lodDistance: { type: 'number', default: 260, min: 50, max: 2000 },
    islands: { type: 'integer', default: 34, min: 4, max: 120 },
    detail: { type: 'boolean', default: true, label: 'Trees, rocks and props' },
  },
  onStart(ctx) {
    const s = ctx.state;
    const P = pg(ctx);
    s.loaded = {}; s.anim = []; s.streaks = []; s.islandLods = []; s.ready = false; s.flocks = [];
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
    s.prefix = `${W.seed}:`;
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
    s.ready = true;
    this.stream(ctx);
  },

  /** Register a library key under the world's prefix (idempotent). */
  reg(ctx, key) {
    const P = pg(ctx), s = ctx.state;
    const name = s.prefix + key;
    return P.registered(name) || P.registerGenerated(name, s.world.library(key));
  },

  /** Entity with one MeshRenderer per colour group (or one coloured mesh when the renderer supports vertex colours). */
  spawnObject(ctx, name, desc, position, yaw, scale, tag, parent) {
    const w = ctx.world, P = pg(ctx);
    const e = w.createEntity(name);
    const t = w.getComponent(e, 'Transform');
    t.setPosition(position.x, position.y, position.z);
    t.setEuler(0, yaw, 0);
    t.setScale(scale, scale, scale);
    if (tag) w.addComponentByType(e, 'Tag', { tags: [tag] });
    if (parent !== undefined) w.setParent(e, parent);
    if (P.features.vertexColors) {
      const mr = w.addComponentByType(e, 'MeshRenderer', { mesh: desc.mesh });
      mr.color.set(1, 1, 1, 1);
      if ('flatShading' in mr) mr.flatShading = true;
    } else {
      for (const g of desc.groups) {
        const c = w.createEntity(g.name);
        w.setParent(c, e);
        const mr = w.addComponentByType(c, 'MeshRenderer', { mesh: g.mesh });
        P.applyMaterial(mr, g);
      }
    }
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

  /** Load/unload chunks around the focus and switch island LODs. */
  stream(ctx) {
    const s = ctx.state;
    if (!s.ready) return;
    const pos = this.focus(ctx);
    const { entered, exited } = s.tracker.update(pos, ctx.props.streamRadius);
    for (const key of exited) this.unloadChunk(ctx, key);
    for (const key of entered) this.loadChunk(ctx, key);
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

  loadChunk(ctx, key) {
    const s = ctx.state, W = s.world;
    const content = W.contentOf(key);
    const chunk = { entities: [], anim: [], lods: [], flocks: [] };
    s.loaded[key] = chunk;
    for (const isl of content.islands) this.spawnIsland(ctx, isl, chunk);
    for (const cloud of content.clouds) {
      const e = this.spawnObject(ctx, `Cloud ${cloud.id}`, this.reg(ctx, cloud.key), cloud.position, cloud.yaw, cloud.scale, 'cloud');
      chunk.entities.push(e);
      const rec = { kind: 'drift', t: ctx.getOn(e, 'Transform'), base: cloud.position, speed: cloud.drift, phase: cloud.id };
      chunk.anim.push(rec); s.anim.push(rec);
    }
    for (const ring of content.rings) {
      const desc = this.reg(ctx, 'ring');
      const e = this.spawnObject(ctx, `Gate ${ring.index + 1}`, desc, ring.position, ring.yaw, ring.radius / 6, 'ring');
      ctx.world.addComponentByType(e, 'Script', { script: 'Ring', props: { index: ring.index } });
      chunk.entities.push(e);
    }
  },

  spawnIsland(ctx, spec, chunk) {
    const s = ctx.state, P = pg(ctx), W = s.world;
    const detail = W.islandDetail(spec.id);
    const hiDesc = P.registered(`${s.prefix}island-${spec.id}`) || P.registerGenerated(`${s.prefix}island-${spec.id}`, detail.island);
    const loDesc = P.registered(`${s.prefix}island-${spec.id}-lod`) || P.registerGenerated(`${s.prefix}island-${spec.id}-lod`, detail.lod);
    const root = this.spawnObject(ctx, spec.name, hiDesc, spec.position, 0, 1, 'island');
    ctx.world.addComponentByType(root, 'Script', { script: 'Island', props: { id: spec.id, name: spec.name, biome: spec.biome, radius: spec.radius } });
    const hi = [], lo = [];
    for (const c of ctx.world.getChildren(root)) { const mr = ctx.getOn(c, 'MeshRenderer'); if (mr) hi.push(mr); }
    const lodRoot = this.spawnObject(ctx, `${spec.name} (far)`, loDesc, spec.position, 0, 1, null);
    for (const c of ctx.world.getChildren(lodRoot)) { const mr = ctx.getOn(c, 'MeshRenderer'); if (mr) { mr.visible = false; lo.push(mr); } }
    const lod = { position: spec.position, hi, lo, far: false };
    chunk.entities.push(root, lodRoot);
    chunk.lods.push(lod); s.islandLods.push(lod);
    if (ctx.props.detail) {
      for (const d of detail.decorations) {
        const e = this.spawnObject(ctx, d.kind, this.reg(ctx, d.key), d.position, d.yaw, d.scale, null);
        chunk.entities.push(e);
        if (d.animate && d.animate !== 'sway') {
          const rec = { kind: d.animate, t: ctx.getOn(e, 'Transform'), base: d.position, yaw: d.yaw, phase: d.position.x * 0.37 + d.position.z * 0.11, speed: d.kind === 'turbine-blades' ? 1.6 : 1 };
          chunk.anim.push(rec); s.anim.push(rec);
        }
      }
      const moteDesc = this.reg(ctx, 'mote');
      for (const m of detail.motes) {
        const e = this.spawnObject(ctx, 'Mote', moteDesc, m, 0, 1, 'mote');
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
    s.loaded = {}; s.anim = []; s.streaks = []; s.islandLods = [];
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
