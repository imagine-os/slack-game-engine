// A small flock of birds circling an island: classic boids (separation,
// alignment, cohesion) pulled toward an orbit around the anchor, with a
// scatter impulse when a glider passes close. Wing flap = swapping between two
// generated poses.
function pg(ctx) { return ctx.engine.procgen || null; }

defineScript({
  name: 'Flock',
  description: 'Boids circling an island; scatter when a glider passes.',
  props: {
    count: { type: 'integer', default: 7, min: 1, max: 30 },
    radius: { type: 'number', default: 18, min: 3, max: 100 },
    speed: { type: 'number', default: 9, min: 1, max: 40 },
    meshPrefix: { type: 'string', default: '' },
  },
  onStart(ctx) {
    const s = ctx.state, P = pg(ctx);
    s.birds = [];
    if (!P || !P.world) return;
    const W = P.world;
    const poses = ['up', 'down'].map((pose) => P.registered(`${ctx.props.meshPrefix}bird-${pose}`) || P.registerGenerated(`${ctx.props.meshPrefix}bird-${pose}`, W.library(`bird-${pose}`)));
    const c = ctx.transform.position;
    const rng = new ctx.math.Random((Math.abs(c.x * 13 + c.z * 7) | 0) + 1);
    for (let i = 0; i < ctx.props.count; i++) {
      const a = rng.range(0, Math.PI * 2), r = ctx.props.radius * rng.range(0.6, 1);
      const e = ctx.world.createEntity('Bird');
      const t = ctx.getOn(e, 'Transform');
      t.setPosition(c.x + Math.cos(a) * r, c.y + rng.range(-3, 3), c.z + Math.sin(a) * r);
      t.setScale(0.9, 0.9, 0.9);
      const parts = [];
      for (const g of poses[0].groups) {
        const ce = ctx.world.createEntity(g.name);
        ctx.world.setParent(ce, e);
        const mr = ctx.world.addComponentByType(ce, 'MeshRenderer', { mesh: g.mesh });
        P.applyMaterial(mr, g);
        parts.push({ mr, name: g.name });
      }
      s.birds.push({ e, t, parts, v: { x: -Math.sin(a) * ctx.props.speed, y: 0, z: Math.cos(a) * ctx.props.speed }, flap: rng.range(0, 1), flapRate: rng.range(5, 8), pose: 0, scare: 0 });
    }
    s.poses = poses;
    s.look = new ctx.math.Vec3();
  },
  onDestroy(ctx) { for (const b of ctx.state.birds || []) if (ctx.world.isAlive(b.e)) ctx.destroy(b.e); },
  onUpdate(ctx, dt) {
    const s = ctx.state;
    if (!s.birds || !s.birds.length) return;
    const dtc = Math.min(dt, 0.05);
    const c = ctx.transform.position, R = ctx.props.radius, V = ctx.props.speed;
    // Nearest glider (any peer) for the scatter reaction.
    let threat = null, td = 1e9;
    for (const g of ctx.findAll('glider')) {
      const gt = ctx.getOn(g, 'Transform');
      const d = Math.hypot(gt.x - c.x, gt.y - c.y, gt.z - c.z);
      if (d < td) { td = d; threat = gt; }
    }
    const birds = s.birds;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i], p = b.t.position;
      let ax = 0, ay = 0, az = 0;
      let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, n = 0;
      for (let j = 0; j < birds.length; j++) {
        if (i === j) continue;
        const o = birds[j].t.position;
        const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 9) { const k = 2.5 / Math.max(0.2, d2); ax += dx * k; ay += dy * k; az += dz * k; }
        if (d2 < 400) { cx += o.x; cy += o.y; cz += o.z; vx += birds[j].v.x; vy += birds[j].v.y; vz += birds[j].v.z; n++; }
      }
      if (n) {
        ax += ((cx / n) - p.x) * 0.25; ay += ((cy / n) - p.y) * 0.25; az += ((cz / n) - p.z) * 0.25;
        ax += ((vx / n) - b.v.x) * 0.6; ay += ((vy / n) - b.v.y) * 0.6; az += ((vz / n) - b.v.z) * 0.6;
      }
      // Orbit the anchor: pull toward the ring of radius R and along its tangent.
      const rx = p.x - c.x, rz = p.z - c.z, rl = Math.hypot(rx, rz) || 1;
      const ring = (R - rl) * 0.9;
      ax += (rx / rl) * ring - (rz / rl) * V * 0.5; az += (rz / rl) * ring + (rx / rl) * V * 0.5;
      ay += (c.y + Math.sin(ctx.time.elapsed * 0.3 + i) * 3 - p.y) * 0.6;
      if (threat) {
        const dx = p.x - threat.x, dy = p.y - threat.y, dz = p.z - threat.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 14) { const k = (14 - d) * 6 / Math.max(1, d); ax += dx * k; ay += dy * k + 8; az += dz * k; b.scare = 1.5; }
      }
      b.scare = Math.max(0, b.scare - dtc);
      b.v.x += ax * dtc; b.v.y += ay * dtc; b.v.z += az * dtc;
      const sp = Math.hypot(b.v.x, b.v.y, b.v.z) || 1;
      const target = V * (1 + b.scare * 0.8);
      const k = target / sp;
      b.v.x *= k; b.v.y *= k; b.v.z *= k;
      b.t.position.x += b.v.x * dtc; b.t.position.y += b.v.y * dtc; b.t.position.z += b.v.z * dtc;
      b.t.markDirty();
      b.t.updateWorldMatrix();
      b.t.lookAt(s.look.set(p.x + b.v.x, p.y + b.v.y * 0.5, p.z + b.v.z));
      b.flap += dtc * b.flapRate * (1 + b.scare);
      const pose = Math.floor(b.flap) % 2;
      if (pose !== b.pose) {
        b.pose = pose;
        for (const part of b.parts) { const g = s.poses[pose].groups.find((x) => x.name === part.name); if (g) part.mr.mesh = g.mesh; }
      }
    }
  },
});
