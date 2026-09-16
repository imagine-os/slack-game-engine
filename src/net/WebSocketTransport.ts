import { EventEmitter } from '../core/EventEmitter';
import type { ConnectOptions, NetPayload, PeerId, SendOptions, SendTarget, Transport, TransportEvents } from './Transport';
import { isBinary, toU8, utf8Decode, utf8Encode } from './wire';

/** Extra options for {@link WebSocketTransport}. */
export interface WebSocketTransportOptions {
  /** Relay server URL (`wss://host/ws`). Default: `ws(s)://<page host>/ws`. */
  serverUrl?: string;
  /** Ping period for RTT measurement (ms). Default 2000. */
  pingMs?: number;
  /** Connect timeout (ms). Default 8000. */
  timeoutMs?: number;
}

/** Server → client control frames (see `server/index.js`). */
type ServerFrame =
  | { t: 'welcome'; id: PeerId; room: string; host: PeerId; peers: { id: PeerId; name: string }[] }
  | { t: 'peer-join'; id: PeerId; name: string }
  | { t: 'peer-leave'; id: PeerId }
  | { t: 'host'; id: PeerId }
  | { t: 'msg'; from: PeerId; d: unknown }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: string; message: string };

/** Marker byte for relayed binary frames. */
const BIN_RELAY = 0x01;

