// Arcade kart on top of RigidBody3D: throttle along the heading, steering
// scaled by speed, lateral grip, checkpoint/lap tracking and a per-player HUD.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }

defineScript({
  name: 'Kart',
  description: 'Drivable kart with lap timing.',
  props: {
    accel: { type: 'number', default: 18, min: 1, max: 100 },
    brake: { type: 'number', default: 30, min: 1, max: 200 },
    maxSpeed: { type: 'number', default: 22, min: 1, max: 100 },
    reverseSpeed: { type: 'number', default: 7, min: 0, max: 50 },
    turnSpeed: { type: 'number', default: 2.4, min: 0.1, max: 10, label: 'Turn rate (rad/s)' },
    grip: { type: 'number', default: 12, min: 0, max: 60, label: 'Grip (velocity blend rate)' },
    heading: { type: 'number', default: 3.14159 },
    laps: { type: 'integer', default: 3 },
    color: { type: 'string', default: '#ff7a3d', label: 'Colour (hex)' },
    label: { type: 'string', default: 'P1' },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.h = ctx.props.heading;
    s.go = false;
    s.next = 1;
    s.lap = 0;
    s.lapStart = 0;
    s.best = 0;
    s.steer = 0;
    s.speed = 0;
    s.lastCheckpoint = { x: ctx.transform.x, y: ctx.transform.y, z: ctx.transform.z, h: s.h };
    ctx.transform.setEuler(0, s.h, 0);
    this.applyLook(ctx);
    s.offCollision = ctx.physics3d.events.on('collisionEnter', (ev) => {
      if (ev.a !== ctx.entity && ev.b !== ctx.entity) return;
      const rb = ctx.get('RigidBody3D');
      const sp = Math.hypot(rb.velocity.x, rb.velocity.z);
      if (sp > 4) ctx.audio.play('hit', { volume: Math.min(1, sp / 20), pitchVariation: 0.15 });
    });
  },
  onDestroy(ctx) {
    if (ctx.state.offCollision) ctx.state.offCollision();
    const h = hud(ctx);
    if (h && this.isLocal(ctx)) h.remove('lap');
  },
  onReload(ctx) { this.applyLook(ctx); },
  applyLook(ctx) {
    for (const child of ctx.world.getChildren(ctx.entity)) {
      const n = ctx.nameOf(child);
      const mr = ctx.getOn(child, 'MeshRenderer');
      if (mr && (n === 'Body' || n === 'Nose')) mr.color.setHex(ctx.props.color);
    }
  },
  isLocal(ctx) {
    const pi = ctx.playerInput;
    return !!pi && (pi.owner === 'local' || pi.owner === ctx.net.localId);
  },
  forward(ctx) { return { x: Math.sin(ctx.state.h), z: Math.cos(ctx.state.h) }; },

  onMessage(ctx, name, data) {
    const s = ctx.state;
    if (name === 'go') { s.go = true; s.lapStart = ctx.time.elapsed; s.next = 1; s.lap = 0; }
    else if (name === 'resetTo') { this.teleport(ctx, data.x, data.y, data.z, ctx.props.heading); s.go = false; s.lap = 0; s.next = 1; s.best = 0; }
  },
  teleport(ctx, x, y, z, h) {
    const rb = ctx.get('RigidBody3D');
    rb.velocity.set(0, 0, 0);
    ctx.state.speed = 0;
    ctx.state.h = h;
    ctx.transform.setPosition(x, y, z);
    ctx.transform.setEuler(0, h, 0);
  },

  onOwnerInput(ctx, snap, dt) {
    const s = ctx.state;
    const rb = ctx.get('RigidBody3D');
    if (snap.pressed.includes('action')) {
      const c = s.lastCheckpoint;
      this.teleport(ctx, c.x, c.y + 0.5, c.z, c.h);
    }
    if (!s.go) return;
    const throttle = snap.axes.moveY || 0;
    const steer = snap.axes.moveX || 0;
    const f = this.forward(ctx);
    const actual = rb.velocity.x * f.x + rb.velocity.z * f.z;   // measured speed along the heading
    if (Math.abs(actual - s.speed) > 5) s.speed = actual;         // we hit something: accept the new speed
    if (throttle > 0.05) s.speed = ctx.math.moveToward(s.speed, ctx.props.maxSpeed * throttle, (s.speed < 0 ? ctx.props.brake : ctx.props.accel) * dt);
    else if (throttle < -0.05) s.speed = ctx.math.moveToward(s.speed, ctx.props.reverseSpeed * throttle, (s.speed > 0 ? ctx.props.brake : ctx.props.accel) * dt);
    else s.speed = ctx.math.moveToward(s.speed, 0, 5 * dt);
    // Steering authority grows with speed and flips in reverse.
    const speedFactor = ctx.math.clamp(Math.abs(s.speed) / 6, 0, 1) * Math.sign(s.speed || 1);
    s.h -= steer * ctx.props.turnSpeed * speedFactor * dt;
    s.steer = ctx.math.damp(s.steer, steer, 10, dt);
    const nf = this.forward(ctx);
    // Blend the horizontal velocity toward the heading: high grip = tight, low grip = drifty.
    const k = Math.min(1, ctx.props.grip * dt);
    rb.velocity.x += (nf.x * s.speed - rb.velocity.x) * k;
    rb.velocity.z += (nf.z * s.speed - rb.velocity.z) * k;
    ctx.transform.setEuler(0, s.h, 0);
  },
  onFixedUpdate(ctx) {
    const s = ctx.state;
    const t = ctx.transform;
    // Body roll from steering.
    const body = ctx.world.getChildren(ctx.entity).find((c) => ctx.nameOf(c) === 'Body');
    if (body !== undefined) ctx.getOn(body, 'Transform').setEuler(0, 0, -s.steer * 0.12);
    if (t.y < -5) { const c = s.lastCheckpoint; this.teleport(ctx, c.x, c.y + 0.5, c.z, c.h); }
    if (!s.go) return;
    for (const cp of ctx.findAll('checkpoint')) {
      const p = ctx.getOn(cp, 'Script').props;
      const ct = ctx.getOn(cp, 'Transform');
      if (Math.abs(t.x - ct.x) > p.halfX || Math.abs(t.z - ct.z) > p.halfZ) continue;
      if (p.index !== s.next) continue;
      const count = ctx.findAll('checkpoint').length;
      s.next = (p.index + 1) % count;
      s.lastCheckpoint = { x: ct.x, y: ct.y, z: ct.z, h: p.heading };
      if (p.index === 0) {
        s.lap++;
        const time = ctx.time.elapsed - s.lapStart;
        s.lapStart = ctx.time.elapsed;
        s.best = s.best ? Math.min(s.best, time) : time;
        ctx.audio.play('lap', { volume: 0.6 });
        ctx.send('lapDone', { peer: ctx.net.owner(), lap: s.lap, time });
      } else ctx.audio.play('checkpoint', { volume: 0.4 });
    }
  },
  onUpdate(ctx) {
    if (!this.isLocal(ctx) || ctx.time.frame % 6 !== 0) return;
    const h = hud(ctx);
    if (!h) return;
    const s = ctx.state;
    const rb = ctx.get('RigidBody3D');
    const kmh = Math.round(Math.hypot(rb.velocity.x, rb.velocity.z) * 6);
    const lapTime = s.go ? (ctx.time.elapsed - s.lapStart).toFixed(1) : '0.0';
    h.text('lap', `Lap ${Math.min(s.lap + 1, ctx.props.laps)} / ${ctx.props.laps}   ${lapTime}s${s.best ? `   best ${s.best.toFixed(2)}s` : ''}\n${kmh} km/h`, { anchor: 'top-left' });
  },
});
