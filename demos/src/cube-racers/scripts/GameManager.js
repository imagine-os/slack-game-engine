// Race director: puts one Kart per player on the grid, runs the countdown,
// tracks laps and declares the winner.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }

const COLORS = ['#ff7a3d', '#4cc2ff', '#8b7dff', '#ffd166', '#06d6a0', '#ef476f'];

defineScript({
  name: 'GameManager',
  description: 'Grid, countdown, laps and winner.',
  props: {
    laps: { type: 'integer', default: 3, min: 1, max: 20 },
    countdown: { type: 'integer', default: 3, min: 0, max: 10 },
    gridX: { type: 'number', default: 28, label: 'Grid centre X' },
    gridZ: { type: 'number', default: 4, label: 'Grid centre Z' },
    heading: { type: 'number', default: 3.14159, label: 'Start heading (rad)' },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.players = {};
    s.count = 0;
    s.unsub = [];
    s.finished = false;
    if (ctx.net.isHost) {
      this.addPlayer(ctx, ctx.net.localId);
      const sync = ctx.net.hub.sync;
      if (sync) {
        for (const p of sync.players()) if (p.peerId !== ctx.net.localId) this.addPlayer(ctx, p.peerId);
        s.unsub.push(sync.on('playerJoined', ({ peerId }) => this.addPlayer(ctx, peerId)));
        s.unsub.push(sync.on('playerLeft', ({ peerId }) => this.removePlayer(ctx, peerId)));
      }
      this.startCountdown(ctx);
    }
    this.drawStandings(ctx);
  },
  onDestroy(ctx) {
    for (const off of ctx.state.unsub) off();
    const h = hud(ctx);
    if (h) { h.remove('countdown'); h.remove('standings'); h.remove('winner'); h.remove('hint'); }
  },
  gridSlot(ctx, index) {
    // Two columns, staggered rows, behind the start line.
    const col = index % 2, row = Math.floor(index / 2);
    return { x: ctx.props.gridX + (col === 0 ? -2.5 : 2.5), y: 0.6, z: ctx.props.gridZ + row * 3.5 + col * 1.5 };
  },
  addPlayer(ctx, peerId) {
    const s = ctx.state;
    if (s.players[peerId]) return;
    const index = s.count++;
    const slot = this.gridSlot(ctx, index);
    const entity = ctx.net.spawn('Kart', { ownerId: peerId, position: slot });
    const pi = ctx.getOn(entity, 'PlayerInput');
    if (pi) pi.owner = peerId;
    const ni = ctx.getOn(entity, 'NetworkIdentity');
    if (ni) ni.ownerId = peerId;
    const name = ctx.getOn(entity, 'Name');
    if (name) name.name = `Kart ${peerId}`;
    const script = ctx.getOn(entity, 'Script');
    script.props.color = COLORS[index % COLORS.length];
    script.props.label = `P${index + 1}`;
    script.props.heading = ctx.props.heading;
    script.props.laps = ctx.props.laps;
    s.players[peerId] = { entity, index, lap: 0, best: 0 };
    if (s.raceStarted) ctx.sendTo(entity, 'go');
  },
  removePlayer(ctx, peerId) {
    const p = ctx.state.players[peerId];
    if (!p) return;
    if (ctx.world.isAlive(p.entity)) {
      const sync = ctx.net.hub.sync;
      if (sync) sync.despawn(p.entity); else ctx.destroy(p.entity);
    }
    delete ctx.state.players[peerId];
  },
  startCountdown(ctx) {
    const s = ctx.state;
    s.raceStarted = false;
    let n = ctx.props.countdown;
    const h = hud(ctx);
    const tick = () => {
      if (n > 0) {
        if (h) h.text('countdown', String(n), { anchor: 'center' }).style.fontSize = '72px';
        ctx.audio.play('beep', { volume: 0.5 });
        n--;
        ctx.timer(1, tick);
      } else {
        if (h) { h.text('countdown', 'GO!', { anchor: 'center' }); ctx.timer(1, () => h.remove('countdown')); }
        ctx.audio.play('go', { volume: 0.6 });
        s.raceStarted = true;
        ctx.send('go', {});
      }
    };
    tick();
  },
  onMessage(ctx, name, data) {
    if (!ctx.net.isHost) return;
    if (name === 'lapDone') {
      const p = ctx.state.players[data.peer];
      if (!p) return;
      p.lap = data.lap;
      p.best = p.best ? Math.min(p.best, data.time) : data.time;
      this.drawStandings(ctx);
      if (p.lap >= ctx.props.laps && !ctx.state.finished) this.finish(ctx, data.peer);
    }
  },
  finish(ctx, peerId) {
    const s = ctx.state;
    s.finished = true;
    const p = s.players[peerId];
    const h = hud(ctx);
    if (h) h.panel('winner', `P${p.index + 1} wins!`, `Best lap ${p.best.toFixed(2)}s\nRestarting in 6s`);
    ctx.audio.play('go', { volume: 0.6 });
    ctx.timer(6, () => {
      for (const q of Object.values(s.players)) {
        q.lap = 0; q.best = 0;
        const slot = this.gridSlot(ctx, q.index);
        ctx.sendTo(q.entity, 'resetTo', slot);
      }
      s.finished = false;
      if (h) h.remove('winner');
      this.drawStandings(ctx);
      this.startCountdown(ctx);
    });
  },
  drawStandings(ctx) {
    const h = hud(ctx);
    if (!h) return;
    const rows = Object.values(ctx.state.players).sort((a, b) => b.lap - a.lap || (a.best || 1e9) - (b.best || 1e9))
      .map((p, i) => `${i + 1}. P${p.index + 1}  lap ${p.lap}/${ctx.props.laps}${p.best ? `  best ${p.best.toFixed(2)}s` : ''}`);
    h.text('standings', rows.join('\n'), { anchor: 'top-right', y: 48 });
    h.text('hint', 'W/S throttle · A/D steer · E reset kart', { anchor: 'bottom-right' });
  },
});
