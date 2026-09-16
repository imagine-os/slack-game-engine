// Fit the whole map into the canvas.
defineScript({
  name: 'MapCamera',
  description: 'Fits the camera zoom to the map.',
  props: { width: { type: 'number', default: 37 }, height: { type: 'number', default: 19 } },
  onUpdate(ctx) {
    const r = ctx.engine.renderer;
    if (!r) return;
    ctx.get('Camera2D').zoom = Math.min(r.width / (r.pixelsPerUnit * ctx.props.width), r.height / (r.pixelsPerUnit * ctx.props.height));
  },
});
