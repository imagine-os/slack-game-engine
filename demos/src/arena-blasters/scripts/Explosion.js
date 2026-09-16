// One-shot particle burst with a light flash; destroys itself afterwards.
defineScript({
  name: 'Explosion',
  description: 'Particle burst that removes itself.',
  props: {
    count: { type: 'integer', default: 30, min: 1, max: 500 },
    duration: { type: 'number', default: 0.9, min: 0.1, max: 5 },
    color: { type: 'string', default: '#ffd166', label: 'Colour (hex)' },
    shake: { type: 'number', default: 0, min: 0, max: 2, label: 'Camera shake' },
    light: { type: 'number', default: 2, min: 0, max: 10, label: 'Flash intensity' },
  },
  onStart(ctx) {
    const em = ctx.get('ParticleEmitter');
    em.startColor.setHex(ctx.props.color);
    em.endColor.setHex(ctx.props.color); em.endColor.a = 0;
    em.burst(ctx.props.count);
    const light = ctx.get('Light2D');
    if (light) { light.intensity = ctx.props.light; light.color.setHex(ctx.props.color); }
    if (ctx.props.shake > 0) {
      const cam = ctx.find('Camera');
      const c = cam !== undefined ? ctx.getOn(cam, 'Camera2D') : null;
      if (c) c.shake = Math.max(c.shake, ctx.props.shake);
    }
    ctx.timer(ctx.props.duration, () => ctx.destroy());
  },
  onUpdate(ctx, dt) {
    const light = ctx.get('Light2D');
    if (light) light.intensity = Math.max(0, light.intensity - dt * ctx.props.light * 3);
  },
});
