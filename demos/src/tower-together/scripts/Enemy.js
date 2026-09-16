// Walks the road defined by the GameManager's `path`; damaged by Shots.
defineScript({
  name: 'Enemy',
  description: 'Path-following creep with a health bar.',
  props: {
    speed: { type: 'number', default: 1.6, min: 0.1, max: 20 },
    hp: { type: 'integer', default: 3, min: 1 },
    reward: { type: 'integer', default: 8, min: 0 },
    big: { type: 'boolean', default: false },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.hp = ctx.props.hp;
    s.maxHp = ctx.props.hp;
    s.index = 1;
    s.dead = false;
    const gm = ctx.find('GameManager');
    s.path = gm !== undefined ? ctx.getOn(gm, 'Script').props.path : [[0, 0]];
    if (ctx.props.big) { const shape = ctx.get('Shape'); if (shape) { shape.radius = 0.55; shape.fill.setHex('#b23a5a'); } }
  },
  onFixedUpdate(ctx, dt) {
    const s = ctx.state;
    if (s.dead || s.index >= s.path.length) return;
    const t = ctx.transform;
    const [tx, ty] = s.path[s.index];
    const dx = tx - t.x, dy = ty - t.y;
    const d = Math.hypot(dx, dy);
    const step = ctx.props.speed * dt;
    if (d <= step) {
      t.setPosition(tx, ty);
      s.index++;
      if (s.index >= s.path.length && ctx.net.isHost) { s.dead = true; ctx.send('enemyReachedBase', {}); this.remove(ctx); }
    } else t.setPosition(t.x + (dx / d) * step, t.y + (dy / d) * step);
    // Wobble while walking.
    const shape = ctx.get('Shape');
    if (shape) shape.height = shape.width = 1 + Math.sin(ctx.time.elapsed * 12) * 0.06;
  },
  onMessage(ctx, name, data) {
    if (name !== 'damage' || ctx.state.dead || !ctx.net.isHost) return;
    ctx.state.hp -= data.amount;
    for (const child of ctx.world.getChildren(ctx.entity)) {
      if (ctx.nameOf(child) !== 'Health') continue;
      const bar = ctx.getOn(child, 'Shape');
      bar.width = 0.8 * Math.max(0, ctx.state.hp / ctx.state.maxHp);
      bar.fill.setHex(ctx.state.hp / ctx.state.maxHp > 0.5 ? '#06d6a0' : '#ffd166');
    }
    if (ctx.state.hp > 0) return;
    ctx.state.dead = true;
    ctx.audio.play('hit', { volume: 0.35, pitchVariation: 0.2 });
    const em = ctx.get('ParticleEmitter');
    if (em) em.burst(ctx.props.big ? 30 : 14);
    const shape = ctx.get('Shape');
    if (shape) shape.visible = false;
    for (const child of ctx.world.getChildren(ctx.entity)) { const cs = ctx.getOn(child, 'Shape'); if (cs) cs.visible = false; }
    ctx.send('enemyKilled', { reward: ctx.props.reward });
    ctx.timer(0.5, () => this.remove(ctx));
  },
  remove(ctx) {
    const sync = ctx.net.hub.sync;
    if (sync && ctx.net.isHost) sync.despawn(ctx.entity); else ctx.destroy();
  },
});
