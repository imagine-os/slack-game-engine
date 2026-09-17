// Chase camera for the local glider: sits behind and above, lags on turns,
// widens its field of view with speed, shakes on collisions and shows speed
// streaks in wind currents. P toggles photo mode: the HUD hides and the camera
// slowly orbits the glider. Before take-off it drifts around the start area.
function pg(ctx) { return ctx.engine.procgen || null; }

defineScript({
  name: 'ChaseCamera',
  description: 'Speed-aware chase camera with photo mode.',
  props: {
    distance: { type: 'number', default: 7.5, min: 2, max: 40 },
    height: { type: 'number', default: 2.4, min: 0, max: 20 },
    lookAhead: { type: 'number', default: 14, min: 0, max: 60 },
    smoothing: { type: 'number', default: 6, min: 0.5, max: 30 },
    fov: { type: 'number', default: 62, min: 30, max: 120 },
    fovPerSpeed: { type: 'number', default: 0.32, min: 0, max: 2 },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.photo = false; s.orbit = 0; s.shake = 0; s.prev = null; s.speed = 0; s.streaks = [];
    s.look = new ctx.math.Vec3(); s.tmp = new ctx.math.Vec3(); s.fwd = new ctx.math.Vec3(); s.up = new ctx.math.Vec3();
    s.streakRng = new ctx.math.Random(4242);
    s.cinema = 0;
    s.started = ctx.net.online && !ctx.net.isHost; // guests join a flight already in progress
  },
  ensureStreaks(ctx) {
    const s = ctx.state, P = pg(ctx);
    if (s.streaks.length || !P || !P.world) return;
    const key = `${P.world.seed}:wind-streak`;
    const desc = P.registered(key) || P.registerGenerated(key, P.world.library('wind-streak'));
    for (let i = 0; i < 14; i++) {
      const e = ctx.world.createEntity('Speed Streak');
      const t = ctx.getOn(e, 'Transform');
      const c = ctx.world.createEntity('streak');
      ctx.world.setParent(c, e);
      const mr = ctx.world.addComponentByType(c, 'MeshRenderer', { mesh: desc.groups[0].mesh });
      P.applyMaterial(mr, desc.groups[0]);
      mr.opacity = 0.25;
      mr.visible = false;
      s.streaks.push({ e, t, mr, life: 0, off: { x: 0, y: 0, z: 0 } });
    }
  },
  onDestroy(ctx) { for (const st of ctx.state.streaks || []) if (ctx.world.isAlive(st.e)) ctx.destroy(st.e); },
  onMessage(ctx, name, data) {
    const s = ctx.state;
    if (name === 'collision' && (data.peer === ctx.net.localId || data.peer === 'local')) {
      const r = ctx.engine.renderer;
      if (r && typeof r.setCameraShake === 'function') r.setCameraShake(0.15 + data.strength * 0.35, 4);
      else ctx.state.shake = Math.max(ctx.state.shake, 0.4 + data.strength * 0.8);
    }
    if (name === 'shell:fly' || name === 'shell:race' || name === 'takeControl') s.started = true;
    if (name === 'worldSeed') { for (const st of ctx.state.streaks) if (ctx.world.isAlive(st.e)) ctx.destroy(st.e); ctx.state.streaks = []; }
  },
  localGlider(ctx) {
    for (const e of ctx.findAll('glider')) {
      const pi = ctx.getOn(e, 'PlayerInput');
      if (pi && (pi.owner === 'local' || pi.owner === ctx.net.localId)) return e;
    }
    return undefined;
  },
  onLateUpdate(ctx, dt) {
    const s = ctx.state, M = ctx.math, t = ctx.transform;
    const cam = ctx.get('Camera3D');
    if (ctx.input.keyboard.pressed('KeyP') || ctx.input.pressed('photo')) { s.photo = !s.photo; ctx.send('photoMode', { on: s.photo }); }
    const glider = this.localGlider(ctx);
    if (glider === undefined || !s.started) { this.cinematic(ctx, dt); return; }
    const gt = ctx.getOn(glider, 'Transform');
    const gp = gt.position;
    if (s.prev && dt > 0) s.speed = M.damp(s.speed, Math.min(200, Math.hypot(gp.x - s.prev.x, gp.y - s.prev.y, gp.z - s.prev.z) / dt), 5, dt);
    s.prev = { x: gp.x, y: gp.y, z: gp.z };
    gt.updateWorldMatrix();
    gt.forward(s.fwd);
    s.shake = Math.max(0, s.shake - dt * 1.8);
    if (s.photo) {
      s.orbit += dt * 0.22;
      const r = 8 + Math.sin(s.orbit * 0.5) * 2, h = 2 + Math.sin(s.orbit * 0.31) * 1.5;
      t.setPosition(gp.x + Math.cos(s.orbit) * r, gp.y + h, gp.z + Math.sin(s.orbit) * r);
      t.updateWorldMatrix();
      t.lookAt(s.look.set(gp.x, gp.y, gp.z));
      if (cam) cam.fov = M.damp(cam.fov, 45, 2, dt);
      this.streaks(ctx, dt, gp, 0);
      return;
    }
    const dist = ctx.props.distance + s.speed * 0.05;
    // Follow the heading in the horizontal plane so pitch does not swing the camera under the glider.
    const fx = s.fwd.x, fz = s.fwd.z, fl = Math.hypot(fx, fz) || 1;
    const hx = fx / fl, hz = fz / fl;
    const tx = gp.x - hx * dist, ty = gp.y + ctx.props.height - s.fwd.y * 2.5, tz = gp.z - hz * dist;
    const k = ctx.props.smoothing;
    const nx = M.damp(t.x, tx, k, dt), ny = M.damp(t.y, ty, k * 0.8, dt), nz = M.damp(t.z, tz, k, dt);
    const sh = s.shake * s.shake * 0.5;
    t.setPosition(nx + (Math.random() - 0.5) * sh, ny + (Math.random() - 0.5) * sh, nz + (Math.random() - 0.5) * sh);
    t.updateWorldMatrix();
    s.look.set(gp.x + s.fwd.x * ctx.props.lookAhead, gp.y + s.fwd.y * ctx.props.lookAhead * 0.6 + 0.6, gp.z + s.fwd.z * ctx.props.lookAhead);
    t.lookAt(s.look);
    if (cam) cam.fov = M.damp(cam.fov, ctx.props.fov + s.speed * ctx.props.fovPerSpeed, 3, dt);
    const P = pg(ctx);
    let wind = 0;
    if (P && P.world) { P.world.windAt(gp, s.tmp); wind = s.tmp.length(); }
    this.streaks(ctx, dt, gp, Math.max(0, (s.speed - 34) / 30) + Math.min(1, wind / 6));
  },
  /** Before any glider exists (start screen): a slow drift around the start of the flow path. */
  cinematic(ctx, dt) {
    const s = ctx.state, P = pg(ctx), t = ctx.transform;
    s.cinema += dt;
    const W = P && P.world;
    const sp = W ? W.spawn(0).position : { x: 0, y: 50, z: 0 };
    const a = s.cinema * 0.06 + 2.2;
    t.setPosition(sp.x + Math.cos(a) * 95, sp.y + 22 + Math.sin(a * 0.7) * 5, sp.z + Math.sin(a) * 95);
    t.updateWorldMatrix();
    t.lookAt(s.look.set(sp.x, sp.y - 10, sp.z));
    const cam = ctx.get('Camera3D');
    if (cam) cam.fov = 58;
  },
  /** Speed streaks: thin translucent lines rushing past the camera, more with speed and inside wind. */
  streaks(ctx, dt, gp, intensity) {
    const s = ctx.state;
    this.ensureStreaks(ctx);
    if (!s.streaks.length) return;
    const t = ctx.transform;
    t.forward(s.fwd);
    const speed = Math.max(20, s.speed);
    for (const st of s.streaks) {
      if (st.life <= 0) {
        if (intensity > 0.05 && s.streakRng.chance(Math.min(0.5, intensity * 0.35))) {
          st.life = 1;
          st.off.x = s.streakRng.range(-6, 6); st.off.y = s.streakRng.range(-3, 4); st.off.z = s.streakRng.range(10, 40);
          st.mr.visible = true;
        } else { st.mr.visible = false; continue; }
      }
      st.life -= dt * speed / 40;
      st.off.z -= speed * dt * 1.4;
      if (st.off.z < -6) st.life = 0;
      // Position relative to the glider frame: ahead along the camera forward, offset sideways.
      const rx = -s.fwd.z, rz = s.fwd.x;
      st.t.setPosition(gp.x + s.fwd.x * st.off.z + rx * st.off.x, gp.y + st.off.y + s.fwd.y * st.off.z, gp.z + s.fwd.z * st.off.z + rz * st.off.x);
      st.t.setScale(1, 1, 1 + speed / 25);
      st.t.updateWorldMatrix();
      st.t.lookAt(s.look.set(st.t.x + s.fwd.x, st.t.y + s.fwd.y, st.t.z + s.fwd.z));
      st.mr.opacity = 0.08 + Math.min(0.35, intensity * 0.3) * Math.sin(st.life * Math.PI);
    }
  },
});
