// Repeating background layer. Children are tiles of width `tileWidth`; the
// root moves at `factor` of the camera speed and re-tiles around the camera.
defineScript({
  name: 'Parallax',
  description: 'Scrolls child sprites slower than the camera.',
  props: {
    factor: { type: 'number', default: 0.7, min: 0, max: 1, label: 'Camera speed fraction' },
    factorY: { type: 'number', default: 0.2, min: 0, max: 1 },
    tileWidth: { type: 'number', default: 32, min: 1 },
    baseY: { type: 'number', default: 9 },
  },
  onLateUpdate(ctx) {
    const cam = ctx.find('Camera');
    if (cam === undefined) return;
    const ct = ctx.getOn(cam, 'Transform');
    const w = ctx.props.tileWidth;
    const rootX = ct.x * ctx.props.factor;
    ctx.transform.setPosition(rootX, ctx.props.baseY + ct.y * ctx.props.factorY);
    const children = ctx.world.getChildren(ctx.entity);
    const center = Math.round((ct.x - rootX) / w) * w;
    children.forEach((child, i) => {
      const t = ctx.getOn(child, 'Transform');
      t.setPosition(center + (i - (children.length - 1) / 2) * w, t.y);
    });
  },
});
