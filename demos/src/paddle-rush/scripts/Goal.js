// Trigger zone behind each side; tells the GameManager which goal the puck entered.
defineScript({
  name: 'Goal',
  description: 'Reports the puck entering this goal.',
  props: { side: { type: 'enum', default: 'left', options: ['left', 'right'] } },
  onTriggerEnter(ctx, other) {
    if (ctx.nameOf(other) === 'Puck') ctx.send('goal', { side: ctx.props.side });
  },
});
