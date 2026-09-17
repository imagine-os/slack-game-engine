// The player's glider: an arcade flight model (bank to turn, dive to gain
// speed, climb to trade it back, stall when too slow), boost meter fed by rings
// and wind currents, soft collisions with islands, gate/mote detection and the
// flight HUD. All movement happens in onOwnerInput so only the simulating peer
// integrates; remote copies just show the replicated transform.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }
function pg(ctx) { return ctx.engine.procgen || null; }
function world(ctx) { const p = pg(ctx); return p ? p.world : null; }
const UP = { x: 0, y: 1, z: 0 }, RIGHT = { x: 1, y: 0, z: 0 }, BACK = { x: 0, y: 0, z: 1 };
const GROUPS = { Hull: 'hull', Wing: 'wing', Trim: 'trim', Canopy: 'canopy' };

defineScript({
  name: 'Glider',
  description: 'Arcade glider flight model with boost, stall, soft collisions, gates and motes.',
  props: {
    livery: { type: 'integer', default: 0, min: 0, max: 5 },
    label: { type: 'string', default: 'P1' },
    heading: { type: 'number', default: 0, label: 'Start heading (rad)' },
    cruise: { type: 'number', default: 30, min: 5, max: 80, label: 'Cruise speed' },
    stall: { type: 'number', default: 15, min: 2, max: 40, label: 'Stall speed' },
    maxSpeed: { type: 'number', default: 68, min: 10, max: 150 },
    pitchRate: { type: 'number', default: 1.5, min: 0.2, max: 5, label: 'Pitch rate (rad/s)' },
    maxBank: { type: 'number', default: 1.05, min: 0.1, max: 1.5, label: 'Max bank (rad)' },
    turnRate: { type: 'number', default: 1.15, min: 0.1, max: 5, label: 'Turn rate at full bank' },
    sink: { type: 'number', default: 2.2, min: 0, max: 10, label: 'Sink rate at cruise' },
    boostAccel: { type: 'number', default: 28, min: 0, max: 100 },
    invertPitch: { type: 'boolean', default: false, label: 'Push forward to climb' },
  },
  onStart(ctx) {
    this.ctxRef = ctx;
    ctx.state.fwdTmp = { x: 0, y: 0, z: 0 };
    const s = ctx.state, p = ctx.props, t = ctx.transform;
    s.speed = p.cruise * 0.85; s.yaw = p.heading; s.pitch = 0; s.bank = 0; s.boost = 0.5; s.stallAmount = 0;
    s.drift = { x: 0, y: 0, z: 0 }; s.windTmp = { x: 0, y: 0, z: 0 }; s.windStrength = 0;
    s.flying = false; s.homeY = t.y;
    s.gates = 0; s.raceGate = 0; s.racing = false; s.raceStart = 0; s.raceTime = 0; s.finished = false;
    s.ringCooldown = {}; s.motes = 0; s.discovered = {}; s.collideCooldown = 0; s.lastPos = { x: t.x, y: t.y, z: t.z };
    s.ghostPath = []; s.ghostTimer = 0; s.hudTick = 0; s.renderSpeed = 0; s.vel = { x: 0, y: 0, z: 0 };
    s.q1 = new ctx.math.Quat(); s.q2 = new ctx.math.Quat();
    this.applyLook(ctx);
    this.orient(ctx);
    if (this.isLocal(ctx)) {
      s.windLoop = ctx.audio.play('wind', { loop: true, volume: 0 });
    }
  },
  onReload(ctx) { this.applyLook(ctx); },
  onDestroy(ctx) {
    const s = ctx.state;
    if (s.windLoop) s.windLoop.stop(0.3);
    const h = hud(ctx);
    if (h && this.isLocal(ctx)) for (const id of ['speed', 'alt', 'boostbar', 'boostbg', 'flight-mode', 'stall']) h.remove(id);
  },
  isLocal(ctx) {
    const pi = ctx.playerInput;
    return !!pi && (pi.owner === 'local' || pi.owner === ctx.net.localId);
  },
  /** Swap the prefab's placeholder meshes for the livery's generated glider groups. */
  applyLook(ctx) {
    const P = pg(ctx), W = world(ctx);
    if (!P || !W) return;
    const key = `${W.seed}:glider-${ctx.props.livery % 6}`;
    const desc = P.registered(key) || P.registerGenerated(key, W.library(`glider-${ctx.props.livery % 6}`));
    for (const child of ctx.world.getChildren(ctx.entity)) {
      const g = GROUPS[ctx.nameOf(child)];
      const mr = ctx.getOn(child, 'MeshRenderer');
      const group = desc.groups.find((x) => x.name === g);
      if (mr && group) {
        mr.mesh = group.mesh;
        P.applyMaterial(mr, group);
        // The generated groups are modelled at full size in the glider's frame: drop the placeholder cube's offset and scale.
        const ct = ctx.getOn(child, 'Transform');
        if (ct) { ct.setPosition(0, 0, 0); ct.setScale(1, 1, 1); ct.rotation.set(0, 0, 0, 1); ct.markDirty(); }
      }
    }
  },
  orient(ctx) {
    const s = ctx.state, t = ctx.transform;
    const q = t.rotation;
    q.setAxisAngle(UP, s.yaw);
    q.multiply(s.q1.setAxisAngle(RIGHT, s.pitch));
    q.multiply(s.q2.setAxisAngle(BACK, -s.bank));
    t.markDirty();
  },
  forward(s) {
    return pg(this.ctxRef).flight.headingForward(s.yaw, s.pitch, s.fwdTmp);
  },
  teleport(ctx, position, yaw) {
    const s = ctx.state;
    ctx.transform.setPosition(position.x, position.y, position.z);
    s.yaw = yaw; s.pitch = 0; s.bank = 0; s.speed = ctx.props.cruise * 0.85; s.drift.x = s.drift.y = s.drift.z = 0;
    s.homeY = position.y; s.lastPos = { x: position.x, y: position.y, z: position.z };
    this.orient(ctx);
  },

  onMessage(ctx, name, data) {
    const s = ctx.state;
    if (name === 'takeControl') { if (data.peer === ctx.net.owner()) { s.flying = true; s.hudCleared = false; } }
    else if (name === 'resetTo') { if (!data.peer || data.peer === ctx.net.owner()) this.teleport(ctx, data.position, data.yaw); }
    else if (name === 'raceState') {
      if (data.phase === 'running') { s.racing = true; s.finished = false; s.raceGate = 0; s.raceStart = data.startAt; s.ghostPath = []; s.ghostTimer = 0; }
      else if (data.phase === 'idle') { s.racing = false; s.finished = false; s.raceGate = 0; }
      else if (data.phase === 'countdown') { s.racing = false; s.finished = false; s.raceGate = 0; }
    } else if (name === 'raceResult') {
      if (data.peer !== ctx.net.owner() || !this.isLocal(ctx)) return;
      s.finished = true; s.raceTime = data.time;
      const P = pg(ctx), W = world(ctx);
      if (P && W && data.best) {
        P.env.storageSet(`driftwind.best.${W.seed}`, String(data.time));
        if (s.ghostPath.length > 2) P.env.storageSet(`driftwind.ghost.${W.seed}`, JSON.stringify(s.ghostPath));
      }
    } else if (name === 'worldSeed') { s.discovered = {}; s.gates = 0; s.motes = 0; ctx.timer(0.05, () => this.applyLook(ctx)); }
  },

  onOwnerInput(ctx, snap, dt) {
    const s = ctx.state, p = ctx.props, t = ctx.transform, M = ctx.math;
    const P = pg(ctx);
    if (!P) return;
    const FL = P.flight;
    const W = world(ctx);
    let steer = 0, pitchIn = 0, boosting = false, braking = false;
    if (s.flying) {
      steer = snap.axes.moveX || 0;
      pitchIn = (snap.axes.moveY || 0) * (p.invertPitch ? -1 : 1);
      boosting = snap.held.includes('boost');
      braking = snap.held.includes('brake');
    } else {
      // Autopilot before the player takes off: a lazy S-curve holding altitude.
      steer = Math.sin(ctx.time.elapsed * 0.22 + s.yaw) * 0.3;
      pitchIn = M.clamp((s.homeY - t.y) * 0.06 - (s.speed - p.cruise) * 0.01, -0.35, 0.35);
    }
    // Bank and turn (banking turns; slower at high speed like a real wing).
    s.bank = M.damp(s.bank, M.clamp(steer, -1, 1) * p.maxBank, 3.2, dt);
    s.yaw += FL.bankTurnRate(s.bank, p.turnRate, s.speed, p.cruise) * dt;
    // Pitch with reduced authority near the stall, natural nose-down tendency.
    const authority = M.clamp((s.speed - p.stall * 0.6) / (p.cruise - p.stall * 0.6), 0.15, 1);
    s.pitch += pitchIn * p.pitchRate * authority * dt;
    if (Math.abs(pitchIn) < 0.05) s.pitch = M.damp(s.pitch, -0.04, 0.9, dt);
    if (s.speed < p.stall) { s.pitch -= ((p.stall - s.speed) / p.stall) * 2.4 * dt; s.stallAmount = Math.min(1, s.stallAmount + dt * 2.5); }
    else s.stallAmount = Math.max(0, s.stallAmount - dt * 2);
    s.pitch = M.clamp(s.pitch, -1.2, 0.95);
    // Speed: gravity along the flight path, aero drag/lift settling toward cruise, boost and brake.
    const boostOn = boosting && s.boost > 0.001;
    if (boostOn) { s.boost = Math.max(0, s.boost - dt * 0.42); if (!s.wasBoosting && this.isLocal(ctx)) ctx.audio.play('whoosh', { volume: 0.5 }); }
    else s.boost = Math.min(1, s.boost + dt * 0.03);
    s.wasBoosting = boostOn;
    s.speed = FL.integrateSpeed(s.speed, s.pitch, dt, { cruise: p.cruise, stall: p.stall, maxSpeed: p.maxSpeed, boostAccel: p.boostAccel, boosting: boostOn, braking });
    if (braking) s.pitch += 0.35 * authority * dt;
    // Wind currents push the glider along and refill the boost meter.
    let wind = s.windTmp;
    if (W) W.windAt(t.position, wind); else { wind.x = wind.y = wind.z = 0; }
    s.windStrength = Math.hypot(wind.x, wind.y, wind.z);
    s.drift.x += wind.x * dt; s.drift.y += wind.y * dt; s.drift.z += wind.z * dt;
    const dk = Math.exp(-1.3 * dt);
    s.drift.x *= dk; s.drift.y *= dk; s.drift.z *= dk;
    if (s.windStrength > 1) s.boost = Math.min(1, s.boost + dt * 0.14);
    // Velocity: along the nose, plus drift, minus sink (stronger when slow).
    const f = this.forward(s);
    const sink = p.sink * M.clamp(p.cruise / Math.max(s.speed, 6), 0.35, 3.5);
    let vx = f.x * s.speed + s.drift.x, vy = f.y * s.speed + s.drift.y - sink, vz = f.z * s.speed + s.drift.z;
    // Soft ceiling and floor, with an updraft recovery under the archipelago.
    const B = W ? W.bounds : { minY: -40, maxY: 140 };
    const ceiling = B.maxY + 70, floor = B.minY - 40;
    if (t.y > ceiling) { s.pitch -= (t.y - ceiling) * 0.02 * dt; vy -= (t.y - ceiling) * 0.6; }
    if (t.y < floor) { s.pitch += (floor - t.y) * 0.04 * dt; vy += (floor - t.y) * 0.9; s.speed = Math.max(s.speed, p.cruise); s.boost = Math.min(1, s.boost + dt * 0.6); }
    if (t.y < floor - 220 && W) { const sp = W.spawn(0); this.teleport(ctx, sp.position, sp.yaw); return; }
    s.lastPos.x = t.x; s.lastPos.y = t.y; s.lastPos.z = t.z;
    t.position.x += vx * dt; t.position.y += vy * dt; t.position.z += vz * dt;
    s.vel.x = vx; s.vel.y = vy; s.vel.z = vz;
    // Soft collision: push out, deflect the nose, lose speed, keep flying.
    s.collideCooldown -= dt;
    if (W && s.collideCooldown <= 0) {
      const hit = W.collide(t.position, 1.4);
      if (hit) {
        t.position.x += hit.push.x; t.position.y += hit.push.y; t.position.z += hit.push.z;
        const n = hit.normal;
        // Blend the reflected direction with the current heading so it feels like a bounce, not a ricochet.
        const bounce = FL.bounceHeading(s.vel, f, n);
        if (bounce) { s.yaw = bounce.yaw; s.pitch = bounce.pitch; }
        const strength = M.clamp(s.speed / p.maxSpeed, 0.2, 1);
        s.speed = Math.max(p.stall * 0.95, s.speed * 0.5);
        s.drift.x += n.x * 5; s.drift.y += n.y * 5; s.drift.z += n.z * 5;
        s.collideCooldown = 0.45;
        ctx.send('collision', { peer: ctx.net.owner(), strength, position: { x: t.x, y: t.y, z: t.z }, normal: n });
        if (this.isLocal(ctx)) ctx.audio.play('thud', { volume: 0.4 + strength * 0.5, pitchVariation: 0.1 });
      }
    }
    t.markDirty();
    this.orient(ctx);
    if (W) this.checkGates(ctx, W, s.lastPos, t.position);
  },

  /** Segment test against every gate ring: did we fly through it this step? */
  checkGates(ctx, W, a, b) {
    const s = ctx.state, FL = pg(ctx).flight;
    for (const ring of W.rings) {
      const c = ring.position;
      const dx = b.x - c.x, dz = b.z - c.z;
      if (dx * dx + dz * dz > 900) continue;
      const cross = FL.gateCrossing(a, b, ring);
      if (!cross) continue;
      const forwardPass = cross.forward;
      const now = ctx.time.elapsed;
      if (s.racing && !s.finished) {
        if (ring.index !== s.raceGate || !forwardPass) continue;
        s.raceGate++;
        const time = now - s.raceStart;
        s.boost = Math.min(1, s.boost + 0.35);
        ctx.send('gatePassed', { peer: ctx.net.owner(), index: ring.index, time, total: W.rings.length });
        if (s.raceGate >= W.rings.length) ctx.send('raceFinished', { peer: ctx.net.owner(), time });
        if (this.isLocal(ctx)) ctx.audio.play('chime', { volume: 0.6 });
        ctx.send('ringPassed', { index: ring.index, peer: ctx.net.owner() });
      } else {
        if ((s.ringCooldown[ring.index] || -10) > now - 3) continue;
        s.ringCooldown[ring.index] = now;
        s.gates++;
        s.boost = Math.min(1, s.boost + 0.35);
        s.speed = Math.min(ctx.props.maxSpeed, s.speed + 6);
        if (this.isLocal(ctx)) ctx.audio.play('chime', { volume: 0.5, pitchVariation: 0.05 });
        ctx.send('ringPassed', { index: ring.index, peer: ctx.net.owner() });
      }
    }
  },

  onUpdate(ctx, dt) {
    const s = ctx.state, t = ctx.transform;
    if (!this.isLocal(ctx)) return;
    // Render-side speed (works for host-simulated remote copies too).
    if (dt > 0) {
      const d = Math.hypot(t.x - (s.rx ?? t.x), t.y - (s.ry ?? t.y), t.z - (s.rz ?? t.z)) / dt;
      s.renderSpeed = ctx.math.damp(s.renderSpeed, Math.min(d, 200), 6, dt);
    }
    s.rx = t.x; s.ry = t.y; s.rz = t.z;
    const W = world(ctx);
    if (s.windLoop) s.windLoop.setVolume(ctx.math.clamp(0.08 + s.renderSpeed / 90, 0, 0.75) * (s.flying ? 1 : 0.5));
    if (W && s.flying) this.collectAround(ctx, W);
    if (s.racing && !s.finished) {
      s.ghostTimer += dt;
      if (s.ghostTimer >= 0.1) {
        s.ghostTimer -= 0.1;
        const q = t.rotation;
        s.ghostPath.push([+t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2), +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3)]);
      }
    }
    if (ctx.time.frame % 4 === 0) {
      if (s.flying) this.drawHud(ctx);
      else if (!s.hudCleared) { s.hudCleared = true; const h = hud(ctx); if (h) for (const id of ['speed', 'alt', 'boostbg', 'boostbar', 'stall', 'flight-mode']) h.remove(id); }
    }
  },

  /** Motes and island discovery are local flavour: only the local player's own glider collects. */
  collectAround(ctx, W) {
    const s = ctx.state, t = ctx.transform;
    for (const e of ctx.findAll('mote')) {
      const mt = ctx.getOn(e, 'Transform');
      if (!mt) continue;
      const dx = mt.x - t.x, dy = mt.y - t.y, dz = mt.z - t.z;
      if (dx * dx + dy * dy + dz * dz < 6.5) {
        s.motes++;
        s.boost = Math.min(1, s.boost + 0.12);
        ctx.destroy(e);
        ctx.audio.play('mote', { volume: 0.45, pitchVariation: 0.08 });
        ctx.send('moteCollected', { count: s.motes, position: { x: mt.x, y: mt.y, z: mt.z } });
      }
    }
    if (ctx.time.frame % 15 === 0) {
      const near = W.nearestIsland(t.position);
      if (near && near.distance < 26 && !s.discovered[near.island.id]) {
        s.discovered[near.island.id] = true;
        const count = Object.keys(s.discovered).length;
        ctx.send('discover', { name: near.island.name, biome: near.island.biome, count, total: W.islands.length });
        ctx.audio.play('discover', { volume: 0.4 });
      }
    }
  },

  drawHud(ctx) {
    const h = hud(ctx);
    if (!h) return;
    const s = ctx.state, t = ctx.transform;
    const speed = Math.round(s.renderSpeed * 3.6);
    const W = world(ctx);
    const ground = W ? W.groundBelow(t.position) : null;
    const alt = Math.max(0, Math.round(t.y - (ground ? ground.y : (W ? W.bounds.minY - 40 : 0))));
    const el = h.text('speed', `${speed}`, { anchor: 'bottom', y: 54, x: 0 });
    el.style.cssText += 'font-size:44px;font-weight:200;letter-spacing:0.04em;text-align:center;line-height:1;font-variant-numeric:tabular-nums;';
    const alte = h.text('alt', `${alt} m  ·  ${ground ? 'over ' + ground.island.name : 'open sky'}`, { anchor: 'bottom', y: 40, x: 0 });
    alte.style.cssText += 'font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.75;text-align:center;';
    const bg = h.text('boostbg', '', { anchor: 'bottom', y: 26, x: 0 });
    bg.style.cssText += 'width:180px;height:4px;border-radius:2px;background:rgba(255,255,255,0.18);';
    const bar = h.text('boostbar', '', { anchor: 'bottom', y: 26, x: 0 });
    const w = Math.round(180 * s.boost);
    bar.style.cssText += `height:4px;border-radius:2px;background:linear-gradient(90deg,#ffd166,#ff7a3d);box-shadow:0 0 12px rgba(255,209,102,0.6);transition:width 0.1s;`;
    bar.style.width = `${w}px`;
    bar.style.marginLeft = `${-90 + w / 2}px`;
    bg.style.marginLeft = '0px';
    const stall = h.text('stall', s.stallAmount > 0.2 && s.flying ? 'STALL  ·  dive to recover' : '', { anchor: 'center', y: -70, x: 0 });
    stall.style.cssText += 'font-size:13px;letter-spacing:0.25em;color:#ffd166;text-align:center;';
    stall.style.opacity = String(s.stallAmount);
    let mode = '';
    if (s.racing && !s.finished) mode = `Gate ${Math.min(s.raceGate + 1, W ? W.rings.length : 0)} / ${W ? W.rings.length : 0}   ${(ctx.time.elapsed - s.raceStart).toFixed(1)}s`;
    else if (s.finished) mode = `Finished  ${s.raceTime.toFixed(2)}s`;
    else if (s.flying) mode = `${s.motes} motes  ·  ${Object.keys(s.discovered).length}/${W ? W.islands.length : 0} islands  ·  ${s.gates} rings`;
    const me = h.text('flight-mode', mode, { anchor: 'top-left', y: 12, x: 14 });
    me.style.cssText += 'font-size:13px;letter-spacing:0.12em;opacity:0.85;font-variant-numeric:tabular-nums;';
  },
});
