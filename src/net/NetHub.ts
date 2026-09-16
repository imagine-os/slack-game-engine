import { EventEmitter } from '../core/EventEmitter';
import type { NetSync } from './NetSync';
import { NullTransport } from './NullTransport';
import type { ConnectOptions, NetPayload, PeerId, Transport, TransportEvents } from './Transport';
import { ByteReader, ByteWriter, isBinary, toU8, utf8Decode, utf8Encode } from './wire';

export interface NetHubEvents extends Record<string, unknown> {
  transportChanged: Transport;
  syncChanged: NetSync | null;
  /** Transport connected (`localId` valid). */
  connected: TransportEvents['connected'];
  disconnected: TransportEvents['disconnected'];
  /** A peer joined/left the transport room (before any sync-level handshake). */
  peerJoined: { peerId: PeerId; displayName: string };
  peerLeft: { peerId: PeerId };
  hostChanged: { hostId: PeerId };
  /** Roster or RTT changed. */
  presenceChanged: PresenceEntry[];
  error: TransportEvents['error'];
  /** A message that is not a channel envelope (legacy / raw transport traffic). */
  message: TransportEvents['message'];
}

/** Where a channel message goes. `host` and `others` are resolved by the hub. */
export type ChannelTarget = PeerId | 'all' | 'host' | 'others';

/** Data a channel can carry: JSON-able object or binary. */
export type ChannelData = object | Uint8Array | ArrayBuffer;

/**
 * A named message lane multiplexed over the active transport. Works before
 * any {@link NetSync} is installed, so tools (editor collaboration, chat,
 * lobbies) can talk over `engine.net.channel('editor')` directly.
 */
export interface NetChannel {
  readonly name: string;
  /**
   * Send to one peer, everyone else (`all` / `others`, never echoed back) or
   * the host. Objects are JSON encoded; `Uint8Array`/`ArrayBuffer` go binary.
   * Reliable by default.
   */
  send(to: ChannelTarget, data: ChannelData, opts?: { reliable?: boolean }): void;
  /** Subscribe to messages on this channel. Binary arrives as `Uint8Array`, JSON as the decoded value. */
  on(fn: (from: PeerId, data: unknown, reliable: boolean) => void): () => void;
  /** Number of subscribers. */
  readonly listenerCount: number;
}

/** One row of {@link NetHub.presence}. */
export interface PresenceEntry {
  peerId: PeerId;
  displayName: string;
  isHost: boolean;
  isLocal: boolean;
  /** Round-trip time in ms measured by hub pings (0 until the first pong). */
  rtt: number;
}

/** Bandwidth and timing counters exposed as `engine.net.stats`. */
export interface NetStats {
  /** Bytes received per second (sliding one-second window). */
  bytesInPerSec: number;
  bytesOutPerSec: number;
  messagesInPerSec: number;
  messagesOutPerSec: number;
  /** Total bytes since connect. */
  bytesIn: number;
  bytesOut: number;
  /** Size of the last snapshot sent or received by the sync layer (bytes). */
  snapshotBytes: number;
  /** RTT to the host in ms (or the mean RTT to clients when hosting). */
  rtt: number;
}

/** Kinds understood by {@link NetHub.connect}. */
export type TransportKind = 'local' | 'peer' | 'ws' | 'memory' | 'null';

/** Options for {@link NetHub.connect}: connect options plus transport-specific extras. */
export interface HubConnectOptions extends ConnectOptions {
  /** Pre-built transport to use instead of creating one from `kind`. */
  transport?: Transport;
}

/** Binary envelope marker for channel frames. */
const CHANNEL_MAGIC = 0xc0;
const HUB_CHANNEL = '_hub';

interface HubHello { k: 'hello'; name: string }
interface HubPing { k: 'ping'; t: number }
interface HubPong { k: 'pong'; t: number }
type HubMessage = HubHello | HubPing | HubPong;

class ChannelImpl implements NetChannel {
  readonly listeners = new Set<(from: PeerId, data: unknown, reliable: boolean) => void>();
  constructor(readonly name: string, private hub: NetHub) {}

  send(to: ChannelTarget, data: ChannelData, opts?: { reliable?: boolean }): void {
    this.hub._sendOnChannel(this.name, to, data, opts?.reliable !== false);
  }

