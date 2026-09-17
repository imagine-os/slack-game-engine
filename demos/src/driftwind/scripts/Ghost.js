// Replays a recorded race run (positions + rotations sampled every 0.1 s) as
// a translucent glider, so you race your own best time.
function pg(ctx) { return ctx.engine.procgen || null; }

defineScript({
  name: 'Ghost',
  description: 'Translucent replay of the best run for this seed.',
  props: {
    path: { type: 'json', default: [] },
    interval: { type: 'number', default: 0.1 },
    livery: { type: 'integer', default: 0 },
  },
  onStart(ctx) {
    const s = ctx.state, P = pg(ctx);
    s.t = 0; s.playing = false;
    const W = P && P.world;
    if (P && W) {
      const key = `${W.seed}:glider-${ctx.props.livery % 6}`;
      const desc = P.registered(key) || P.registerGenerated(key, W.library(`glider-${ctx.props.livery % 6}`));
      for (const g of desc.groups) {
        const c = ctx.world.createEntity(g.name);
        ctx.world.setParent(c, ctx.entity);
        const mr = ctx.world.addComponentByType(c, 'MeshRenderer', { mesh: g.mesh });
        P.applyMaterial(mr, g);
        mr.opacity = 0.3;
        mr.color.set(0.7, 0.9, 1, 1);
        mr.emissive.set(0.25, 0.45, 0.6, 1);
      }
    }
    s.qa = new ctx.math.Quat(); s.qb = new ctx.math.Quat();
    this.apply(ctx, 0);
  },
  onMessage(ctx, name, data) {
    if (name === 'raceState') {
      if (data.phase === 'running') { ctx.state.t = ctx.time.elapsed - data.startAt; ctx.state.playing = true; ctx.state.startAt = data.startAt; }
      else if (data.phase === 'idle') ctx.destroy();
    }
  },
  apply(ctx, time) {
    const path = ctx.props.path;
    if (!path || path.length === 0) return;
    const f = time / ctx.props.interval;
    const i = Math.min(path.length - 1, Math.max(0, Math.floor(f)));
    const j = Math.min(path.length - 1, i + 1);
    const k = Math.min(1, Math.max(0, f - i));
    const a = path[i], b = path[j];
    const t = ctx.transform;
    t.setPosition(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    const s = ctx.state;
    s.qa.set(a[3], a[4], a[5], a[6]); s.qb.set(b[3], b[4], b[5], b[6]);
    s.qa.slerp(s.qb, k);
    t.rotation.copy(s.qa);
    t.markDirty();
    for (const c of ctx.world.getChildren(ctx.entity)) { const mr = ctx.getOn(c, 'MeshRenderer'); if (mr) mr.visible = f < path.length + 5; }
  },
  onUpdate(ctx) {
    const s = ctx.state;
    if (!s.playing) return;
    this.apply(ctx, ctx.time.elapsed - s.startAt);
  },
});
