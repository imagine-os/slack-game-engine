// Host-side director: one Glider per player (spawned through the sync so
// everyone sees everyone), free-roam and race modes, countdown/standings/best
// times, the world seed shared through the room, and host migration
// (onHostChanged) so a guest can take over.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }
function pg(ctx) { return ctx.engine.procgen || null; }

defineScript({
  name: 'GameManager',
  description: 'Spawns gliders per player, runs races, shares the seed.',
  props: {
    seed: { type: 'string', default: 'amber-lagoon-42', label: 'World seed (fallback)' },
    countdown: { type: 'integer', default: 3, min: 0, max: 10 },
    raceTimeout: { type: 'number', default: 45, min: 5, max: 600, label: 'Seconds after the first finisher' },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.players = {}; s.count = 0; s.unsub = [];
    s.race = { phase: 'idle', startAt: 0, countdown: null, results: {} };
    s.mode = 'free';
    const W = this.world(ctx);
    s.seed = W ? W.seed : ctx.props.seed;
    if (ctx.net.isHost) this.becomeHost(ctx);
    this.drawStandings(ctx);
  },
  world(ctx) {
    const P = pg(ctx);
    if (!P) return null;
    if (!P.world) P.world = P.createWorld(P.env.param('seed') || (P.env.param('daily') ? P.seeds.dailySeed() : ctx.props.seed));
    return P.world;
  },
  onHostChanged(ctx, isHost) { if (isHost) this.becomeHost(ctx); },
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
    if (s.race.phase === 'running' && s.raceFirstFinish) ctx.timer(ctx.props.raceTimeout, () => this.endRace(ctx));
    this.resendHud(ctx);
  },
  /** New host: gliders the previous host spawned become our players; progress comes from the last HUD RPC. */
  adoptPlayers(ctx) {
    const s = ctx.state;
    const known = s.players;
    s.players = {};
    for (const e of ctx.world.with('NetworkIdentity')) {
      const ni = ctx.getOn(e, 'NetworkIdentity');
      if (ni.prefab !== 'Glider') continue;
      const props = ctx.getOn(e, 'Script').props;
      const k = known[ni.ownerId] || {};
      const index = k.index !== undefined ? k.index : props.livery || 0;
      s.players[ni.ownerId] = { entity: e, index, label: props.label || `P${index + 1}`, gates: k.gates || 0, time: k.time || 0, finished: k.finished || 0, flying: true };
      s.count = Math.max(s.count, index + 1);
    }
  },
  onDestroy(ctx) {
    for (const off of ctx.state.unsub) off();
    const h = hud(ctx);
    if (h) for (const id of ['countdown', 'standings', 'race-result']) h.remove(id);
  },
  addPlayer(ctx, peerId) {
    const s = ctx.state;
    if (s.players[peerId]) return;
    const W = this.world(ctx);
    const index = s.count++;
    const spawn = W ? W.spawn(index) : { position: { x: index * 6, y: 50, z: 0 }, yaw: 0 };
    const entity = ctx.net.spawn('Glider', { ownerId: peerId, position: spawn.position });
    const pi = ctx.getOn(entity, 'PlayerInput');
    if (pi) pi.owner = peerId;
    const ni = ctx.getOn(entity, 'NetworkIdentity');
    if (ni) ni.ownerId = peerId;
    const name = ctx.getOn(entity, 'Name');
    if (name) name.name = `Glider ${peerId}`;
    const script = ctx.getOn(entity, 'Script');
    script.props.livery = index % 6;
    script.props.label = `P${index + 1}`;
    script.props.heading = spawn.yaw;
    s.players[peerId] = { entity, index, label: `P${index + 1}`, gates: 0, time: 0, finished: 0, flying: false };
    if (s.race.phase === 'running') ctx.sendTo(entity, 'raceState', { phase: 'running', startAt: s.race.startAt });
  },
  removePlayer(ctx, peerId) {
    const p = ctx.state.players[peerId];
    if (!p) return;
    if (p.entity !== undefined && ctx.world.isAlive(p.entity)) {
      const sync = ctx.net.hub.sync;
      if (sync) sync.despawn(p.entity); else ctx.destroy(p.entity);
    }
    delete ctx.state.players[peerId];
    this.drawStandings(ctx);
  },
  localGlider(ctx) {
    for (const e of ctx.findAll('glider')) {
      const pi = ctx.getOn(e, 'PlayerInput');
      if (pi && (pi.owner === 'local' || pi.owner === ctx.net.localId)) return e;
    }
    return undefined;
  },

  // ----------------------------------------------------------- messages
  onMessage(ctx, name, data) {
    const s = ctx.state;
    if (name === 'shell:fly') {
      s.mode = 'free';
      if (ctx.net.isHost) this.takeOff(ctx, ctx.net.localId); else ctx.net.rpc('fly', [], 'host');
    } else if (name === 'shell:race') {
      if (ctx.net.isHost) { this.takeOff(ctx, ctx.net.localId); this.startRace(ctx); }
      else { ctx.net.rpc('fly', [], 'host'); ctx.net.rpc('requestRace', [], 'host'); }
    } else if (name === 'shell:seed') {
      if (!ctx.net.isHost) return;
      const P = pg(ctx);
      if (!P) return;
      const seed = P.seeds.normalizeSeed(data.seed);
      if (seed === s.seed) return;
      s.seed = seed;
      ctx.send('worldSeed', { seed });
      P.env.setParam('seed', seed);
    } else if (name === 'worldSeed') {
      // The streamer rebuilt the world: put every glider back on the new start line.
      const W = this.world(ctx);
      s.seed = W ? W.seed : data.seed;
      if (ctx.net.isHost) {
        for (const [peer, p] of Object.entries(s.players)) if (p.entity !== undefined && ctx.world.isAlive(p.entity) && W) ctx.sendTo(p.entity, 'resetTo', { position: W.spawn(p.index).position, yaw: W.spawn(p.index).yaw, peer });
        this.resetRace(ctx);
        this.resendHud(ctx);
      }
    } else if (!ctx.net.isHost) {
      return;
    } else if (name === 'gatePassed') {
      const p = s.players[data.peer];
      if (!p || s.race.phase !== 'running') return;
      p.gates = data.index + 1; p.time = data.time;
      ctx.send('nextGate', { index: p.gates, peer: data.peer });
      this.drawStandings(ctx);
    } else if (name === 'raceFinished') {
      const p = s.players[data.peer];
      if (!p || s.race.phase !== 'running' || p.finished) return;
      p.finished = data.time;
      s.race.results[data.peer] = data.time;
      const P = pg(ctx);
      const prev = P ? Number(P.env.storageGet(`driftwind.best.${s.seed}`) || 0) : 0;
      const best = data.peer === ctx.net.localId ? (!prev || data.time < prev) : false;
      ctx.send('raceResult', { peer: data.peer, time: data.time, best });
      if (!s.raceFirstFinish) { s.raceFirstFinish = data.time; ctx.timer(ctx.props.raceTimeout, () => this.endRace(ctx)); }
      const all = Object.values(s.players).every((q) => q.finished);
      if (all) ctx.timer(4, () => this.endRace(ctx));
      this.drawStandings(ctx);
    }
  },
  takeOff(ctx, peerId) {
    const p = ctx.state.players[peerId];
    if (!p) return;
    p.flying = true;
    if (p.entity !== undefined && ctx.world.isAlive(p.entity)) ctx.sendTo(p.entity, 'takeControl', { peer: peerId });
  },

  // -------------------------------------------------------------- race
  resetRace(ctx) {
    const s = ctx.state;
    s.race = { phase: 'idle', startAt: 0, countdown: null, results: {} };
    s.raceFirstFinish = 0;
    for (const p of Object.values(s.players)) { p.gates = 0; p.time = 0; p.finished = 0; }
    ctx.send('raceState', { phase: 'idle' });
    const h = hud(ctx);
    if (h) { h.remove('countdown'); h.remove('race-result'); }
  },
  startRace(ctx) {
    const s = ctx.state;
    if (s.race.phase === 'countdown' || s.race.phase === 'running') return;
    this.resetRace(ctx);
    s.mode = 'race';
    const W = this.world(ctx);
    if (W) for (const [peer, p] of Object.entries(s.players)) { if (p.entity !== undefined && ctx.world.isAlive(p.entity)) ctx.sendTo(p.entity, 'resetTo', { position: W.spawn(p.index).position, yaw: W.spawn(p.index).yaw, peer }); p.flying = true; ctx.sendTo(p.entity, 'takeControl', { peer }); }
    s.race.phase = 'countdown';
    ctx.send('raceState', { phase: 'countdown' });
    this.spawnGhost(ctx);
    let n = ctx.props.countdown;
    const h = hud(ctx);
    const tick = () => {
      if (n > 0) {
        s.race.countdown = String(n);
        if (h) h.text('countdown', s.race.countdown, { anchor: 'center' }).style.cssText += 'font-size:96px;font-weight:200;letter-spacing:0.1em;';
        ctx.audio.play('tick', { volume: 0.5 });
        n--;
        this.drawStandings(ctx);
        ctx.timer(1, tick);
      } else {
        s.race.countdown = 'GO';
        s.race.phase = 'running';
        s.race.startAt = ctx.time.elapsed;
        if (h) h.text('countdown', 'GO', { anchor: 'center' });
        ctx.audio.play('go', { volume: 0.6 });
        ctx.send('raceState', { phase: 'running', startAt: s.race.startAt });
        ctx.send('nextGate', { index: 0, peer: ctx.net.localId });
        ctx.timer(1, () => { s.race.countdown = null; if (h) h.remove('countdown'); this.drawStandings(ctx); });
        this.drawStandings(ctx);
      }
    };
    tick();
  },
  endRace(ctx) {
    const s = ctx.state;
    if (s.race.phase !== 'running') return;
    s.race.phase = 'finished';
    ctx.send('raceState', { phase: 'finished' });
    this.drawStandings(ctx);
    ctx.timer(6, () => { if (s.race.phase === 'finished') { this.resetRace(ctx); s.mode = 'free'; this.drawStandings(ctx); } });
  },
  /** Local: replay the stored best run for this seed as a translucent glider. */
  spawnGhost(ctx) {
    const P = pg(ctx), W = this.world(ctx);
    if (!P || !W || !ctx.engine.canvas) return;
    const raw = P.env.storageGet(`driftwind.ghost.${W.seed}`);
    if (!raw) return;
    try {
      const path = JSON.parse(raw);
      if (!Array.isArray(path) || path.length < 2) return;
      const e = ctx.spawn('Ghost', { position: { x: path[0][0], y: path[0][1], z: path[0][2] }, name: 'Ghost' });
      ctx.getOn(e, 'Script').props.path = path;
    } catch (err) { ctx.warn(`Ghost data unreadable: ${err}`); }
  },

  // ----------------------------------------------------------- HUD / RPC
  broadcastHud(ctx, payload) {
    if (!ctx.net.isHost || !ctx.net.online) return;
    const json = JSON.stringify(payload);
    if (json === ctx.state.lastHud) return;
    ctx.state.lastHud = json;
    ctx.net.rpc('hud', [payload], 'others');
  },
  resendHud(ctx) { ctx.state.lastHud = null; this.drawStandings(ctx); },
  onRpc(ctx, name, args, from) {
    const s = ctx.state;
    if (name === 'fly' && ctx.net.isHost) { this.takeOff(ctx, from); return; }
    if (name === 'requestRace' && ctx.net.isHost) { this.startRace(ctx); return; }
    if (name !== 'hud' || ctx.net.isHost) return;
    const d = args[0];
    const wasRunning = s.race.phase === 'running';
    s.players = d.players;
    s.race = d.race;
    s.mode = d.mode;
    if (d.seed && d.seed !== s.seed) { s.seed = d.seed; ctx.send('worldSeed', { seed: d.seed, remote: true }); }
    if (d.race.phase === 'running' && !wasRunning) { ctx.send('raceState', { phase: 'running', startAt: ctx.time.elapsed - (d.race.elapsed || 0) }); this.spawnGhost(ctx); }
    if (d.race.phase === 'idle' && wasRunning) ctx.send('raceState', { phase: 'idle' });
    const me = d.players[ctx.net.localId];
    if (me && me.finished && !s.reportedFinish) { s.reportedFinish = me.finished; const P = pg(ctx); const prev = P ? Number(P.env.storageGet(`driftwind.best.${s.seed}`) || 0) : 0; ctx.send('raceResult', { peer: ctx.net.localId, time: me.finished, best: !prev || me.finished < prev }); }
    if (d.race.phase !== 'running') s.reportedFinish = 0;
    const h = hud(ctx);
    if (h) { if (d.race.countdown) h.text('countdown', d.race.countdown, { anchor: 'center' }).style.cssText += 'font-size:96px;font-weight:200;letter-spacing:0.1em;'; else h.remove('countdown'); }
    this.drawStandings(ctx);
  },
  drawStandings(ctx) {
    const s = ctx.state;
    const rows = {};
    for (const [id, p] of Object.entries(s.players)) rows[id] = { index: p.index, label: p.label, gates: p.gates, time: p.time, finished: p.finished };
    this.broadcastHud(ctx, { players: rows, race: { phase: s.race.phase, countdown: s.race.countdown || null, elapsed: s.race.phase === 'running' ? ctx.time.elapsed - s.race.startAt : 0, results: s.race.results }, mode: s.mode, seed: s.seed });
    const h = hud(ctx);
    if (!h) return;
    const list = Object.values(s.players);
    if (s.race.phase === 'idle' || list.length === 0) { h.remove('standings'); h.remove('race-result'); return; }
    const me = ctx.net.localId;
    const sorted = list.slice().sort((a, b) => (b.finished ? 1e6 - b.finished : b.gates) - (a.finished ? 1e6 - a.finished : a.gates) || a.time - b.time);
    const lines = sorted.map((p, i) => `${i + 1}.  ${p.label}${Object.keys(s.players).find((k) => s.players[k] === p) === me ? ' (you)' : ''}   ${p.finished ? p.finished.toFixed(2) + 's' : `gate ${p.gates}`}`);
    const el = h.text('standings', lines.join('\n'), { anchor: 'top-right', y: 48, x: 14 });
    el.style.cssText += 'font-size:13px;letter-spacing:0.08em;line-height:1.7;opacity:0.9;font-variant-numeric:tabular-nums;text-align:right;';
    const mine = s.players[me];
    if (s.race.phase === 'finished' || (mine && mine.finished)) {
      const P = pg(ctx);
      const best = P ? P.env.storageGet(`driftwind.best.${s.seed}`) : null;
      const t = mine && mine.finished ? `${mine.finished.toFixed(2)}s` : 'did not finish';
      h.text('race-result', `${t}${best ? `   ·   best ${Number(best).toFixed(2)}s` : ''}`, { anchor: 'center', y: 40 }).style.cssText += 'font-size:22px;font-weight:300;letter-spacing:0.12em;text-align:center;';
    } else h.remove('race-result');
  },
});
