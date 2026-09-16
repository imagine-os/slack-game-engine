// Shared tower-defence state: gold, base health, waves, tower placement.
// Every player gets a Builder cursor; placement requests arrive as messages
// and are validated here on the host, so the whole team spends one purse.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }

const COLORS = ['#4cc2ff', '#ff7a3d', '#8b7dff', '#06d6a0'];

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
  name: 'GameManager',
  description: 'Gold, waves, base health and tower placement.',
  props: {
    startGold: { type: 'integer', default: 120, min: 0 },
    towerCost: { type: 'integer', default: 50, min: 1 },
    baseHealth: { type: 'integer', default: 20, min: 1 },
    waveDelay: { type: 'number', default: 5, min: 0, max: 60, label: 'Seconds between waves' },
    waveBonus: { type: 'integer', default: 25 },
    mapWidth: { type: 'number', default: 36 },
    mapHeight: { type: 'number', default: 18 },
    pathClearance: { type: 'number', default: 1.1, label: 'Min distance from the road' },
    path: { type: 'json', default: [[-16, 6], [-8, 6], [-8, -4], [2, -4], [2, 5], [10, 5], [10, -3], [16.5, -3]] },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.gold = ctx.props.startGold;
    s.base = ctx.props.baseHealth;
    s.wave = 0;
    s.toSpawn = 0;
    s.over = false;
    s.players = {};
    s.count = 0;
    s.unsub = [];
    if (ctx.net.isHost) {
      this.addPlayer(ctx, ctx.net.localId);
      const sync = ctx.net.hub.sync;
      if (sync) {
        for (const p of sync.players()) if (p.peerId !== ctx.net.localId) this.addPlayer(ctx, p.peerId);
        s.unsub.push(sync.on('playerJoined', ({ peerId }) => { this.addPlayer(ctx, peerId); this.resendHud(ctx); }));
        s.unsub.push(sync.on('playerLeft', ({ peerId }) => this.removePlayer(ctx, peerId)));
      }
      s.nextWaveAt = ctx.time.elapsed + ctx.props.waveDelay;
    }
    this.drawHud(ctx);
  },
  onDestroy(ctx) {
    for (const off of ctx.state.unsub) off();
    const h = hud(ctx);
    if (h) { h.remove('gold'); h.remove('wave'); h.remove('hint'); h.remove('over'); }
  },
  addPlayer(ctx, peerId) {
    const s = ctx.state;
    if (s.players[peerId]) return;
    const index = s.count++;
    const entity = ctx.net.spawn('Builder', { ownerId: peerId, position: { x: 0, y: 0 } });
    const pi = ctx.getOn(entity, 'PlayerInput');
    if (pi) pi.owner = peerId;
    const ni = ctx.getOn(entity, 'NetworkIdentity');
    if (ni) ni.ownerId = peerId;
    const name = ctx.getOn(entity, 'Name');
    if (name) name.name = `Builder ${peerId}`;
    const script = ctx.getOn(entity, 'Script');
    script.props.color = COLORS[index % COLORS.length];
    script.props.label = `P${index + 1}`;
    script.props.cost = ctx.props.towerCost;
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

  canPlace(ctx, x, y) {
    const hw = ctx.props.mapWidth / 2, hh = ctx.props.mapHeight / 2;
    if (Math.abs(x) > hw - 0.5 || Math.abs(y) > hh - 0.5) return false;
    if (distToPath(ctx.props.path, x, y) < ctx.props.pathClearance) return false;
    for (const t of ctx.findAll('tower')) {
      const tt = ctx.getOn(t, 'Transform');
      if (Math.abs(tt.x - x) < 0.9 && Math.abs(tt.y - y) < 0.9) return false;
    }
    return true;
  },
  onMessage(ctx, name, data) {
    const s = ctx.state;
    if (name === 'queryGold') { ctx.send('goldChanged', { gold: s.gold }); return; }
    if (!ctx.net.isHost || s.over) return;
    if (name === 'placeTower') {
      if (s.gold < ctx.props.towerCost || !this.canPlace(ctx, data.x, data.y)) { ctx.audio.play('deny', { volume: 0.4 }); return; }
      s.gold -= ctx.props.towerCost;
      const tower = ctx.net.spawn('Tower', { position: { x: data.x, y: data.y } });
      ctx.getOn(tower, 'Script').props.builtBy = data.by || '';
      ctx.audio.play('place', { volume: 0.6 });
      ctx.send('goldChanged', { gold: s.gold });
    } else if (name === 'enemyKilled') {
      s.gold += data.reward || 0;
      ctx.send('goldChanged', { gold: s.gold });
    } else if (name === 'enemyReachedBase') {
      s.base--;
      ctx.audio.play('lose', { volume: 0.7 });
      const cam = ctx.find('Camera');
      const c = cam !== undefined ? ctx.getOn(cam, 'Camera2D') : null;
      if (c) c.shake = 0.3;
      if (s.base <= 0) this.gameOver(ctx);
    }
    this.drawHud(ctx);
  },
  onUpdate(ctx) {
    const s = ctx.state;
    if (!ctx.net.isHost || s.over) return;
    if (s.nextWaveAt !== undefined && ctx.time.elapsed >= s.nextWaveAt) { s.nextWaveAt = undefined; this.startWave(ctx); }
    if (s.nextWaveAt === undefined && s.toSpawn === 0 && s.wave > 0 && ctx.findAll('enemy').length === 0 && !s.cleared) {
      s.cleared = true;
      s.gold += ctx.props.waveBonus;
      ctx.audio.play('clear', { volume: 0.6 });
      ctx.send('goldChanged', { gold: s.gold });
      s.nextWaveAt = ctx.time.elapsed + ctx.props.waveDelay;
    }
    if (ctx.time.frame % 10 === 0) this.drawHud(ctx);
  },
  startWave(ctx) {
    const s = ctx.state;
    s.wave++;
    s.cleared = false;
    s.toSpawn = 4 + s.wave * 2;
    const hp = 2 + Math.floor(s.wave * 1.3);
    const speed = 1.6 + s.wave * 0.1;
    const start = ctx.props.path[0];
    const spawnOne = () => {
      if (s.over || s.toSpawn <= 0) return;
      s.toSpawn--;
      const e = ctx.net.spawn('Enemy', { position: { x: start[0], y: start[1] } });
      const sc = ctx.getOn(e, 'Script');
      sc.props.hp = hp;
      sc.props.speed = speed;
      sc.props.reward = 6 + s.wave;
      if (s.wave % 3 === 0 && s.toSpawn % 4 === 0) { sc.props.hp = hp * 3; sc.props.speed = speed * 0.7; sc.props.reward *= 3; sc.props.big = true; }
      if (s.toSpawn > 0) ctx.timer(Math.max(0.35, 0.9 - s.wave * 0.05), spawnOne);
    };
    spawnOne();
    this.drawHud(ctx);
  },
  gameOver(ctx) {
    const s = ctx.state;
    s.over = true;
    s.overBody = `You survived ${s.wave - 1} wave${s.wave - 1 === 1 ? '' : 's'}.\nRestarting in 6s`;
    const h = hud(ctx);
    if (h) h.panel('over', 'The base has fallen', s.overBody);
    this.drawHud(ctx);
    ctx.timer(6, () => this.restart(ctx));
  },
  restart(ctx) {
    const s = ctx.state;
    const sync = ctx.net.hub.sync;
    for (const e of [...ctx.findAll('enemy'), ...ctx.findAll('tower'), ...ctx.findAll('shot')]) { if (sync) sync.despawn(e); else ctx.destroy(e); }
    s.gold = ctx.props.startGold;
    s.base = ctx.props.baseHealth;
    s.wave = 0;
    s.toSpawn = 0;
    s.over = false;
    s.overBody = null;
    s.cleared = false;
    s.nextWaveAt = ctx.time.elapsed + ctx.props.waveDelay;
    ctx.send('goldChanged', { gold: s.gold });
    const h = hud(ctx);
    if (h) h.remove('over');
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
    s.gold = d.gold; s.base = d.base; s.wave = d.wave; s.toSpawn = d.toSpawn; s.over = d.over;
    s.nextWaveAt = d.secsToWave === null ? undefined : ctx.time.elapsed + d.secsToWave;
    ctx.send('goldChanged', { gold: s.gold });   // local Builders colour their cursor by affordability
    const h = hud(ctx);
    if (h) { if (d.overBody) h.panel('over', 'The base has fallen', d.overBody); else h.remove('over'); }
    this.drawHud(ctx);
  },
  drawHud(ctx) {
    const s = ctx.state;
    const secsToWave = s.nextWaveAt !== undefined ? Math.max(0, Math.ceil(s.nextWaveAt - ctx.time.elapsed)) : null;
    this.broadcastHud(ctx, { gold: s.gold, base: s.base, wave: s.wave, toSpawn: s.toSpawn, secsToWave, over: s.over, overBody: s.overBody || null });
    const h = hud(ctx);
    if (!h) return;
    h.text('gold', `Gold ${s.gold}   Base ${s.base}/${ctx.props.baseHealth}`, { anchor: 'top-left' }).style.fontSize = '18px';
    const next = s.nextWaveAt !== undefined ? `next wave in ${Math.max(0, Math.ceil(s.nextWaveAt - ctx.time.elapsed))}s` : `${ctx.findAll('enemy').length + s.toSpawn} enemies`;
    h.text('wave', `Wave ${s.wave}   ${next}`, { anchor: 'top-right', y: 48 });
    h.text('hint', `Click / tap to build a tower (${ctx.props.towerCost} gold, shared) · not on the road`, { anchor: 'bottom-right' });
  },
});
