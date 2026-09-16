// The level exit: waves gently; players touching it complete the level.
defineScript({
  name: 'Goal',
  description: 'Level goal flag.',
  onUpdate(ctx) {
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.width = 1 + Math.sin(ctx.time.elapsed * 4) * 0.06;
  },
});
