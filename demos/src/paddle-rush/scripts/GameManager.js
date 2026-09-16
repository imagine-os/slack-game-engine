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
    if (ctx.net.isHost) {
      this.assign(ctx, ctx.net.localId);
      const sync = ctx.net.hub.sync;
      if (sync) {
        for (const p of sync.players()) if (p.peerId !== ctx.net.localId) this.assign(ctx, p.peerId);
        s.unsub.push(sync.on('playerJoined', ({ peerId }) => this.assign(ctx, peerId)));
        s.unsub.push(sync.on('playerLeft', ({ peerId }) => this.unassign(ctx, peerId)));
      }
      this.refreshControllers(ctx);
      ctx.timer(ctx.props.serveDelay, () => this.serve(ctx, ctx.random.chance(0.5) ? 1 : -1));
    }
    this.drawHud(ctx);
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
  /** Write team membership into PlayerInput (owner + coOwners) and NetworkIdentity. */
  refreshControllers(ctx) {
    const s = ctx.state;
    const sync = ctx.net.hub.sync;
    for (const side of ['left', 'right']) {
      const e = s.paddles[side];
      if (e === undefined) continue;
      const team = s.teams[side];
      const pi = ctx.getOn(e, 'PlayerInput');
      const ni = ctx.getOn(e, 'NetworkIdentity');
      const script = ctx.getOn(e, 'Script');
      const previous = pi.owner === 'ai' ? [] : [pi.owner, ...pi.coOwners];
      if (team.length === 0) {
        pi.owner = 'ai';
        pi.coOwners = [];
        script.props.ai = ctx.props.aiWhenAlone;
      } else {
        pi.owner = team[0];
        pi.coOwners = team.slice(1);
        script.props.ai = false;
      }
      if (ni) { ni.ownerId = team[0] || 'host'; ni.sharedWith = team.slice(1); }
      if (sync) {
        for (const p of previous) if (!team.includes(p)) sync.shareControl(e, p, false);
        for (const p of team.slice(1)) sync.shareControl(e, p, true);
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
    const h = hud(ctx);
    if (h) h.panel('winner', `${winner === 'left' ? 'Blue' : 'Orange'} wins ${ctx.state.score[winner]}-${ctx.state.score[winner === 'left' ? 'right' : 'left']}!`, 'New match in a moment');
    ctx.timer(4, () => {
      ctx.state.score = { left: 0, right: 0 };
      ctx.state.over = false;
      if (h) h.remove('winner');
      this.drawHud(ctx);
      this.serve(ctx, ctx.random.chance(0.5) ? 1 : -1);
    });
  },
  drawHud(ctx) {
    const h = hud(ctx);
    if (!h) return;
    const s = ctx.state;
    h.text('score', `${s.score.left}   -   ${s.score.right}`, { anchor: 'top', y: 8 }).style.fontSize = '28px';
    const label = (side) => s.teams[side].length ? s.teams[side].map((p) => (p === ctx.net.localId ? 'you' : p)).join(' + ') : 'AI';
    h.text('teams', `Blue: ${label('left')}     Orange: ${label('right')}`, { anchor: 'top', y: 46 });
    h.text('hint', `First to ${ctx.props.scoreToWin} · WASD / arrows move your paddle${ctx.props.teamMode ? ' · team mode: everyone on a side steers the same paddle (inputs averaged)' : ''}`, { anchor: 'top', y: 70 });
  },
});
