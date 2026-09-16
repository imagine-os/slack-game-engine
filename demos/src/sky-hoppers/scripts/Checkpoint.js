// Flag post that lights up once reached; the GameManager stores the position.
defineScript({
  name: 'Checkpoint',
  description: 'Respawn point shared by every player.',
  onMessage(ctx, name) {
    const sprite = ctx.get('Sprite');
    if (!sprite) return;
    if (name === 'activate') { sprite.tint.setHex('#06d6a0'); ctx.state.active = true; }
    else if (name === 'reset') { sprite.tint.setHex('#ffffff'); ctx.state.active = false; }
  },
  onUpdate(ctx) {
    if (!ctx.state.active) return;
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.alpha = 0.85 + Math.sin(ctx.time.elapsed * 6) * 0.15;
  },
});