/** Resolve the relay URL: explicit `serverUrl`, else same host as the page under `/ws`. */
export function defaultServerUrl(serverUrl?: string): string {
  if (serverUrl) {
    if (/^wss?:\/\//.test(serverUrl)) return serverUrl;
    if (/^https?:\/\//.test(serverUrl)) return serverUrl.replace(/^http/, 'ws');
    const secure = typeof location !== 'undefined' && location.protocol === 'https:';
    return `${secure ? 'wss' : 'ws'}://${serverUrl}`;
  }
  if (typeof location === 'undefined') return 'ws://localhost:8080/ws';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * Transport talking to the Forge relay server (`server/index.js`). The server
 * owns rooms, assigns peer ids, elects the host (first to join, then the
 * longest-connected member on host loss) and relays messages to one peer or
 * the whole room. JSON goes as text frames, binary as `[0x01][len][to][payload]`.
 * Everything is reliable (TCP); `reliable: false` is accepted and ignored.
 */
export class WebSocketTransport implements Transport {
  readonly name = 'ws';
  localId: PeerId = '';
  isHost = false;
  hostId: PeerId = '';
  roomId = '';
  readonly peers: PeerId[] = [];
  connected = false;

  private events = new EventEmitter<TransportEvents>();
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private _rtt = 0;
  private readonly opts: Required<WebSocketTransportOptions>;
  /** Resolved server URL after `connect`. */
  url = '';

  constructor(opts: WebSocketTransportOptions = {}) {
    this.opts = { serverUrl: opts.serverUrl ?? '', pingMs: opts.pingMs ?? 2000, timeoutMs: opts.timeoutMs ?? 8000 };
  }

  async connect(opts: ConnectOptions): Promise<void> {
    if (this.connected) await this.disconnect();
    if (typeof WebSocket === 'undefined') throw new Error('WebSocket is not available');
    this.url = defaultServerUrl((opts.serverUrl as string | undefined) || this.opts.serverUrl || undefined);
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); ws.close(); reject(new Error(`Timed out connecting to ${this.url}`)); }, this.opts.timeoutMs);
      const cleanup = (): void => { clearTimeout(timer); ws.onopen = null; ws.onerror = null; };
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'join', room: opts.roomId, name: opts.displayName ?? '', wantHost: opts.wantHost !== false }));
      };
      ws.onerror = () => { cleanup(); reject(new Error(`Could not reach relay server at ${this.url}`)); };
      ws.onmessage = (ev) => {
        // First message must be the welcome (or an error).
        const frame = this.parseText(ev.data);
        if (!frame) return;
        if (frame.t === 'welcome') {
          cleanup();
          this.onWelcome(frame, opts.roomId);
          ws.onmessage = (e) => this.onMessage(e.data);
          ws.onclose = (e) => this.onClose(e.reason || `closed (${e.code})`);
          ws.onerror = () => this.events.emit('error', { error: new Error('WebSocket error'), message: 'WebSocket error' });
          resolve();
        } else if (frame.t === 'error') {
          cleanup();
          ws.close();
          reject(new Error(frame.message));
        }
      };
    });
  }

  private onWelcome(f: ServerFrame & { t: 'welcome' }, room: string): void {
    this.localId = f.id;
    this.roomId = f.room || room;
    this.hostId = f.host;
    this.isHost = f.host === f.id;
    this.peers.length = 0;
    for (const p of f.peers) if (p.id !== f.id) this.peers.push(p.id);
    this.connected = true;
    this.pingTimer = setInterval(() => this.ping(), this.opts.pingMs);
    this.ping();
    this.events.emit('connected', { localId: this.localId, isHost: this.isHost, roomId: this.roomId, peers: this.peers.slice(), hostId: this.hostId });
    // Names arrive with the welcome; surface them as joins so the hub learns display names.
    for (const p of f.peers) if (p.id !== f.id && p.name) this.events.emit('peer-join', { peerId: p.id, displayName: p.name });
  }

  async disconnect(): Promise<void> {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'leave' })); } catch { /* ignore */ }
    ws.onclose = null;
    ws.close();
    this.finish('local');
  }

  private onClose(reason: string): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.ws = null;
    this.finish(reason);
  }

  private finish(reason: string): void {
    const was = this.connected;
    this.connected = false;
    this.peers.length = 0;
    this.isHost = false;
    this.hostId = '';
    this.roomId = '';
    if (was) this.events.emit('disconnected', { reason });
  }

  send(to: SendTarget, data: NetPayload, _opts?: SendOptions): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (isBinary(data)) {
      const body = toU8(data);
      const target = to === 'all' ? new Uint8Array(0) : utf8Encode(to);
      const out = new Uint8Array(2 + target.length + body.byteLength);
      out[0] = BIN_RELAY;
      out[1] = target.length;
      out.set(target, 2);
      out.set(body, 2 + target.length);
      ws.send(out);
    } else {
      ws.send(JSON.stringify({ t: 'send', to, d: data }));
    }
  }

  on<K extends keyof TransportEvents>(event: K, fn: (payload: TransportEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  /** RTT to the relay server (ms). Per-peer RTT comes from the hub's presence pings. */
  rtt(): number {
    return this._rtt;
  }

  // ------------------------------------------------------------------ internals

  private ping(): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping', ts: Date.now() }));
  }

  private parseText(data: unknown): ServerFrame | null {
    if (typeof data !== 'string') return null;
    try { return JSON.parse(data) as ServerFrame; } catch { return null; }
  }

  private onMessage(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      if (bytes.length < 2 || bytes[0] !== BIN_RELAY) return;
      const len = bytes[1];
      const from = utf8Decode(bytes.subarray(2, 2 + len));
      this.events.emit('message', { from, data: bytes.subarray(2 + len), reliable: true });
      return;
    }
    const f = this.parseText(data);
    if (!f) return;
    switch (f.t) {
      case 'msg':
        this.events.emit('message', { from: f.from, data: f.d as NetPayload, reliable: true });
        break;
      case 'peer-join':
        if (!this.peers.includes(f.id)) this.peers.push(f.id);
        this.events.emit('peer-join', { peerId: f.id, displayName: f.name });
        break;
      case 'peer-leave': {
        const i = this.peers.indexOf(f.id);
        if (i >= 0) this.peers.splice(i, 1);
        this.events.emit('peer-leave', { peerId: f.id });
        break;
      }
      case 'host':
        this.hostId = f.id;
        this.isHost = f.id === this.localId;
        this.events.emit('host-changed', { hostId: f.id });
        break;
      case 'pong':
        this._rtt = Math.max(0, Date.now() - f.ts);
        break;
      case 'error':
        this.events.emit('error', { error: new Error(f.message), message: f.message, fatal: f.code === 'room-full' });
        break;
    }
  }
}
