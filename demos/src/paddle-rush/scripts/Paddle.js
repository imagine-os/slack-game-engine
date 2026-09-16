// Air-hockey mallet: a kinematic body moved by input velocity so the puck
// picks up its momentum. Several users may share it (PlayerInput.coOwners);
// the engine hands this script one merged snapshot in onOwnerInput.
defineScript({
  name: 'Paddle',
  description: 'Player or AI controlled mallet constrained to one half.',
  props: {
    side: { type: 'enum', default: 'left', options: ['left', 'right'] },
    speed: { type: 'number', default: 13, min: 1, max: 40 },
    ai: { type: 'boolean', default: false },
    aiSpeed: { type: 'number', default: 8, min: 1, max: 40 },
    tableWidth: { type: 'number', default: 24 },
    tableHeight: { type: 'number', default: 14 },
  },
  onStart(ctx) {
    ctx.state.home = { x: ctx.transform.x, y: ctx.transform.y };
    ctx.state.vx = 0; ctx.state.vy = 0;
  },
  onOwnerInput(ctx, snap) {
    if (ctx.props.ai) return;
    ctx.state.vx = (snap.axes.moveX || 0) * ctx.props.speed;
    ctx.state.vy = (snap.axes.moveY || 0) * ctx.props.speed;
  },
  onFixedUpdate(ctx, dt) {
    const s = ctx.state;
    const rb = ctx.get('RigidBody2D');
    const t = ctx.transform;
    if (ctx.props.ai) this.think(ctx, dt);
    const r = ctx.get('CircleCollider2D').radius;
    const hw = ctx.props.tableWidth / 2 - r - 0.1, hh = ctx.props.tableHeight / 2 - r - 0.1;
    const minX = ctx.props.side === 'left' ? -hw : r * 0.5;
    const maxX = ctx.props.side === 'left' ? -r * 0.5 : hw;
    // Stop at the boundaries instead of pushing through them.
    let vx = s.vx, vy = s.vy;
    if ((t.x <= minX && vx < 0) || (t.x >= maxX && vx > 0)) vx = 0;
    if ((t.y <= -hh && vy < 0) || (t.y >= hh && vy > 0)) vy = 0;
    rb.setVelocity(vx, vy);
    t.setPosition(ctx.math.clamp(t.x, minX, maxX), ctx.math.clamp(t.y, -hh, hh));
  },
  /** Simple AI: chase the puck when it is on our half, otherwise hover near home. */
  think(ctx, dt) {
    const s = ctx.state;
    const puck = ctx.find('Puck');
    if (puck === undefined) return;
    const pt = ctx.getOn(puck, 'Transform');
    const prb = ctx.getOn(puck, 'RigidBody2D');
    const onMySide = ctx.props.side === 'left' ? pt.x < 0 : pt.x > 0;
    let tx, ty;
    if (onMySide) {
      // Aim slightly behind the puck so we hit it toward the other goal.
      tx = pt.x + (ctx.props.side === 'left' ? -0.6 : 0.6);
      ty = pt.y;
    } else {
      tx = s.home.x;
      ty = pt.y * 0.5 + prb.velocity.y * 0.1;
    }
    const dx = tx - ctx.transform.x, dy = ty - ctx.transform.y;
    const dist = Math.hypot(dx, dy);
    const sp = Math.min(ctx.props.aiSpeed, dist / Math.max(dt, 0.001));
    s.vx = dist > 0.01 ? (dx / dist) * sp : 0;
    s.vy = dist > 0.01 ? (dy / dist) * sp : 0;
  },
});
