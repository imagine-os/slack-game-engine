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
    if (ctx.net.isHost) this.becomeHost(ctx);
    this.drawStandings(ctx);
  },
  /** Host migration: the peer that took over directs the race from here on. */
  onHostChanged(ctx, isHost) {
    if (isHost) this.becomeHost(ctx);
  },
  becomeHost(ctx) {
    const s = ctx.state;
    if (s.serving) return;
    s.serving = true;
    const sync = ctx.net.hub.sync;
    this.adoptPlayers(ctx);
    this.addPlayer(ctx, ctx.net.localId);
    if (sync) {
      for (const p of sync.players()) this.addPlayer(ctx, p.peerId);
      s.unsub.push(sync.on('playerJoined', ({ peerId }) => { this.addPlayer(ctx, peerId); this.resendHud(ctx); }));
      s.unsub.push(sync.on('playerLeft', ({ peerId }) => this.removePlayer(ctx, peerId)));
    }
    if (s.finished) ctx.timer(6, () => this.restartRace(ctx));
    else if (!s.raceStarted) this.startCountdown(ctx);
    this.resendHud(ctx);
  },
  /** New host: karts the previous host put on the grid become our players; laps come from the last HUD RPC. */
  adoptPlayers(ctx) {
    const s = ctx.state;
    const known = s.players;
    s.players = {};
    for (const e of ctx.world.with('NetworkIdentity')) {
      const ni = ctx.getOn(e, 'NetworkIdentity');
      if (ni.prefab !== 'Kart') continue;
      const label = ctx.getOn(e, 'Script').props.label || `P${s.count + 1}`;
      const k = known[ni.ownerId] || {};
      const index = k.index !== undefined ? k.index : Math.max(0, (parseInt(label.slice(1), 10) || 1) - 1);
      s.players[ni.ownerId] = { entity: e, index, lap: k.lap || 0, best: k.best || 0 };
      s.count = Math.max(s.count, index + 1);
    }
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
        s.countdown = String(n);
        if (h) h.text('countdown', s.countdown, { anchor: 'center' }).style.fontSize = '72px';
        ctx.audio.play('beep', { volume: 0.5 });
        n--;
        ctx.timer(1, tick);
      } else {
        s.countdown = 'GO!';
        if (h) h.text('countdown', 'GO!', { anchor: 'center' });
        ctx.timer(1, () => { s.countdown = null; if (h) h.remove('countdown'); this.drawStandings(ctx); });
        ctx.audio.play('go', { volume: 0.6 });
        s.raceStarted = true;
        ctx.send('go', {});
      }
      this.drawStandings(ctx);
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
    s.winner = { title: `P${p.index + 1} wins!`, body: `Best lap ${p.best.toFixed(2)}s\nRestarting in 6s` };
    const h = hud(ctx);
    if (h) h.panel('winner', s.winner.title, s.winner.body);
    ctx.audio.play('go', { volume: 0.6 });
    this.drawStandings(ctx);
    ctx.timer(6, () => this.restartRace(ctx));
  },
  restartRace(ctx) {
    const s = ctx.state;
    for (const q of Object.values(s.players)) {
      q.lap = 0; q.best = 0;
      const slot = this.gridSlot(ctx, q.index);
      ctx.sendTo(q.entity, 'resetTo', slot);
    }
    s.finished = false;
    s.winner = null;
    const h = hud(ctx);
    if (h) h.remove('winner');
    this.drawStandings(ctx);
    this.startCountdown(ctx);
  },

  /** Host → clients: the HUD state travels as an RPC on this entity so guests see the same scoreboard. */
  broadcastHud(ctx, payload) {
    if (!ctx.net.isHost || !ctx.net.online) return;
    const json = JSON.stringify(payload);
    if (json === ctx.state.lastHud) return;
    ctx.state.lastHud = json;
    ctx.net.rpc('hud', [payload], 'others');
  },
  /** Force the next broadcast (a newcomer needs the current state even if nothing changed). */
  resendHud(ctx) { ctx.state.lastHud = null; this.drawStandings(ctx); },
  onRpc(ctx, name, args) {
    if (name !== 'hud' || ctx.net.isHost) return;
    const d = args[0];
    const s = ctx.state;
    s.players = d.players;   // { peerId: { index, lap, best } } — no entities on this side
    if (d.raceStarted && !s.raceStarted) ctx.send('go', {});   // local karts start their lap timers
    s.raceStarted = d.raceStarted;
    s.finished = !!d.winner;
    s.winner = d.winner;
    const h = hud(ctx);
    if (h) {
      if (d.countdown) h.text('countdown', d.countdown, { anchor: 'center' }).style.fontSize = '72px'; else h.remove('countdown');
      if (d.winner) h.panel('winner', d.winner.title, d.winner.body); else h.remove('winner');
    }
    this.drawStandings(ctx);
  },
  drawStandings(ctx) {
    const s = ctx.state;
    const rows = {};
    for (const [id, p] of Object.entries(s.players)) rows[id] = { index: p.index, lap: p.lap, best: p.best };
    this.broadcastHud(ctx, { players: rows, raceStarted: !!s.raceStarted, countdown: s.countdown || null, winner: s.winner || null });
    const h = hud(ctx);
    if (!h) return;
    const standings = Object.values(ctx.state.players).sort((a, b) => b.lap - a.lap || (a.best || 1e9) - (b.best || 1e9))
      .map((p, i) => `${i + 1}. P${p.index + 1}  lap ${p.lap}/${ctx.props.laps}${p.best ? `  best ${p.best.toFixed(2)}s` : ''}`);
    h.text('standings', standings.join('\n'), { anchor: 'top-right', y: 48 });
    h.text('hint', 'W/S throttle · A/D steer · E reset kart', { anchor: 'bottom-right' });
  },
});
