// Co-op level flow: spawns a Hopper per player, counts coins, remembers the
// shared checkpoint, handles respawns and the level-complete screen.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }

const COLORS = ['#4cc2ff', '#ff7a3d', '#8b7dff', '#06d6a0'];

defineScript({
  name: 'GameManager',
  description: 'Spawns players, tracks coins/checkpoints, restarts the level.',
  props: {
    respawnDelay: { type: 'number', default: 1, min: 0, max: 10 },
    restartDelay: { type: 'number', default: 5, min: 1, max: 30 },
    spawnName: { type: 'string', default: 'Spawn Point' },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.players = {};
    s.count = 0;
    s.unsub = [];
    s.coins = 0;
    s.startTime = ctx.time.elapsed;
    s.complete = false;
    const spawn = ctx.find(ctx.props.spawnName);
    const st = spawn !== undefined ? ctx.getOn(spawn, 'Transform') : null;
    s.spawn = st ? { x: st.x, y: st.y } : { x: 2, y: 3 };
    s.checkpoint = { ...s.spawn };
    // Remember every coin so the level can be rebuilt after completion.
    s.coinSpots = ctx.findAll('coin').map((e) => { const t = ctx.getOn(e, 'Transform'); return { x: t.x, y: t.y }; });
    s.totalCoins = s.coinSpots.length;

    if (ctx.net.isHost) this.becomeHost(ctx);
    this.drawHud(ctx);
  },
  /** Host migration: the peer that took over runs the level from here on. */
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
    if (s.complete) ctx.timer(ctx.props.restartDelay, () => this.restart(ctx));   // the old host's timer is gone
    this.resendHud(ctx);
  },
  /** New host: hoppers the previous host spawned become our players. */
  adoptPlayers(ctx) {
    const s = ctx.state;
    s.players = {};
    for (const e of ctx.world.with('NetworkIdentity')) {
      const ni = ctx.getOn(e, 'NetworkIdentity');
      if (ni.prefab !== 'Hopper') continue;
      const label = ctx.getOn(e, 'Script').props.label || `P${s.count + 1}`;
      const index = Math.max(0, (parseInt(label.slice(1), 10) || 1) - 1);
      s.players[ni.ownerId] = { entity: e, index };
      s.count = Math.max(s.count, index + 1);
    }
  },
  onDestroy(ctx) {
    for (const off of ctx.state.unsub) off();
    const h = hud(ctx);
    if (h) { h.remove('coins'); h.remove('hint'); h.remove('complete'); }
  },
  onUpdate(ctx) {
    if (ctx.time.frame % 20 === 0) this.drawHud(ctx);
  },

  addPlayer(ctx, peerId) {
    const s = ctx.state;
    if (s.players[peerId]) return;
    const index = s.count++;
    const pos = { x: s.checkpoint.x + (index % 4) * 0.6, y: s.checkpoint.y };
    const entity = ctx.net.spawn('Hopper', { ownerId: peerId, position: pos });
    const pi = ctx.getOn(entity, 'PlayerInput');
    if (pi) pi.owner = peerId;
    const ni = ctx.getOn(entity, 'NetworkIdentity');
    if (ni) ni.ownerId = peerId;
    const name = ctx.getOn(entity, 'Name');
    if (name) name.name = `Hopper ${peerId}`;
    const script = ctx.getOn(entity, 'Script');
    script.props.color = COLORS[index % COLORS.length];
    script.props.label = `P${index + 1}`;
    script.props.respawnDelay = ctx.props.respawnDelay;
    s.players[peerId] = { entity, index };
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

  onMessage(ctx, name, data) {
    const s = ctx.state;
    if (!ctx.net.isHost) return;
    if (name === 'coinCollected') { s.coins++; this.drawHud(ctx); }
    else if (name === 'checkpoint') {
      if (data.x > s.checkpoint.x) { s.checkpoint = { x: data.x, y: data.y }; ctx.audio.play('checkpoint', { volume: 0.6 }); ctx.sendTo(data.entity, 'activate'); }
    }
    else if (name === 'respawnRequest') {
      const t = ctx.getOn(data.entity, 'Transform');
      if (t) t.setPosition(s.checkpoint.x, s.checkpoint.y + 0.5);
      ctx.sendTo(data.entity, 'respawned');
    }
    else if (name === 'goal' && !s.complete) this.complete(ctx);
  },
  complete(ctx) {
    const s = ctx.state;
    s.complete = true;
    const secs = (ctx.time.elapsed - s.startTime).toFixed(1);
    s.done = `Coins ${s.coins} / ${s.totalCoins} · ${secs}s\nRestarting in ${ctx.props.restartDelay}s`;
    const h = hud(ctx);
    if (h) h.panel('complete', 'Level complete!', s.done);
    ctx.audio.play('goal', { volume: 0.8 });
    ctx.send('levelComplete', {});
    this.drawHud(ctx);
    ctx.timer(ctx.props.restartDelay, () => this.restart(ctx));
  },
  restart(ctx) {
    const s = ctx.state;
    for (const c of ctx.findAll('coin')) ctx.destroy(c);
    for (const spot of s.coinSpots) ctx.net.spawn('Coin', { position: spot });
    for (const c of ctx.findAll('checkpoint')) ctx.sendTo(c, 'reset');
    s.coins = 0;
    s.checkpoint = { ...s.spawn };
    s.startTime = ctx.time.elapsed;
    s.complete = false;
    s.done = null;
    for (const p of Object.values(s.players)) {
      const t = ctx.getOn(p.entity, 'Transform');
      if (t) t.setPosition(s.spawn.x + (p.index % 4) * 0.6, s.spawn.y);
      ctx.sendTo(p.entity, 'respawned');
    }
    const h = hud(ctx);
    if (h) h.remove('complete');
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
    const s = ctx.state;
    s.coins = d.coins;
    s.totalCoins = d.totalCoins;
    if (Math.abs((ctx.time.elapsed - s.startTime) - d.secs) > 1.5) s.startTime = ctx.time.elapsed - d.secs;
    s.complete = d.complete;
    s.done = d.done;
    if (d.checkpoint) s.checkpoint = d.checkpoint;   // respawns keep working if we take over as host
    const h = hud(ctx);
    if (h) { if (d.done) h.panel('complete', 'Level complete!', d.done); else h.remove('complete'); }
    this.drawHud(ctx);
  },
  drawHud(ctx) {
    const s = ctx.state;
    const secs = Math.floor(ctx.time.elapsed - s.startTime);
    this.broadcastHud(ctx, { coins: s.coins, totalCoins: s.totalCoins, secs, complete: s.complete, done: s.done || null, checkpoint: s.checkpoint });
    const h = hud(ctx);
    if (!h) return;
    h.text('coins', `Coins ${s.coins} / ${s.totalCoins}   ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, { anchor: 'top-left' });
    h.text('hint', 'Reach the flag together · A/D move · Space jump', { anchor: 'top' });
  },
});
