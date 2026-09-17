// Race gate visuals: the glowing segments pulse, flash white when a glider
// flies through and settle to green once the local player passed the gate in a
// race. Detection lives in the Glider script (segment vs. gate plane).
defineScript({
  name: 'Ring',
  description: 'Gate ring glow and pass feedback.',
  props: { index: { type: 'integer', default: 0 } },
  onStart(ctx) {
    const s = ctx.state;
    s.glow = [];
    for (const c of ctx.world.getChildren(ctx.entity)) {
      const mr = ctx.getOn(c, 'MeshRenderer');
      if (mr && ctx.nameOf(c) === 'ring-glow') { s.glow.push(mr); s.base = mr.color.clone(); }
    }
    s.flash = 0; s.passed = false; s.next = false;
  },
  onMessage(ctx, name, data) {
    const s = ctx.state;
    if (name === 'ringPassed' && data.index === ctx.props.index) { s.flash = 1; if (data.peer === ctx.net.localId || data.peer === 'local') s.passed = true; }
    else if (name === 'raceState') { s.passed = false; s.next = false; }
    else if (name === 'nextGate') s.next = data.index === ctx.props.index;
  },
  onUpdate(ctx, dt) {
    const s = ctx.state;
    if (!s.glow || !s.glow.length) return;
    s.flash = Math.max(0, s.flash - dt * 2.2);
    const pulse = 0.55 + 0.45 * Math.sin(ctx.time.elapsed * 2.5 + ctx.props.index * 0.9);
    for (const mr of s.glow) {
      if (s.passed) mr.color.set(0.45, 0.95, 0.6, 1);
      else if (s.next) mr.color.set(1, 1, 1, 1).lerp(s.base, 0.35 + 0.35 * pulse);
      else mr.color.copy(s.base);
      const k = (s.next ? 0.7 : 0.35) + 0.35 * pulse + s.flash * 0.8;
      mr.emissive.set(mr.color.r * k, mr.color.g * k, mr.color.b * k, 1);
    }
  },
});
