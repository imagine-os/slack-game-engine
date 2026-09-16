// A player ship. Input arrives through onOwnerInput so the same script
// drives the local player and remote players on the host.
function arena(ctx) {
  const gm = ctx.find('GameManager');
  const p = gm ? ctx.getOn(gm, 'Script').props : null;
  return { w: (p && p.arenaWidth) || 32, h: (p && p.arenaHeight) || 18 };
}
function wrap(ctx) {
  const { w, h } = arena(ctx);
  const t = ctx.transform;
  let x = t.x, y = t.y, moved = false;
  if (x < -w / 2) { x += w; moved = true; } else if (x > w / 2) { x -= w; moved = true; }
  if (y < -h / 2) { y += h; moved = true; } else if (y > h / 2) { y -= h; moved = true; }
  if (moved) t.setPosition(x, y);
}

defineScript({
  name: 'Ship',
  description: 'Thrust/rotate (or twin-stick) ship with a blaster.',
  props: {
    controlMode: { type: 'enum', default: 'rotate', options: ['rotate', 'twin-stick'] },
    thrust: { type: 'number', default: 22, min: 1, max: 100 },
    turnSpeed: { type: 'number', default: 4.2, min: 0.5, max: 12, label: 'Turn speed (rad/s)' },
    maxSpeed: { type: 'number', default: 10, min: 1, max: 40 },
    fireInterval: { type: 'number', default: 0.16, min: 0.02, max: 2 },
    bulletSpeed: { type: 'number', default: 18, min: 1, max: 60 },
    hp: { type: 'integer', default: 3, min: 1, max: 20 },
    respawnDelay: { type: 'number', default: 2 },
    color: { type: 'string', default: '#4cc2ff', label: 'Colour (hex)' },
    label: { type: 'string', default: 'P1' },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.hp = ctx.props.hp;
    s.cooldown = 0;
    s.dead = false;
    s.invuln = 1;
    s.spawn = { x: ctx.transform.x, y: ctx.transform.y };
    this.applyLook(ctx);
  },
  onReload(ctx) { this.applyLook(ctx); },
  applyLook(ctx) {
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.tint.setHex(ctx.props.color);
    const light = ctx.get('Light2D');
    if (light) light.color.setHex(ctx.props.color);
    const em = ctx.get('ParticleEmitter');
    if (em) em.startColor.setHex(ctx.props.color);
    const plate = ctx.world.getChildren(ctx.entity)[0];
    const text = plate !== undefined ? ctx.getOn(plate, 'Text') : null;
    if (text) { text.text = ctx.props.label; text.color.setHex(ctx.props.color); }
  },

  onOwnerInput(ctx, snap, dt) {
    const s = ctx.state;
    if (s.dead) return;
    const rb = ctx.get('RigidBody2D');
    const t = ctx.transform;
    const mx = snap.axes.moveX || 0, my = snap.axes.moveY || 0;
    let thrusting = false;
    if (ctx.props.controlMode === 'twin-stick') {
      const len = Math.hypot(mx, my);
      if (len > 0.15) {
        const target = Math.atan2(my, mx) - Math.PI / 2;
        t.angle = ctx.math.lerpAngle(t.angle, target, Math.min(1, ctx.props.turnSpeed * 2 * dt));
        rb.applyForce(Math.cos(target + Math.PI / 2) * ctx.props.thrust * len, Math.sin(target + Math.PI / 2) * ctx.props.thrust * len);
        thrusting = true;
      }
    } else {
      if (mx !== 0) t.angle -= mx * ctx.props.turnSpeed * dt;
      if (my > 0.05) {
        const a = t.angle + Math.PI / 2;
        rb.applyForce(Math.cos(a) * ctx.props.thrust * my, Math.sin(a) * ctx.props.thrust * my);
        thrusting = true;
      } else if (my < -0.05) {
        rb.velocity.scale(1 - 0.9 * dt); // gentle brake
      }
    }
    const sp = rb.velocity.length();
    if (sp > ctx.props.maxSpeed) rb.velocity.scale(ctx.props.maxSpeed / sp);
    const em = ctx.get('ParticleEmitter');
    if (em) { em.emitting = thrusting; em.angle = t.angle - Math.PI / 2; }

    s.cooldown -= dt;
    if (snap.held.includes('fire') && s.cooldown <= 0) {
      s.cooldown = ctx.props.fireInterval;
      this.fire(ctx, rb);
    }
  },
  fire(ctx, rb) {
    const t = ctx.transform;
    const a = t.angle + Math.PI / 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const bullet = ctx.net.spawn('Bullet', { position: { x: t.x + dx * 0.8, y: t.y + dy * 0.8 } });
    const brb = ctx.getOn(bullet, 'RigidBody2D');
    brb.setVelocity(rb.velocity.x * 0.5 + dx * ctx.props.bulletSpeed, rb.velocity.y * 0.5 + dy * ctx.props.bulletSpeed);
    const script = ctx.getOn(bullet, 'Script');
    script.props.shooter = ctx.entity;
    script.props.shooterId = ctx.net.owner();
    script.props.color = ctx.props.color;
    const shape = ctx.getOn(bullet, 'Shape');
    if (shape) shape.fill.setHex(ctx.props.color);
    rb.applyImpulse(-dx * 0.4, -dy * 0.4);
    ctx.audio.play('laser', { volume: 0.5, pitchVariation: 0.1 });
  },

  onFixedUpdate(ctx, dt) {
    const s = ctx.state;
    if (s.dead) return;
    wrap(ctx);
    if (s.invuln > 0) {
      s.invuln -= dt;
      const sprite = ctx.get('Sprite');
      if (sprite) sprite.alpha = s.invuln > 0 ? 0.45 + 0.4 * Math.sin(ctx.time.elapsed * 30) : 1;
    }
  },
  onLateUpdate(ctx) {
    // Keep the name plate upright.
    const plate = ctx.world.getChildren(ctx.entity)[0];
    if (plate !== undefined) { const pt = ctx.getOn(plate, 'Transform'); pt.angle = -ctx.transform.angle; }
  },

  onCollisionEnter(ctx, other, info) {
    if (!ctx.net.isHost || ctx.state.dead) return;
    const tag = ctx.getOn(other, 'Tag');
    if (tag && tag.has('asteroid') && info.impulse > 5) this.damage(ctx, 1, null);
    else if (info.impulse > 3) ctx.audio.play('hit', { volume: 0.3 });
  },
  onMessage(ctx, name, data) {
    if (name === 'hit' && ctx.net.isHost) this.damage(ctx, data.damage, data.from);
  },
  damage(ctx, amount, from) {
    const s = ctx.state;
    if (s.dead || s.invuln > 0) return;
    s.hp -= amount;
    const sprite = ctx.get('Sprite');
    if (s.hp > 0) {
      if (sprite) { sprite.tint.setHex('#ffffff'); ctx.timer(0.08, () => sprite.tint.setHex(ctx.props.color)); }
      ctx.audio.play('hit', { volume: 0.6 });
      return;
    }
    s.dead = true;
    const boom = ctx.net.spawn('Explosion', { position: { x: ctx.transform.x, y: ctx.transform.y } });
    const bs = ctx.getOn(boom, 'Script');
    bs.props.color = ctx.props.color;
    bs.props.count = 60;
    bs.props.shake = 0.45;
    ctx.audio.play('explosion', { volume: 0.9 });
    ctx.send('shipDestroyed', { victim: ctx.net.owner(), killer: from });
    // Park the ship far away while dead; kinematic so nothing collides with it.
    const rb = ctx.get('RigidBody2D');
    rb.setVelocity(0, 0);
    rb.bodyType = 'kinematic';
    ctx.transform.setPosition(0, 1000);
    if (sprite) sprite.visible = false;
    const em = ctx.get('ParticleEmitter');
    if (em) em.emitting = false;
    ctx.timer(ctx.props.respawnDelay, () => this.respawn(ctx));
  },
  respawn(ctx) {
    const s = ctx.state;
    const { w, h } = arena(ctx);
    let x = 0, y = 0;
    for (let i = 0; i < 10; i++) {
      x = ctx.random.range(-w / 2 + 2, w / 2 - 2); y = ctx.random.range(-h / 2 + 2, h / 2 - 2);
      if (ctx.physics.overlapCircle({ x, y }, 3).length === 0) break;
    }
    const rb = ctx.get('RigidBody2D');
    rb.bodyType = 'dynamic';
    rb.setVelocity(0, 0);
    ctx.transform.setPosition(x, y);
    s.hp = ctx.props.hp;
    s.dead = false;
    s.invuln = 1.5;
    const sprite = ctx.get('Sprite');
    if (sprite) { sprite.visible = true; sprite.tint.setHex(ctx.props.color); }
  },
});
