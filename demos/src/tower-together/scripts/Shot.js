// Homing projectile fired by towers. Local-only decoration on clients: the
// host decides damage.
defineScript({
  name: 'Shot',
  description: 'Homes in on its target and applies damage.',
  props: {
    speed: { type: 'number', default: 14, min: 1, max: 100 },
    damage: { type: 'integer', default: 1, min: 1 },
    target: { type: 'entity', default: 0 },
    lifetime: { type: 'number', default: 2 },
  },
  onStart(ctx) { ctx.state.age = 0; },
  onFixedUpdate(ctx, dt) {
    ctx.state.age += dt;
    const target = ctx.props.target;
    if (!target || !ctx.world.isAlive(target) || ctx.state.age > ctx.props.lifetime) { ctx.destroy(); return; }
    const t = ctx.transform;
    const tt = ctx.getOn(target, 'Transform');
    const dx = tt.x - t.x, dy = tt.y - t.y;
    const d = Math.hypot(dx, dy);
    const step = ctx.props.speed * dt;
    if (d <= Math.max(step, 0.3)) {
      ctx.sendTo(target, 'damage', { amount: ctx.props.damage });
      ctx.destroy();
      return;
    }
    t.setPosition(t.x + (dx / d) * step, t.y + (dy / d) * step);
  },
});
