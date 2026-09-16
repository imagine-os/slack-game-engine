// Kinematic platform oscillating around its start position. Players riding
// it are carried by the Player script (it reads this body's velocity).
defineScript({
  name: 'MovingPlatform',
  description: 'Sinusoidal kinematic platform.',
  props: {
    dx: { type: 'number', default: 0, label: 'Horizontal travel' },
    dy: { type: 'number', default: 3, label: 'Vertical travel' },
    period: { type: 'number', default: 4, min: 0.5, max: 30, label: 'Seconds per cycle' },
    phase: { type: 'number', default: 0, min: 0, max: 6.283 },
  },
  onStart(ctx) {
    ctx.state.origin = { x: ctx.transform.x, y: ctx.transform.y };
    ctx.state.t = ctx.props.phase;
  },
  onFixedUpdate(ctx, dt) {
    const s = ctx.state;
    const w = (Math.PI * 2) / ctx.props.period;
    s.t += dt;
    // Set velocity so the physics step moves the body and contacts feel it.
    const vx = Math.cos(s.t * w) * w * ctx.props.dx * 0.5;
    const vy = Math.cos(s.t * w) * w * ctx.props.dy * 0.5;
    ctx.get('RigidBody2D').setVelocity(vx, vy);
  },
});
