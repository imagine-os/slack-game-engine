// Host-side match logic: spawns one Ship per player, keeps asteroids in the
// arena, tracks scores and draws the HUD. Offline the local peer is the host,
// so the same code runs single-player and in a room.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }

const COLORS = ['#4cc2ff', '#ff7a3d', '#8b7dff', '#ffd166', '#06d6a0', '#ef476f', '#f78c6b', '#c8f0ff'];

defineScript({
  name: 'GameManager',
  description: 'Spawns players and asteroids, keeps score, shows the HUD.',
  props: {
    arenaWidth: { type: 'number', default: 32, min: 10, max: 100 },
    arenaHeight: { type: 'number', default: 18, min: 10, max: 60 },
    asteroids: { type: 'integer', default: 5, min: 0, max: 30, label: 'Asteroids to keep alive' },
    respawnDelay: { type: 'number', default: 2, min: 0, max: 10 },
    scoreToWin: { type: 'integer', default: 15, min: 1, max: 999 },
    asteroidScore: { type: 'integer', default: 1 },
    shipScore: { type: 'integer', default: 5 },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.players = {};          // peerId -> { entity, index, name, score }
    s.count = 0;
    s.unsub = [];
    s.over = false;
    if (ctx.net.isHost) this.becomeHost(ctx);
    this.drawHud(ctx);
  },
  /** Host migration: the peer that took over starts serving with the ships and HUD state it already has. */
  onHostChanged(ctx, isHost) {
    if (isHost) this.becomeHost(ctx);
  },
  /** Run the match: adopt existing ships, give everyone without one a ship, keep asteroids coming. */
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
    while (ctx.findAll('asteroid').length < ctx.props.asteroids) this.spawnAsteroid(ctx, 3, true);
    ctx.timer(3, () => this.topUpAsteroids(ctx), true);
    if (s.over) ctx.timer(4, () => this.nextRound(ctx));   // the old host's round-over timer is gone
    this.resendHud(ctx);
  },
  /** New host: ships the previous host spawned become our players; scores and labels come from the last HUD RPC. */
  adoptPlayers(ctx) {
    const s = ctx.state;
    const known = s.players;   // HUD rows { name, score, index } on a former guest, nothing offline
    s.players = {};
    for (const e of ctx.world.with('NetworkIdentity')) {
      const ni = ctx.getOn(e, 'NetworkIdentity');
      if (ni.prefab !== 'Ship') continue;
      const label = ctx.getOn(e, 'Script').props.label || `P${s.count + 1}`;
      const k = known[ni.ownerId] || {};
      const index = k.index !== undefined ? k.index : Math.max(0, (parseInt(label.slice(1), 10) || 1) - 1);
      s.players[ni.ownerId] = { entity: e, index, name: k.name || label, score: k.score || 0 };
      s.count = Math.max(s.count, index + 1);
    }
  },
  onDestroy(ctx) {
    for (const off of ctx.state.unsub) off();
    const h = hud(ctx);
    if (h) { h.remove('score'); h.remove('hint'); h.remove('winner'); }
  },

  addPlayer(ctx, peerId) {
    const s = ctx.state;
    if (s.players[peerId]) return;
    const index = s.count++;
    const pos = this.spawnPoint(ctx);
    const entity = ctx.net.spawn('Ship', { ownerId: peerId, position: pos });
    const pi = ctx.getOn(entity, 'PlayerInput');
    if (pi) pi.owner = peerId;
    const ni = ctx.getOn(entity, 'NetworkIdentity');
    if (ni) ni.ownerId = peerId;
    const name = ctx.getOn(entity, 'Name');
    if (name) name.name = `Ship ${peerId}`;
    // Pass per-player setup through the Script props: the ship reads them in onStart.
    const script = ctx.getOn(entity, 'Script');
    script.props.color = COLORS[index % COLORS.length];
    script.props.label = `P${index + 1}`;
    script.props.respawnDelay = ctx.props.respawnDelay;
    s.players[peerId] = { entity, index, name: `P${index + 1}`, score: 0 };
    this.drawHud(ctx);
  },
  removePlayer(ctx, peerId) {
    const p = ctx.state.players[peerId];
    if (!p) return;
    if (ctx.world.isAlive(p.entity)) {
      const sync = ctx.net.hub.sync;
      if (sync) sync.despawn(p.entity); else ctx.destroy(p.entity);
    }
    delete ctx.state.players[peerId];
    this.drawHud(ctx);
  },

  spawnPoint(ctx) {
    const w = ctx.props.arenaWidth, h = ctx.props.arenaHeight;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = ctx.random.range(-w / 2 + 2, w / 2 - 2), y = ctx.random.range(-h / 2 + 2, h / 2 - 2);
      if (ctx.physics.overlapCircle({ x, y }, 3).length === 0) return { x, y };
    }
    return { x: 0, y: 0 };
  },
  spawnAsteroid(ctx, size, anywhere) {
    const w = ctx.props.arenaWidth, h = ctx.props.arenaHeight;
    let x, y;
    if (anywhere) { const p = this.spawnPoint(ctx); x = p.x; y = p.y; }
    else if (ctx.random.chance(0.5)) { x = ctx.random.chance(0.5) ? -w / 2 + 0.5 : w / 2 - 0.5; y = ctx.random.range(-h / 2, h / 2); }
    else { x = ctx.random.range(-w / 2, w / 2); y = ctx.random.chance(0.5) ? -h / 2 + 0.5 : h / 2 - 0.5; }
    const e = ctx.net.spawn('Asteroid', { position: { x, y } });
    const script = ctx.getOn(e, 'Script');
    script.props.size = size;
    script.props.seed = ctx.random.int(1, 1e9);
    const rb = ctx.getOn(e, 'RigidBody2D');
    const a = ctx.random.range(0, Math.PI * 2), sp = ctx.random.range(0.8, 2.2) * (4 - size);
    rb.setVelocity(Math.cos(a) * sp, Math.sin(a) * sp);
    rb.angularVelocity = ctx.random.range(-1, 1);
    return e;
  },
  topUpAsteroids(ctx) {
    if (ctx.state.over) return;
    const alive = ctx.findAll('asteroid').length;
    if (alive < ctx.props.asteroids) this.spawnAsteroid(ctx, 3, false);
  },

  onMessage(ctx, name, data) {
    if (!ctx.net.isHost || ctx.state.over) return;
    if (name === 'asteroidDestroyed') this.award(ctx, data.by, ctx.props.asteroidScore);
    else if (name === 'shipDestroyed' && data.killer && data.killer !== data.victim) this.award(ctx, data.killer, ctx.props.shipScore);
  },
  award(ctx, peerId, points) {
    const p = ctx.state.players[peerId];
    if (!p) return;
    p.score += points;
    this.drawHud(ctx);
    if (p.score >= ctx.props.scoreToWin) this.endRound(ctx, p);
  },
  endRound(ctx, winner) {
    ctx.state.over = true;
    ctx.state.winner = winner.name;
    const h = hud(ctx);
    if (h) h.panel('winner', `${winner.name} wins!`, 'Next round starts in a moment');
    ctx.send('roundOver', { winner: winner.name });
    this.drawHud(ctx);
    ctx.timer(4, () => this.nextRound(ctx));
  },
  nextRound(ctx) {
    for (const p of Object.values(ctx.state.players)) p.score = 0;
    ctx.state.over = false;
    ctx.state.winner = null;
    const h = hud(ctx);
    if (h) h.remove('winner');
    this.drawHud(ctx);
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
    ctx.state.players = d.players;   // { peerId: { name, score, index } } — no entities on this side
    ctx.state.winner = d.winner;
    ctx.state.over = !!d.winner;
    const h = hud(ctx);
    if (h) { if (d.winner) h.panel('winner', `${d.winner} wins!`, 'Next round starts in a moment'); else h.remove('winner'); }
    this.drawHud(ctx);
  },

  drawHud(ctx) {
    const s = ctx.state;
    const shared = {};
    for (const [id, p] of Object.entries(s.players)) shared[id] = { name: p.name, score: p.score, index: p.index };
    this.broadcastHud(ctx, { players: shared, winner: s.winner || null });
    const h = hud(ctx);
    if (!h) return;
    const me = ctx.net.localId;
    const rows = Object.entries(ctx.state.players)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([id, p]) => `${id === me ? '▶ ' : '  '}${p.name.padEnd(4)} ${String(p.score).padStart(3)}`);
    h.text('score', rows.join('\n') || 'Waiting for players…', { anchor: 'top-left' });
    h.text('hint', `First to ${ctx.props.scoreToWin} · A/D turn · W thrust · J or click to fire`, { anchor: 'top' });
  },
});