  on(fn: (from: PeerId, data: unknown, reliable: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  dispatch(from: PeerId, data: unknown, reliable: boolean): void {
    for (const fn of Array.from(this.listeners)) fn(from, data, reliable);
  }
}

/**
 * `engine.net`: the single place the engine, scripts and the networking layer
 * meet. Holds the active {@link Transport} (NullTransport by default), an
 * optional {@link NetSync}, named {@link NetChannel}s multiplexed over the
 * transport, a presence roster with RTTs, and bandwidth {@link NetStats}.
 *
 * Scripts read `localId` / `isHost` here so they behave identically offline
 * and online.
 */
export class NetHub {
  readonly events = new EventEmitter<NetHubEvents>();
  /** Display name announced to other peers (set by `connect`). */
  displayName = '';
  /** Milliseconds between presence pings (0 disables). Driven by {@link update}. */
  pingIntervalMs = 1000;

  private _transport: Transport = new NullTransport();
  private _sync: NetSync | null = null;
  private channels = new Map<string, ChannelImpl>();
  private unsubscribe: (() => void)[] = [];
  private names = new Map<PeerId, string>();
  private rtts = new Map<PeerId, number>();
  private lastPing = 0;
  private writer = new ByteWriter(256);
  private reader = new ByteReader(new Uint8Array(0));
  private readonly counters = { bytesIn: 0, bytesOut: 0, msgIn: 0, msgOut: 0 };
  private window = { start: 0, bytesIn: 0, bytesOut: 0, msgIn: 0, msgOut: 0 };
  private readonly _stats: NetStats = { bytesInPerSec: 0, bytesOutPerSec: 0, messagesInPerSec: 0, messagesOutPerSec: 0, bytesIn: 0, bytesOut: 0, snapshotBytes: 0, rtt: 0 };

  constructor() {
    this.attach(this._transport);
    this.channel(HUB_CHANNEL).on((from, data) => this.onHubMessage(from, data as HubMessage));
  }

  get transport(): Transport {
    return this._transport;
  }

  get sync(): NetSync | null {
    return this._sync;
  }

  /** Install a transport (the net worker calls this). */
  setTransport(t: Transport): void {
    if (t === this._transport) return;
    this.detach();
    this._transport = t;
    this.names.clear();
    this.rtts.clear();
    this.attach(t);
    this.events.emit('transportChanged', t);
  }

  /** Install a sync implementation; `null` returns to offline mode. */
  setSync(s: NetSync | null): void {
    this._sync = s;
    this.events.emit('syncChanged', s);
  }

  get localId(): PeerId {
    return this._transport.localId;
  }

  get isHost(): boolean {
    return this._transport.isHost;
  }

  /** Current host peer id (empty when unknown). */
  get hostId(): PeerId {
    return this._transport.hostId;
  }

  get connected(): boolean {
    return this._transport.connected;
  }

  get roomId(): string {
    return this._transport.roomId;
  }

  /** True when a real sync layer is running. */
  get online(): boolean {
    return this._sync !== null && this._transport.connected && this._transport.name !== 'null';
  }

  // ---------------------------------------------------------------- connect

  /**
   * Create a transport of `kind` (see `createTransport`) and connect it.
   * Resolves once the room is joined. `local` uses BroadcastChannel (same
   * browser), `peer` WebRTC via PeerJS signalling, `ws` our relay server.
   */
  async connect(kind: TransportKind, opts: HubConnectOptions): Promise<Transport> {
    const { transport: given, ...rest } = opts;
    let transport: Transport;
    if (given) transport = given;
    else {
      const { createTransport } = await import('./createTransport');
      transport = createTransport(kind, rest);
    }
    this.displayName = opts.displayName ?? this.displayName;
    this.setTransport(transport);
    await transport.connect(rest);
    return transport;
  }

  /** Disconnect the transport and remove the sync. */
  async disconnect(): Promise<void> {
    this._sync?.stop();
    this.setSync(null);
    await this._transport.disconnect();
  }

  // --------------------------------------------------------------- channels

  /** Get (or create) a named channel. Names starting with `_` are reserved for the engine. */
  channel(name: string): NetChannel {
    let c = this.channels.get(name);
    if (!c) this.channels.set(name, (c = new ChannelImpl(name, this)));
    return c;
  }

  /** @internal */
  _sendOnChannel(name: string, to: ChannelTarget, data: ChannelData, reliable: boolean): void {
    const t = this._transport;
    if (!t.connected) return;
    let target: PeerId | 'all';
    if (to === 'all' || to === 'others') target = 'all';
    else if (to === 'host') {
      if (t.isHost) { this.dispatchLocal(name, data, reliable); return; }
      target = t.hostId;
      if (!target) return;
    } else target = to;
    if (target === t.localId) { this.dispatchLocal(name, data, reliable); return; }
    let payload: NetPayload;
    let size: number;
    if (isBinary(data)) {
      const body = toU8(data);
      const nameBytes = utf8Encode(name);
      const w = this.writer.reset();
      w.u8(CHANNEL_MAGIC).u8(nameBytes.length).raw(nameBytes).raw(body);
      const bytes = w.toBytes();
      payload = bytes;
      size = bytes.byteLength;
    } else {
      payload = { c: name, d: data };
      size = estimateJsonSize(payload);
    }
    this.count('out', size);
    t.send(target, payload, { reliable });
  }

  private dispatchLocal(name: string, data: ChannelData, reliable: boolean): void {
    const c = this.channels.get(name);
    if (!c) return;
    const value = isBinary(data) ? toU8(data) : structuredCloneSafe(data);
    c.dispatch(this._transport.localId, value, reliable);
  }

  // --------------------------------------------------------------- presence

  /** Roster of everyone in the room (including the local peer) with names and RTTs. */
  get presence(): PresenceEntry[] {
    const t = this._transport;
    const out: PresenceEntry[] = [];
    if (!t.connected) return out;
    out.push({ peerId: t.localId, displayName: this.displayName || t.localId, isHost: t.isHost, isLocal: true, rtt: 0 });
    for (const p of t.peers) {
      out.push({ peerId: p, displayName: this.names.get(p) ?? p, isHost: p === t.hostId, isLocal: false, rtt: this.rtts.get(p) ?? 0 });
    }
    return out;
  }

  /** Display name of a peer (falls back to the id). */
  nameOf(peerId: PeerId): string {
    if (peerId === this._transport.localId) return this.displayName || peerId;
    return this.names.get(peerId) ?? peerId;
  }

  /** Measured RTT to a peer in ms (0 when unknown). */
  rttTo(peerId: PeerId): number {
    return this.rtts.get(peerId) ?? 0;
  }

  /**
   * Drive presence pings and stats windows. Sync implementations call this
   * from their `update`; UIs without a sync can call it from a timer.
   * `now` is wall-clock ms (default `performance.now()`).
   */
  update(now: number = nowMs()): void {
    const t = this._transport;
    if (!t.connected || t.name === 'null') return;
    if (this.pingIntervalMs > 0 && now - this.lastPing >= this.pingIntervalMs && t.peers.length > 0) {
      this.lastPing = now;
      const ping: HubPing = { k: 'ping', t: now };
      this.channel(HUB_CHANNEL).send('all', ping, { reliable: false });
    }
    this.rollWindow(now);
  }

  // ------------------------------------------------------------------ stats

  /** Bandwidth / latency counters. Rates use a one-second sliding window. */
  get stats(): NetStats {
    this.rollWindow(nowMs());
    const s = this._stats;
    s.bytesIn = this.counters.bytesIn;
    s.bytesOut = this.counters.bytesOut;
    const t = this._transport;
    if (t.isHost) {
      let sum = 0, n = 0;
      for (const p of t.peers) { const r = this.rtts.get(p); if (r !== undefined) { sum += r; n++; } }
      s.rtt = n ? sum / n : 0;
    } else s.rtt = this.rtts.get(t.hostId) ?? t.rtt();
    return s;
  }

  /** @internal sync layers report snapshot sizes here. */
  _reportSnapshot(bytes: number): void {
    this._stats.snapshotBytes = bytes;
  }

  /** @internal count traffic that bypasses channels (sync layers using the transport directly). */
  _count(direction: 'in' | 'out', bytes: number): void {
    this.count(direction, bytes);
  }

  private count(direction: 'in' | 'out', bytes: number): void {
    if (direction === 'in') { this.counters.bytesIn += bytes; this.counters.msgIn++; this.window.bytesIn += bytes; this.window.msgIn++; }
    else { this.counters.bytesOut += bytes; this.counters.msgOut++; this.window.bytesOut += bytes; this.window.msgOut++; }
  }

  private rollWindow(now: number): void {
    const w = this.window;
    if (w.start === 0) { w.start = now; return; }
    const elapsed = now - w.start;
    if (elapsed < 1000) return;
    const k = 1000 / elapsed;
    const s = this._stats;
    s.bytesInPerSec = w.bytesIn * k;
    s.bytesOutPerSec = w.bytesOut * k;
    s.messagesInPerSec = w.msgIn * k;
    s.messagesOutPerSec = w.msgOut * k;
    w.start = now; w.bytesIn = w.bytesOut = w.msgIn = w.msgOut = 0;
  }

  // -------------------------------------------------------------- internals

  private attach(t: Transport): void {
    this.unsubscribe.push(
      t.on('message', (m) => this.onMessage(m)),
      t.on('connected', (e) => {
        this.window.start = 0;
        this.counters.bytesIn = this.counters.bytesOut = this.counters.msgIn = this.counters.msgOut = 0;
        this.events.emit('connected', e);
        this.sayHello('all');
        this.emitPresence();
      }),
      t.on('disconnected', (e) => { this.names.clear(); this.rtts.clear(); this.events.emit('disconnected', e); this.emitPresence(); }),
      t.on('peer-join', (e) => {
        if (e.displayName) this.names.set(e.peerId, e.displayName);
        this.events.emit('peerJoined', { peerId: e.peerId, displayName: this.nameOf(e.peerId) });
        this.sayHello(e.peerId);
        this.emitPresence();
      }),
      t.on('peer-leave', (e) => { this.names.delete(e.peerId); this.rtts.delete(e.peerId); this.events.emit('peerLeft', e); this.emitPresence(); }),
      t.on('host-changed', (e) => { this.events.emit('hostChanged', e); this.emitPresence(); }),
      t.on('error', (e) => this.events.emit('error', e)),
    );
  }

  private detach(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }

  private sayHello(to: PeerId | 'all'): void {
    if (this._transport.name === 'null') return;
    const hello: HubHello = { k: 'hello', name: this.displayName || this._transport.localId };
    this.channel(HUB_CHANNEL).send(to, hello);
  }

  private onHubMessage(from: PeerId, msg: HubMessage): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.k) {
      case 'hello':
        if (this.names.get(from) !== msg.name) { this.names.set(from, msg.name); this.emitPresence(); }
        break;
      case 'ping': {
        const pong: HubPong = { k: 'pong', t: msg.t };
        this.channel(HUB_CHANNEL).send(from, pong, { reliable: false });
        break;
      }
      case 'pong': {
        const rtt = Math.max(0, nowMs() - msg.t);
        const prev = this.rtts.get(from);
        // Light smoothing so the lobby does not flicker.
        this.rtts.set(from, prev === undefined ? rtt : prev * 0.7 + rtt * 0.3);
        this.emitPresence();
        break;
      }
    }
  }

