// Bobbing, spinning coin. Collected by a "collect" message from a player.
defineScript({
  name: 'Coin',
  description: 'Collectible coin.',
  props: { bob: { type: 'number', default: 0.12, min: 0, max: 1 } },
  onStart(ctx) {
    ctx.state.baseY = ctx.transform.y;
    ctx.state.phase = (ctx.transform.x * 0.7) % (Math.PI * 2);
    ctx.state.taken = false;
  },
  onUpdate(ctx) {
    const t = ctx.time.elapsed + ctx.state.phase;
    ctx.transform.y = ctx.state.baseY + Math.sin(t * 3) * ctx.props.bob;
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.width = 0.6 * Math.abs(Math.cos(t * 2.5)) + 0.05;
  },
  onMessage(ctx, name, data) {
    if (name !== 'collect' || ctx.state.taken || !ctx.net.isHost) return;
    ctx.state.taken = true;
    ctx.audio.play('coin', { volume: 0.5, pitchVariation: 0.05 });
    const em = ctx.get('ParticleEmitter');
    if (em) em.burst(10);
    const sprite = ctx.get('Sprite');
    if (sprite) sprite.visible = false;
    ctx.send('coinCollected', { by: data && data.by });
    const sync = ctx.net.hub.sync;
    ctx.timer(0.4, () => { if (sync) sync.despawn(ctx.entity); else ctx.destroy(); });
  },
});
