// Keeps the whole arena visible whatever the canvas size.
defineScript({
  name: 'ArenaCamera',
  description: 'Fits the camera zoom to the arena.',
  props: { margin: { type: 'number', default: 0.5, min: 0, max: 5 } },
  onUpdate(ctx) {
    const r = ctx.engine.renderer;
    if (!r) return;
    const gm = ctx.find('GameManager');
    const p = gm !== undefined ? ctx.getOn(gm, 'Script').props : null;
    const w = ((p && p.arenaWidth) || 32) + ctx.props.margin * 2;
    const h = ((p && p.arenaHeight) || 18) + ctx.props.margin * 2;
    const cam = ctx.get('Camera2D');
    cam.zoom = Math.min(r.width / (r.pixelsPerUnit * w), r.height / (r.pixelsPerUnit * h));
  },
});
