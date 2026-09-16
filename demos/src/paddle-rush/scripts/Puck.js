// The puck: keeps its speed within limits and reports bounces.
defineScript({
  name: 'Puck',
  description: 'Bouncy puck with speed limits and a trail.',
  props: {
    maxSpeed: { type: 'number', default: 22, min: 1, max: 60 },
    minSpeed: { type: 'number', default: 3, min: 0, max: 20, label: 'Minimum speed once served' },
  },
  onStart(ctx) { ctx.state.live = false; },
  onMessage(ctx, name) {
    if (name === 'served') ctx.state.live = true;
    if (name === 'reset') { ctx.state.live = false; const em = ctx.get('ParticleEmitter'); if (em) em.clear(); }
  },
  onFixedUpdate(ctx) {
    const rb = ctx.get('RigidBody2D');
    const sp = rb.velocity.length();
    if (sp > ctx.props.maxSpeed) rb.velocity.scale(ctx.props.maxSpeed / sp);
    else if (ctx.state.live && sp > 0.001 && sp < ctx.props.minSpeed) rb.velocity.scale(ctx.props.minSpeed / sp);
    const em = ctx.get('ParticleEmitter');
    if (em) em.emitting = sp > 6;
  },
  onCollisionEnter(ctx, other, info) {
    if (info.impulse < 1.5) return;
    const paddle = ctx.getOn(other, 'PlayerInput');
    ctx.audio.play('bounce', { volume: Math.min(1, info.impulse / 12), pitch: paddle ? 1 : 1.4, pitchVariation: 0.1 });
    if (paddle) {
      const cam = ctx.find('Camera');
      const c = cam !== undefined ? ctx.getOn(cam, 'Camera2D') : null;
      if (c && info.impulse > 10) c.shake = 0.08;
    }
  },
});
