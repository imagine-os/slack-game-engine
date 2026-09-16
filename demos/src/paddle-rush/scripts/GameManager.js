// Match flow for air hockey: assigns players to paddles (one per side, or
// whole teams sharing a paddle in team mode), serves the puck, keeps score.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }

defineScript({
  name: 'GameManager',
  description: 'Assigns paddles, serves, scores, first to N wins.',
  props: {
    scoreToWin: { type: 'integer', default: 7, min: 1, max: 99 },
    serveDelay: { type: 'number', default: 1.2, min: 0, max: 5 },
    serveSpeed: { type: 'number', default: 7, min: 1, max: 30 },
    teamMode: { type: 'boolean', default: true, label: 'Team mode (players share paddles)' },
    aiWhenAlone: { type: 'boolean', default: true, label: 'AI controls an empty paddle' },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.score = { left: 0, right: 0 };
    s.teams = { left: [], right: [] };
    s.unsub = [];
    s.over = false;
    s.paddles = { left: ctx.find('Paddle Left'), right: ctx.find('Paddle Right') };
    if (ctx.net.isHost) this.becomeHost(ctx);
    this.drawHud(ctx);
  },
  /** Host migration: the peer that took over seats players, serves and scores from here on. */
  onHostChanged(ctx, isHost) {
    if (isHost) this.becomeHost(ctx);
  },
  becomeHost(ctx) {
    const s = ctx.state;
    if (s.serving) return;
    s.serving = true;
    const sync = ctx.net.hub.sync;
    if (sync) {
      // Teams come from the last HUD RPC when we take over: drop peers that are gone, seat everyone else.
      const present = new Set(sync.players().map((p) => p.peerId));
      for (const side of ['left', 'right']) s.teams[side] = s.teams[side].filter((p) => present.has(p));
      for (const p of sync.players()) this.assign(ctx, p.peerId);
      s.unsub.push(sync.on('playerJoined', ({ peerId }) => { this.assign(ctx, peerId); this.resendHud(ctx); }));
      s.unsub.push(sync.on('playerLeft', ({ peerId }) => this.unassign(ctx, peerId)));
    } else this.assign(ctx, ctx.net.localId);
    this.refreshControllers(ctx);
    if (s.over) ctx.timer(4, () => this.newMatch(ctx));
    else if (this.puckIdle(ctx)) ctx.timer(ctx.props.serveDelay, () => this.serve(ctx, ctx.random.chance(0.5) ? 1 : -1));
    this.resendHud(ctx);
  },
  /** True when the puck is (nearly) still: a fresh table, or a serve the old host never got to. */
  puckIdle(ctx) {
    const puck = ctx.find('Puck');
    const rb = puck !== undefined ? ctx.getOn(puck, 'RigidBody2D') : null;
    return !rb || Math.hypot(rb.velocity.x, rb.velocity.y) < 0.2;
  },
  onDestroy(ctx) {
    for (const off of ctx.state.unsub) off();
    const h = hud(ctx);
    if (h) { h.remove('score'); h.remove('hint'); h.remove('winner'); h.remove('teams'); }
  },

  /** Put a peer on the side with fewer players (team mode) or on the first free paddle. */
  assign(ctx, peerId) {
    const s = ctx.state;
    if (s.teams.left.includes(peerId) || s.teams.right.includes(peerId)) return;
    let side;
    if (ctx.props.teamMode) side = s.teams.left.length <= s.teams.right.length ? 'left' : 'right';
    else if (s.teams.left.length === 0) side = 'left';
    else if (s.teams.right.length === 0) side = 'right';
    else return; // spectator: both paddles are taken
    s.teams[side].push(peerId);
    this.refreshControllers(ctx);
  },
  unassign(ctx, peerId) {
    const s = ctx.state;
    for (const side of ['left', 'right']) s.teams[side] = s.teams[side].filter((p) => p !== peerId);
    this.refreshControllers(ctx);
  },
  /**
   * Seat each team on its paddle. Online this goes through the sync
   * (`setOwner` / `shareControl`) so every peer's copy carries the same
   * owner and co-owners; the AI flag travels with the HUD RPC.
   */
  refreshControllers(ctx) {
    const s = ctx.state;
    const sync = ctx.net.hub.sync;
    for (const side of ['left', 'right']) {
      const e = s.paddles[side];
      if (e === undefined) continue;
      const team = s.teams[side];
      const owner = team[0] || 'ai';
      const coOwners = team.slice(1);
      ctx.getOn(e, 'Script').props.ai = team.length === 0 && ctx.props.aiWhenAlone;
      const pi = ctx.getOn(e, 'PlayerInput');
      if (sync && ctx.net.isHost) {
        sync.setOwner(e, owner);
        const ni = ctx.getOn(e, 'NetworkIdentity');
        const stale = new Set([...pi.coOwners, ...(ni ? ni.sharedWith : [])]);
        for (const p of stale) if (!coOwners.includes(p)) sync.shareControl(e, p, false);
        for (const p of coOwners) sync.shareControl(e, p, true);
      } else {
        pi.owner = owner;
        pi.coOwners = coOwners;
      }
    }
    this.drawHud(ctx);
  },

  serve(ctx, direction) {
    const puck = ctx.find('Puck');
    if (puck === undefined || ctx.state.over) return;
    const t = ctx.getOn(puck, 'Transform');
    t.setPosition(0, 0);
    const rb = ctx.getOn(puck, 'RigidBody2D');
    const angle = ctx.random.range(-0.5, 0.5);
    rb.setVelocity(Math.cos(angle) * ctx.props.serveSpeed * direction, Math.sin(angle) * ctx.props.serveSpeed);
    ctx.sendTo(puck, 'served');
  },
  onMessage(ctx, name, data) {
    if (!ctx.net.isHost || ctx.state.over) return;
    if (name !== 'goal') return;
    const scorer = data.side === 'left' ? 'right' : 'left';   // puck entered the left goal → right scores
    ctx.state.score[scorer]++;
    ctx.audio.play('goal', { volume: 0.7 });
    const cam = ctx.find('Camera');
    const c = cam !== undefined ? ctx.getOn(cam, 'Camera2D') : null;
    if (c) c.shake = 0.3;
    const puck = ctx.find('Puck');
    if (puck !== undefined) { ctx.getOn(puck, 'RigidBody2D').setVelocity(0, 0); ctx.getOn(puck, 'Transform').setPosition(0, 0); ctx.sendTo(puck, 'reset'); }
    this.drawHud(ctx);
    if (ctx.state.score[scorer] >= ctx.props.scoreToWin) return this.finish(ctx, scorer);
    // Serve toward the side that conceded.
    ctx.timer(ctx.props.serveDelay, () => this.serve(ctx, data.side === 'left' ? -1 : 1));
  },
  finish(ctx, winner) {
    ctx.state.over = true;
    ctx.state.winner = `${winner === 'left' ? 'Blue' : 'Orange'} wins ${ctx.state.score[winner]}-${ctx.state.score[winner === 'left' ? 'right' : 'left']}!`;
    const h = hud(ctx);
    if (h) h.panel('winner', ctx.state.winner, 'New match in a moment');
    this.drawHud(ctx);
    ctx.timer(4, () => this.newMatch(ctx));
  },
  newMatch(ctx) {
    ctx.state.score = { left: 0, right: 0 };
    ctx.state.over = false;
    ctx.state.winner = null;
    const h = hud(ctx);
    if (h) h.remove('winner');
    this.drawHud(ctx);
    this.serve(ctx, ctx.random.chance(0.5) ? 1 : -1);
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
  resendHud(ctx) { ctx.state.lastHud = null; this.drawHud(ctx); },
  onRpc(ctx, name, args) {
    if (name !== 'hud' || ctx.net.isHost) return;
    const d = args[0];
    ctx.state.score = d.score;
    ctx.state.teams = d.teams;
    ctx.state.winner = d.winner;
    ctx.state.over = !!d.winner;
    // Guest copies of the paddles mirror the host's AI flag (Script props of scene entities are not replicated).
    for (const side of ['left', 'right']) {
      const e = ctx.state.paddles[side];
      const script = e !== undefined ? ctx.getOn(e, 'Script') : null;
      if (script && d.ai) script.props.ai = !!d.ai[side];
    }
    const h = hud(ctx);
    if (h) { if (d.winner) h.panel('winner', d.winner, 'New match in a moment'); else h.remove('winner'); }
    this.drawHud(ctx);
  },
  drawHud(ctx) {
    const s = ctx.state;
    const ai = {};
    for (const side of ['left', 'right']) { const e = s.paddles[side]; ai[side] = e !== undefined ? !!ctx.getOn(e, 'Script').props.ai : false; }
    this.broadcastHud(ctx, { score: s.score, teams: s.teams, winner: s.winner || null, ai });
    const h = hud(ctx);
    if (!h) return;
    h.text('score', `${s.score.left}   -   ${s.score.right}`, { anchor: 'top', y: 8 }).style.fontSize = '28px';
    const label = (side) => s.teams[side].length ? s.teams[side].map((p) => (p === ctx.net.localId ? 'you' : p)).join(' + ') : 'AI';
    h.text('teams', `Blue: ${label('left')}     Orange: ${label('right')}`, { anchor: 'top', y: 46 });
    h.text('hint', `First to ${ctx.props.scoreToWin} · WASD / arrows move your paddle${ctx.props.teamMode ? ' · team mode: everyone on a side steers the same paddle (inputs averaged)' : ''}`, { anchor: 'top', y: 70 });
  },
});
