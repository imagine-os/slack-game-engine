// Short-lived projectile. Hits are resolved on the host and delivered to the
// target through a "hit" message, so ships and asteroids decide what to do.
function despawn(ctx, e) {
  const sync = ctx.net.hub.sync;
  if (sync && ctx.net.isHost) sync.despawn(e); else ctx.destroy(e);
}

defineScript({
  name: 'Bullet',
  description: 'Blaster shot: travels, wraps, damages what it touches.',
  props: {
    lifetime: { type: 'number', default: 1.1, min: 0.1, max: 10 },
    damage: { type: 'integer', default: 1, min: 1, max: 10 },
    shooter: { type: 'entity', default: 0 },
    shooterId: { type: 'string', default: '' },
    color: { type: 'string', default: '#ffd166', label: 'Colour (hex)' },
  },
  onStart(ctx) {
    ctx.state.age = 0;
    ctx.state.spent = false;
    const shape = ctx.get('Shape');
    if (shape) shape.fill.setHex(ctx.props.color);
    const light = ctx.get('Light2D');
    if (light) light.color.setHex(ctx.props.color);
  },
  onFixedUpdate(ctx, dt) {
    ctx.state.age += dt;
    if (ctx.state.age >= ctx.props.lifetime && ctx.net.isHost) { ctx.state.spent = true; despawn(ctx, ctx.entity); return; }
    const gm = ctx.find('GameManager');
    const p = gm ? ctx.getOn(gm, 'Script').props : null;
    const w = (p && p.arenaWidth) || 32, h = (p && p.arenaHeight) || 18;
    const t = ctx.transform;
    if (t.x < -w / 2) t.x += w; else if (t.x > w / 2) t.x -= w;
    if (t.y < -h / 2) t.y += h; else if (t.y > h / 2) t.y -= h;
  },
  onTriggerEnter(ctx, other) {
    if (!ctx.net.isHost || ctx.state.spent) return;
    if (other === ctx.props.shooter) return;
    const tag = ctx.getOn(other, 'Tag');
    if (!tag || tag.has('bullet')) return;
    if (tag.has('ship') || tag.has('asteroid')) {
      ctx.sendTo(other, 'hit', { damage: ctx.props.damage, from: ctx.props.shooterId });
      const spark = ctx.spawn('Explosion', { position: { x: ctx.transform.x, y: ctx.transform.y } });
      const sp = ctx.getOn(spark, 'Script');
      sp.props.count = 8; sp.props.color = ctx.props.color; sp.props.duration = 0.35; sp.props.light = 0.6;
      ctx.state.spent = true;
      despawn(ctx, ctx.entity);
    }
  },
});
