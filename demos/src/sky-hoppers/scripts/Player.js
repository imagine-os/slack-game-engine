// Platformer character. Movement goes through CharacterController2D; coins,
// spikes, checkpoints and the goal are triggers identified by tag.
defineScript({
  name: 'Player',
  description: 'Co-op platformer hero.',
  props: {
    speed: { type: 'number', default: 7.5, min: 1, max: 20 },
    jump: { type: 'number', default: 14.5, min: 1, max: 40 },
    fallLimit: { type: 'number', default: -3, label: 'Y below which the player dies' },
    respawnDelay: { type: 'number', default: 1 },
    color: { type: 'string', default: '#4cc2ff', label: 'Colour (hex)' },
    label: { type: 'string', default: 'P1' },
  },
  onStart(ctx) {
    const cc = ctx.get('CharacterController2D');
    cc.moveSpeed = ctx.props.speed;
    cc.jumpSpeed = ctx.props.jump;
    ctx.state.dead = false;
    ctx.state.wasGrounded = true;
    this.applyLook(ctx);
  },
  onReload(ctx) { this.applyLook(ctx); },
  applyLook(ctx) {
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.tint.setHex(ctx.props.color);
    const plate = ctx.world.getChildren(ctx.entity)[0];
    const text = plate !== undefined ? ctx.getOn(plate, 'Text') : null;
    if (text) { text.text = ctx.props.label; text.color.setHex(ctx.props.color); }
  },

  onOwnerInput(ctx, snap) {
    if (ctx.state.dead) return;
    const cc = ctx.get('CharacterController2D');
    cc.move(snap.axes.moveX || 0);
    if (snap.pressed.includes('jump')) {
      cc.jump();
      if (cc.grounded) ctx.audio.play('jump', { volume: 0.35, pitchVariation: 0.08 });
    }
    if (snap.released.includes('jump')) cc.jumpReleased();
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.flipX = cc.facing < 0;
  },
  onFixedUpdate(ctx, dt) {
    if (ctx.state.dead) return;
    const rb = ctx.get('RigidBody2D');
    const cc = ctx.get('CharacterController2D');
    // Ride kinematic platforms: carry the position by the platform's velocity.
    for (const c of rb.contacts) {
      if (c.ny <= 0.5) continue;
      const other = ctx.getOn(c.other, 'RigidBody2D');
      if (other && other.bodyType === 'kinematic') ctx.transform.translate(other.velocity.x * dt, other.velocity.y * dt);
    }
    // Squash and stretch.
    const sprite = ctx.get('Sprite');
    if (sprite) {
      const vy = rb.velocity.y;
      const target = cc.grounded ? 1 : 1 + ctx.math.clamp(Math.abs(vy) * 0.02, 0, 0.25);
      sprite.height = ctx.math.damp(sprite.height, 1.1 * target, 12, dt);
      sprite.width = ctx.math.damp(sprite.width, 0.9 / target, 12, dt);
    }
    if (cc.grounded && !ctx.state.wasGrounded && rb.velocity.y <= 0.01) {
      const em = ctx.get('ParticleEmitter');
      if (em) em.burst(6);
    }
    ctx.state.wasGrounded = cc.grounded;
    if (ctx.transform.y < ctx.props.fallLimit) this.die(ctx);
  },
  onTriggerEnter(ctx, other) {
    if (!ctx.net.isHost || ctx.state.dead) return;
    const tag = ctx.getOn(other, 'Tag');
    if (!tag) return;
    const me = ctx.net.owner();
    if (tag.has('coin')) ctx.sendTo(other, 'collect', { by: me });
    else if (tag.has('hazard')) this.die(ctx);
    else if (tag.has('checkpoint')) { const t = ctx.getOn(other, 'Transform'); ctx.send('checkpoint', { x: t.x, y: t.y, entity: other }); }
    else if (tag.has('goal')) ctx.send('goal', { by: me });
  },
  die(ctx) {
    if (!ctx.net.isHost || ctx.state.dead) return;
    ctx.state.dead = true;
    const em = ctx.get('ParticleEmitter');
    if (em) em.burst(24);
    ctx.audio.play('hit', { volume: 0.7 });
    const cam = ctx.find('Camera');
    const c = cam !== undefined ? ctx.getOn(cam, 'Camera2D') : null;
    if (c) c.shake = 0.25;
    const rb = ctx.get('RigidBody2D');
    rb.setVelocity(0, 0);
    rb.bodyType = 'kinematic';
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.visible = false;
    ctx.timer(ctx.props.respawnDelay, () => ctx.send('respawnRequest', { entity: ctx.entity }));
  },
  onMessage(ctx, name) {
    if (name !== 'respawned') return;
    const rb = ctx.get('RigidBody2D');
    rb.bodyType = 'dynamic';
    rb.setVelocity(0, 0);
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.visible = true;
    ctx.state.dead = false;
  },
});
