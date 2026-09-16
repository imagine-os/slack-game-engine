// Forge Engine multiplayer relay server.
//
// Rooms, peer ids, host election + migration, targeted relay / broadcast of
// JSON and binary frames, ping/pong, idle-room cleanup and optional static
// hosting of the built game (`dist/`) so one process can serve everything.
// Protocol: src/net/WebSocketTransport.ts. Deployment: server/README.md.
//
// Usage:  node server/index.js            (PORT=8080 STATIC=dist by default)
//         PORT=3000 STATIC= node server/index.js   (relay only, no static files)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const WS_PATH = process.env.WS_PATH ?? '/ws';
const STATIC = process.env.STATIC === undefined ? path.resolve(__dirname, '..', 'dist') : process.env.STATIC ? path.resolve(process.env.STATIC) : '';
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 16);
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS ?? 60_000);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 15_000);
const MAX_FRAME = Number(process.env.MAX_FRAME ?? 256 * 1024);
const VERBOSE = process.env.VERBOSE === '1';

const BIN_RELAY = 0x01;

/** @typedef {{ id: string, name: string, room: Room | null, ws: import('ws').WebSocket, alive: boolean, joinedAt: number }} Peer */
/** @typedef {{ id: string, peers: Map<string, Peer>, hostId: string, emptySince: number, maxPlayers: number }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map();
let nextPeer = 1;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const debug = (...a) => { if (VERBOSE) log(...a); };

// ------------------------------------------------------------------ static

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  if (!STATIC) { res.writeHead(404); res.end('Forge relay server. Connect a WebSocket to ' + WS_PATH); return; }
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(STATIC, rel));
  if (!file.startsWith(STATIC)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // Single-page style fallback for the launcher.
      const index = path.join(STATIC, 'index.html');
      if (rel !== '/index.html' && fs.existsSync(index) && !path.extname(rel)) return streamFile(index, res);
      res.writeHead(404); res.end('Not found');
      return;
    }
    streamFile(file, res);
  });
}

function streamFile(file, res) {
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

// ------------------------------------------------------------------- rooms

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) rooms.set(id, (room = { id, peers: new Map(), hostId: '', emptySince: 0, maxPlayers: MAX_PLAYERS }));
  return room;
}

function send(peer, obj) {
  if (peer.ws.readyState === peer.ws.OPEN) peer.ws.send(JSON.stringify(obj));
}

function broadcast(room, obj, except) {
  const text = JSON.stringify(obj);
  for (const p of room.peers.values()) if (p !== except && p.ws.readyState === p.ws.OPEN) p.ws.send(text);
}

function join(peer, msg) {
  const roomId = String(msg.room ?? '').trim().slice(0, 64);
  if (!roomId) return send(peer, { t: 'error', code: 'bad-room', message: 'Room id required' });
  if (peer.room) leave(peer);
  const room = getRoom(roomId);
  if (room.peers.size >= room.maxPlayers) return send(peer, { t: 'error', code: 'room-full', message: `Room ${roomId} is full (${room.maxPlayers} players)` });
  peer.name = String(msg.name ?? '').slice(0, 32) || peer.id;
  peer.room = room;
  peer.joinedAt = Date.now();
  room.peers.set(peer.id, peer);
  room.emptySince = 0;
  if (!room.hostId) room.hostId = peer.id;
  send(peer, { t: 'welcome', id: peer.id, room: room.id, host: room.hostId, peers: Array.from(room.peers.values()).map((p) => ({ id: p.id, name: p.name })) });
  broadcast(room, { t: 'peer-join', id: peer.id, name: peer.name }, peer);
  debug(`join ${peer.id} (${peer.name}) -> ${room.id} [${room.peers.size}] host=${room.hostId}`);
}

function leave(peer) {
  const room = peer.room;
  if (!room) return;
  peer.room = null;
  room.peers.delete(peer.id);
  broadcast(room, { t: 'peer-leave', id: peer.id });
  if (room.hostId === peer.id) {
    // Host migration: longest-connected remaining peer takes over.
    let best = null;
    for (const p of room.peers.values()) if (!best || p.joinedAt < best.joinedAt) best = p;
    room.hostId = best ? best.id : '';
    if (best) broadcast(room, { t: 'host', id: best.id });
  }
  if (room.peers.size === 0) room.emptySince = Date.now();
  debug(`leave ${peer.id} <- ${room.id} [${room.peers.size}] host=${room.hostId}`);
}

function relayJson(peer, msg) {
  const room = peer.room;
  if (!room) return;
  const frame = { t: 'msg', from: peer.id, d: msg.d };
  if (msg.to === 'all') broadcast(room, frame, peer);
  else {
    const target = room.peers.get(String(msg.to));
    if (target) send(target, frame);
  }
}

function relayBinary(peer, buf) {
  const room = peer.room;
  if (!room || buf.length < 2 || buf[0] !== BIN_RELAY) return;
  const toLen = buf[1];
  const to = toLen ? buf.subarray(2, 2 + toLen).toString('utf8') : 'all';
  const payload = buf.subarray(2 + toLen);
  const from = Buffer.from(peer.id, 'utf8');
  const out = Buffer.allocUnsafe(2 + from.length + payload.length);
  out[0] = BIN_RELAY;
  out[1] = from.length;
  from.copy(out, 2);
  payload.copy(out, 2 + from.length);
  if (to === 'all') {
    for (const p of room.peers.values()) if (p !== peer && p.ws.readyState === p.ws.OPEN) p.ws.send(out);
  } else {
    const target = room.peers.get(to);
    if (target && target.ws.readyState === target.ws.OPEN) target.ws.send(out);
  }
}

// ----------------------------------------------------------------- server

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, peers: Array.from(rooms.values()).reduce((n, r) => n + r.peers.size, 0) }));
    return;
  }
  if (req.url?.startsWith('/rooms')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Array.from(rooms.values()).map((r) => ({ id: r.id, players: r.peers.size, host: r.hostId }))));
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: MAX_FRAME });

wss.on('connection', (ws, req) => {
  /** @type {Peer} */
  const peer = { id: `p${nextPeer++}`, name: '', room: null, ws, alive: true, joinedAt: Date.now() };
  debug(`connect ${peer.id} from ${req.socket.remoteAddress}`);
  ws.on('pong', () => { peer.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) { relayBinary(peer, Buffer.isBuffer(data) ? data : Buffer.from(data)); return; }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return send(peer, { t: 'error', code: 'bad-json', message: 'Invalid JSON' }); }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'join': join(peer, msg); break;
      case 'send': relayJson(peer, msg); break;
      case 'ping': send(peer, { t: 'pong', ts: msg.ts }); break;
      case 'leave': leave(peer); break;
      default: send(peer, { t: 'error', code: 'unknown', message: `Unknown message type ${String(msg.t)}` });
    }
  });
  ws.on('close', () => { leave(peer); debug(`disconnect ${peer.id}`); });
  ws.on('error', (err) => { debug(`ws error ${peer.id}: ${err.message}`); });
});

// Heartbeat: drop dead sockets so their rooms migrate promptly.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const peer = [...rooms.values()].flatMap((r) => [...r.peers.values()]).find((p) => p.ws === ws);
    if (peer && !peer.alive) { ws.terminate(); continue; }
    if (peer) peer.alive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
  // Idle room cleanup.
  const now = Date.now();
  for (const [id, room] of rooms) if (room.peers.size === 0 && room.emptySince && now - room.emptySince > ROOM_IDLE_MS) rooms.delete(id);
}, HEARTBEAT_MS);

server.listen(PORT, HOST, () => {
  log(`Forge relay listening on http://${HOST}:${PORT}  ws path ${WS_PATH}` + (STATIC ? `  static ${STATIC}` : '  (no static files)'));
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
