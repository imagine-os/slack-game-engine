// Moves the player with the shared "moveX" axis and "jump" action.
// Reads input through onOwnerInput so the same script drives local and
// remote players in multiplayer rooms.
defineScript({
  name: 'PlayerController',
  description: 'Platformer movement on top of CharacterController2D.',
  props: {
    speed: { type: 'number', default: 7, min: 1, max: 20, label: 'Run speed' },
    jump: { type: 'number', default: 12, min: 1, max: 30, label: 'Jump speed' },
    respawnY: { type: 'number', default: -8, label: 'Fall below this to respawn' },
  },
  onStart(ctx) {
    const cc = ctx.get('CharacterController2D');
    cc.moveSpeed = ctx.props.speed;
    cc.jumpSpeed = ctx.props.jump;
    ctx.state.spawn = { x: ctx.transform.x, y: ctx.transform.y };
  },
  onOwnerInput(ctx, snap) {
    const cc = ctx.get('CharacterController2D');
    cc.move(snap.axes.moveX || 0);
    if (snap.pressed.includes('jump')) cc.jump();
    if (snap.released.includes('jump')) cc.jumpReleased();
    const sprite = ctx.get('Sprite');
    if (sprite && cc.facing) sprite.flipX = cc.facing < 0;
  },
  onFixedUpdate(ctx) {
    if (ctx.transform.y < ctx.props.respawnY) {
      const rb = ctx.get('RigidBody2D');
      rb.setVelocity(0, 0);
      ctx.transform.setPosition(ctx.state.spawn.x, ctx.state.spawn.y);
    }
  },
});
