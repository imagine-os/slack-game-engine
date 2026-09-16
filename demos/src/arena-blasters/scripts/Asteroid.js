// Drifting rock that splits into smaller rocks when destroyed. The polygon
// outline is generated from `seed`, so every peer draws the same shape.
function despawn(ctx, e) {
  const sync = ctx.net.hub.sync;
  if (sync && ctx.net.isHost) sync.despawn(e); else ctx.destroy(e);
}

defineScript({
  name: 'Asteroid',
  description: 'Wrapping asteroid that splits when shot.',
  props: {
    size: { type: 'integer', default: 3, min: 1, max: 3, label: 'Size (3 = large)' },
    seed: { type: 'integer', default: 1 },
    unitRadius: { type: 'number', default: 0.45, label: 'Radius per size step' },
  },
  onStart(ctx) {
    const size = ctx.props.size;
    const r = size * ctx.props.unitRadius;
    ctx.state.hp = size;
    const rng = new ctx.math.Random(ctx.props.seed);
    const n = 7 + size * 2;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * rng.range(0.75, 1.15);
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const shape = ctx.get('Shape');
    shape.kind = 'polygon';
    shape.points = pts;
    const shade = rng.range(0.45, 0.65);
    shape.fill.set(shade, shade * 0.95, shade * 0.9, 1);
    const col = ctx.get('CircleCollider2D');
    col.radius = r * 0.92;
    const rb = ctx.get('RigidBody2D');
    rb.mass = size * size;
  },
  onFixedUpdate(ctx) {
    const gm = ctx.find('GameManager');
    const p = gm ? ctx.getOn(gm, 'Script').props : null;
    const w = (p && p.arenaWidth) || 32, h = (p && p.arenaHeight) || 18;
    const t = ctx.transform;
    if (t.x < -w / 2) t.x += w; else if (t.x > w / 2) t.x -= w;
    if (t.y < -h / 2) t.y += h; else if (t.y > h / 2) t.y -= h;
  },
  onMessage(ctx, name, data) {
    if (name !== 'hit' || !ctx.net.isHost || ctx.state.dead) return;
    ctx.state.hp -= data.damage;
    if (ctx.state.hp > 0) { ctx.audio.play('hit', { volume: 0.4, pitch: 0.8 }); return; }
    ctx.state.dead = true;
    const size = ctx.props.size;
    const t = ctx.transform;
    const rb = ctx.get('RigidBody2D');
    if (size > 1) {
      for (let i = 0; i < 2; i++) {
        const a = ctx.random.range(0, Math.PI * 2);
        const child = ctx.net.spawn('Asteroid', { position: { x: t.x + Math.cos(a) * 0.4, y: t.y + Math.sin(a) * 0.4 } });
        const cs = ctx.getOn(child, 'Script');
        cs.props.size = size - 1;
        cs.props.seed = ctx.random.int(1, 1e9);
        const crb = ctx.getOn(child, 'RigidBody2D');
        const sp = ctx.random.range(1.5, 3.5);
        crb.setVelocity(rb.velocity.x * 0.6 + Math.cos(a) * sp, rb.velocity.y * 0.6 + Math.sin(a) * sp);
        crb.angularVelocity = ctx.random.range(-2, 2);
      }
    }
    const boom = ctx.net.spawn('Explosion', { position: { x: t.x, y: t.y } });
    const bs = ctx.getOn(boom, 'Script');
    bs.props.count = 10 + size * 8;
    bs.props.color = '#c9c2b8';
    bs.props.shake = size * 0.06;
    ctx.audio.play('explosion', { volume: 0.35 + size * 0.15, pitch: 1.6 - size * 0.25 });
    ctx.send('asteroidDestroyed', { by: data.from, size });
    despawn(ctx, ctx.entity);
  },
});
