// Invisible camera target that sits at the average position of every living
// player, so a following Camera2D frames the whole team.
defineScript({
  name: 'MultiFollow',
  description: 'Averages the positions of tagged entities.',
  props: {
    tag: { type: 'string', default: 'player' },
    lookAhead: { type: 'number', default: 0.6, min: 0, max: 5, label: 'Look-ahead per unit of velocity' },
  },
  onUpdate(ctx) {
    let x = 0, y = 0, n = 0;
    for (const e of ctx.findAll(ctx.props.tag)) {
      const t = ctx.getOn(e, 'Transform');
      const sprite = ctx.getOn(e, 'Sprite');
      if (sprite && !sprite.visible) continue;
      const rb = ctx.getOn(e, 'RigidBody2D');
      x += t.x + (rb ? rb.velocity.x * ctx.props.lookAhead * 0.1 : 0);
      y += t.y;
      n++;
    }
    if (n > 0) ctx.transform.setPosition(x / n, y / n);
  },
});
