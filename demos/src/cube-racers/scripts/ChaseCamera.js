// Third-person camera that follows the local player's kart.
defineScript({
  name: 'ChaseCamera',
  description: 'Smooth chase camera behind the local kart.',
  props: {
    distance: { type: 'number', default: 9, min: 2, max: 40 },
    height: { type: 'number', default: 4.5, min: 0.5, max: 30 },
    lookAhead: { type: 'number', default: 6, min: 0, max: 40 },
    smoothing: { type: 'number', default: 5, min: 0, max: 30 },
  },
  onLateUpdate(ctx, dt) {
    let target;
    for (const e of ctx.findAll('kart')) {
      const pi = ctx.getOn(e, 'PlayerInput');
      if (pi && (pi.owner === 'local' || pi.owner === ctx.net.localId)) { target = e; break; }
    }
    if (target === undefined) return;
    const kt = ctx.getOn(target, 'Transform');
    const rb = ctx.getOn(target, 'RigidBody3D');
    const speed = rb ? Math.hypot(rb.velocity.x, rb.velocity.z) : 0;
    // Kart forward in the XZ plane (yaw rotation of +Z).
    const q = kt.rotation;
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const dist = ctx.props.distance + speed * 0.08;
    const tx = kt.x - fx * dist, ty = kt.y + ctx.props.height, tz = kt.z - fz * dist;
    const t = ctx.transform;
    const k = ctx.props.smoothing;
    t.setPosition(ctx.math.damp(t.x, tx, k, dt), ctx.math.damp(t.y, ty, k, dt), ctx.math.damp(t.z, tz, k, dt));
    t.lookAt(new ctx.math.Vec3(kt.x + fx * ctx.props.lookAhead, kt.y + 1, kt.z + fz * ctx.props.lookAhead));
  },
});
