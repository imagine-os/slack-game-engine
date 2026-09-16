// One player's build cursor. Follows the pointer from the input snapshot
// (works for remote peers too), snaps to the grid, shows whether the spot is
// valid and asks the GameManager to place a tower on "fire".
function distToPath(path, x, y) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i][0], ay = path[i][1], bx = path[i + 1][0], by = path[i + 1][1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}

defineScript({
  name: 'Builder',
  description: 'Per-player tower placement cursor.',
  props: {
    color: { type: 'string', default: '#4cc2ff', label: 'Colour (hex)' },
    label: { type: 'string', default: 'P1' },
    cost: { type: 'integer', default: 50 },
  },
  onStart(ctx) {
    ctx.state.gold = 0;
    ctx.state.valid = false;
    const plate = ctx.world.getChildren(ctx.entity)[0];
    const text = plate !== undefined ? ctx.getOn(plate, 'Text') : null;
    if (text) { text.text = ctx.props.label; text.color.setHex(ctx.props.color); }
    ctx.send('queryGold', {});
  },
  onMessage(ctx, name, data) {
    if (name === 'goldChanged') ctx.state.gold = data.gold;
  },
  isLocal(ctx) {
    const pi = ctx.playerInput;
    return !!pi && (pi.owner === 'local' || pi.owner === ctx.net.localId);
  },
  /** Snap a world position to the build grid (1-unit cells centred on .5). */
  place(ctx, x, y) {
    const gx = Math.floor(x) + 0.5, gy = Math.floor(y) + 0.5;
    ctx.transform.setPosition(gx, gy);
    const gm = ctx.find('GameManager');
    const p = gm !== undefined ? ctx.getOn(gm, 'Script').props : null;
    let valid = !!p && Math.abs(gx) <= p.mapWidth / 2 - 0.5 && Math.abs(gy) <= p.mapHeight / 2 - 0.5 && distToPath(p.path, gx, gy) >= p.pathClearance;
    if (valid) for (const t of ctx.findAll('tower')) { const tt = ctx.getOn(t, 'Transform'); if (Math.abs(tt.x - gx) < 0.9 && Math.abs(tt.y - gy) < 0.9) { valid = false; break; } }
    ctx.state.valid = valid;
    const shape = ctx.get('Shape');
    if (shape) shape.stroke.setHex(!valid ? '#ef476f' : ctx.state.gold >= ctx.props.cost ? ctx.props.color : '#ffd166');
  },
  build(ctx) {
    if (ctx.state.valid) ctx.send('placeTower', { x: ctx.transform.x, y: ctx.transform.y, by: ctx.net.owner() });
  },
  onOwnerInput(ctx, snap) {
    if (snap.pointer) this.place(ctx, snap.pointer.x, snap.pointer.y);
    if (snap.pressed.includes('fire')) this.build(ctx);
  },
  onUpdate(ctx) {
    // Touch fallback for the local player: a tap aims and builds in one go
    // (a quick tap starts and ends between frames, so use the tap counter).
    if (!this.isLocal(ctx)) return;
    const touch = ctx.input.touch;
    if (touch.taps > 0) {
      const w = ctx.engine.screenToWorld(touch.lastPosition.x, touch.lastPosition.y);
      this.place(ctx, w.x, w.y);
      this.build(ctx);
    } else if (touch.touches.length > 0) {
      const p = touch.touches[0].position;
      const w = ctx.engine.screenToWorld(p.x, p.y);
      this.place(ctx, w.x, w.y);
    }
  },
});
