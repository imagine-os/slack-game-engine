// Turret: aims at the nearest enemy in range and fires Shot prefabs.
defineScript({
  name: 'Tower',
  description: 'Auto-targeting turret.',
  props: {
    range: { type: 'number', default: 3.6, min: 0.5, max: 20 },
    fireInterval: { type: 'number', default: 0.65, min: 0.05, max: 5 },
    damage: { type: 'integer', default: 1, min: 1 },
    builtBy: { type: 'string', default: '' },
  },
  onStart(ctx) {
    ctx.state.cooldown = 0.3;
    for (const child of ctx.world.getChildren(ctx.entity)) {
      if (ctx.nameOf(child) === 'Range') { const s = ctx.getOn(child, 'Shape'); if (s) s.radius = ctx.props.range; }
    }
    const em = ctx.get('ParticleEmitter');
    if (em) em.burst(12);
  },
  onFixedUpdate(ctx, dt) {
    const s = ctx.state;
    s.cooldown -= dt;
    const t = ctx.transform;
    let best, bestD = ctx.props.range;
    for (const e of ctx.findAll('enemy')) {
      const et = ctx.getOn(e, 'Transform');
      const d = Math.hypot(et.x - t.x, et.y - t.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best === undefined) return;
    const et = ctx.getOn(best, 'Transform');
    const barrel = ctx.world.getChildren(ctx.entity).find((c) => ctx.nameOf(c) === 'Barrel');
    if (barrel !== undefined) ctx.getOn(barrel, 'Transform').angle = Math.atan2(et.y - t.y, et.x - t.x) - Math.PI / 2;
    if (s.cooldown > 0 || !ctx.net.isHost) return;
    s.cooldown = ctx.props.fireInterval;
    const shot = ctx.spawn('Shot', { position: { x: t.x, y: t.y + 0.3 } });
    const sp = ctx.getOn(shot, 'Script').props;
    sp.target = best;
    sp.damage = ctx.props.damage;
    ctx.audio.play('shoot', { volume: 0.25, pitchVariation: 0.1 });
  },
});