  private emitPresence(): void {
    if (this.events.listenerCount('presenceChanged') > 0) this.events.emit('presenceChanged', this.presence);
  }

  private onMessage(m: TransportEvents['message']): void {
    const data = m.data;
    if (isBinary(data)) {
      const bytes = toU8(data);
      this.count('in', bytes.byteLength);
      if (bytes.byteLength >= 2 && bytes[0] === CHANNEL_MAGIC) {
        const r = this.reader.reset(bytes);
        r.u8();
        const len = r.u8();
        const name = utf8Decode(bytes.subarray(2, 2 + len));
        r.offset = 2 + len;
        const c = this.channels.get(name);
        if (c) c.dispatch(m.from, r.rest(), m.reliable);
        return;
      }
      this.events.emit('message', m);
      return;
    }
    const env = data as { c?: unknown; d?: unknown };
    if (env && typeof env.c === 'string' && 'd' in env) {
      this.count('in', estimateJsonSize(data));
      const c = this.channels.get(env.c);
      if (c) c.dispatch(m.from, env.d, m.reliable);
      return;
    }
    this.count('in', estimateJsonSize(data));
    this.events.emit('message', m);
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function estimateJsonSize(v: unknown): number {
  try { return JSON.stringify(v).length; } catch { return 0; }
}

function structuredCloneSafe<T>(v: T): T {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)) as T; }
}
