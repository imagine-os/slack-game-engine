// Fit the whole table into the canvas.
defineScript({
  name: 'TableCamera',
  description: 'Fits the camera zoom to the table.',
  props: { width: { type: 'number', default: 26 }, height: { type: 'number', default: 16 } },
  onUpdate(ctx) {
    const r = ctx.engine.renderer;
    if (!r) return;
    ctx.get('Camera2D').zoom = Math.min(r.width / (r.pixelsPerUnit * ctx.props.width), r.height / (r.pixelsPerUnit * ctx.props.height));
  },
});
