// Checkpoint marker data (read by the Kart script) plus a gentle bar pulse.
defineScript({
  name: 'Checkpoint',
  description: 'Ordered race checkpoint; index 0 is the start/finish line.',
  props: {
    index: { type: 'integer', default: 0, min: 0 },
    halfX: { type: 'number', default: 7 },
    halfZ: { type: 'number', default: 0.8 },
    heading: { type: 'number', default: 0, label: 'Respawn heading (rad)' },
  },
  onUpdate(ctx) {
    for (const child of ctx.world.getChildren(ctx.entity)) {
      if (ctx.nameOf(child) !== 'Bar') continue;
      const mr = ctx.getOn(child, 'MeshRenderer');
      if (mr) mr.emissive.a = 1, mr.opacity = 0.55 + Math.sin(ctx.time.elapsed * 3 + ctx.props.index) * 0.25;
    }
  },
});
