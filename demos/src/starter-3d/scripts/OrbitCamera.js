// Drag with the mouse (or a finger) to orbit, wheel to zoom. Idles slowly
// around the target when nobody is dragging.
defineScript({
  name: 'OrbitCamera',
  description: 'Orbit camera around a target entity.',
  props: {
    target: { type: 'string', default: 'Cube', label: 'Target entity name' },
    distance: { type: 'number', default: 9, min: 2, max: 40 },
    autoRotate: { type: 'number', default: 0.15, min: 0, max: 2, label: 'Idle spin (rad/s)' },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.yaw = 0.7;
    s.pitch = 0.45;
    s.dist = ctx.props.distance;
  },
  onUpdate(ctx, dt) {
    const s = ctx.state;
    const m = ctx.input.mouse;
    if (m.held(0)) {
      s.yaw -= m.delta.x * 0.005;
      s.pitch = ctx.math.clamp(s.pitch + m.delta.y * 0.005, 0.05, 1.5);
    } else s.yaw += dt * ctx.props.autoRotate;
    const touch = ctx.input.touch.touches[0];
    if (touch) { s.yaw -= touch.delta.x * 0.005; touch.delta.set(0, 0); }
    if (m.wheel) s.dist = ctx.math.clamp(s.dist * (1 + Math.sign(m.wheel) * 0.1), 2, 40);
    const target = ctx.find(ctx.props.target);
    const tt = target ? ctx.getOn(target, 'Transform') : null;
    const cx = tt ? tt.x : 0, cy = tt ? tt.y : 0, cz = tt ? tt.z : 0;
    const cp = Math.cos(s.pitch);
    ctx.transform.setPosition(cx + Math.sin(s.yaw) * cp * s.dist, cy + Math.sin(s.pitch) * s.dist, cz + Math.cos(s.yaw) * cp * s.dist);
    ctx.transform.lookAt(tt ? tt.position : ctx.math.Vec3.ZERO);
  },
});
