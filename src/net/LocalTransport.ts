import { EventEmitter } from '../core/EventEmitter';
import type { ConnectOptions, NetPayload, PeerId, SendOptions, SendTarget, Transport, TransportEvents } from './Transport';

/** Extra options for {@link LocalTransport}. */
export interface LocalTransportOptions {
  /** How long to wait for an existing host to answer before claiming the room (ms). Default 250. */
  discoveryMs?: number;
  /** Heartbeat period (ms). Default 500. */
  heartbeatMs?: number;
  /** Missed heartbeat window before a member is declared gone (ms). Default 4000: long enough to ride out a tab's GC pause or a burst of synchronous loading. */
  timeoutMs?: number;
  /** Channel name prefix. Default `forge-room-`. */
  prefix?: string;
}

/** Frames exchanged over the BroadcastChannel. */
type Frame =
  | { k: 'hello'; id: PeerId; name: string }
  | { k: 'roster'; id: PeerId; host: PeerId; members: { id: PeerId; name: string; seq: number }[] }
  | { k: 'welcome'; id: PeerId; to: PeerId; host: PeerId; members: { id: PeerId; name: string; seq: number }[] }
  | { k: 'leave'; id: PeerId }
  | { k: 'beat'; id: PeerId }
  | { k: 'msg'; id: PeerId; to: PeerId | 'all'; data: NetPayload; reliable: boolean };

interface Member { id: PeerId; name: string; seq: number; lastSeen: number }

/**
 * Multiplayer between tabs of the same browser with zero server, built on
 * `BroadcastChannel`. The first tab in a room is the host; every tab sends
 * heartbeats and when the host disappears (tab closed, crashed) the member
 * with the lowest join sequence takes over and everyone emits
 * `host-changed`. Delivery is reliable and ordered (same-origin message
 * queue); the `reliable` flag is carried for symmetry only.
 */
export class LocalTransport implements Transport {
  readonly name = 'local';
  localId: PeerId = '';
  isHost = false;
  hostId: PeerId = '';
  roomId = '';
  readonly peers: PeerId[] = [];
  connected = false;

  private events = new EventEmitter<TransportEvents>();
  private channel: BroadcastChannel | null = null;
  private members = new Map<PeerId, Member>();
  private mySeq = 0;
  private displayName = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<LocalTransportOptions>;
  private onPageHide = (): void => { void this.disconnect(); };

  constructor(opts: LocalTransportOptions = {}) {
    this.opts = { discoveryMs: opts.discoveryMs ?? 250, heartbeatMs: opts.heartbeatMs ?? 500, timeoutMs: opts.timeoutMs ?? 4000, prefix: opts.prefix ?? 'forge-room-' };
  }

  static get supported(): boolean {
    return typeof BroadcastChannel !== 'undefined';
  }

  async connect(opts: ConnectOptions): Promise<void> {
    if (!LocalTransport.supported) throw new Error('BroadcastChannel is not available in this browser');
    if (this.connected) await this.disconnect();
    this.roomId = opts.roomId;
    this.displayName = opts.displayName ?? '';
    this.localId = `tab-${Math.random().toString(36).slice(2, 8)}`;
    if (!this.displayName) this.displayName = this.localId;
    this.channel = new BroadcastChannel(this.opts.prefix + opts.roomId);
    this.channel.onmessage = (ev: MessageEvent<Frame>) => this.onFrame(ev.data);

    const welcome = new Promise<Frame & { k: 'welcome' } | null>((resolve) => {
      const t = setTimeout(() => resolve(null), this.opts.discoveryMs);
      this.pendingWelcome = (f) => { clearTimeout(t); resolve(f); };
    });
    this.post({ k: 'hello', id: this.localId, name: this.displayName });
    const w = await welcome;
    this.pendingWelcome = null;
    const now = Date.now();
    if (w) {
      this.hostId = w.host;
      this.isHost = false;
      for (const m of w.members) {
        if (m.id === this.localId) { this.mySeq = m.seq; continue; }
        this.members.set(m.id, { ...m, lastSeen: now });
        this.peers.push(m.id);
      }
    } else {
      this.hostId = this.localId;
      this.isHost = true;
      this.mySeq = 1;
    }
    this.members.set(this.localId, { id: this.localId, name: this.displayName, seq: this.mySeq, lastSeen: now });
    this.connected = true;
    this.timer = setInterval(() => this.tick(), this.opts.heartbeatMs);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
    this.events.emit('connected', { localId: this.localId, isHost: this.isHost, roomId: this.roomId, peers: this.peers.slice(), hostId: this.hostId });
    // Like the ws/peer transports, announce the members that were already in the room (with their
    // names) so listeners such as NetHub learn the host's display name; their hub hello may have
    // been posted before we were connected and was dropped.
    if (w) for (const m of w.members) if (m.id !== this.localId) this.events.emit('peer-join', { peerId: m.id, displayName: m.name });
  }

  private pendingWelcome: ((f: Frame & { k: 'welcome' }) => void) | null = null;

  async disconnect(): Promise<void> {
    if (!this.channel) return;
    if (this.connected) this.post({ k: 'leave', id: this.localId });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    this.channel.close();
    this.channel = null;
    const was = this.connected;
    this.connected = false;
    this.members.clear();
    this.peers.length = 0;
    this.isHost = false;
    this.hostId = '';
    this.roomId = '';
    if (was) this.events.emit('disconnected', { reason: 'local' });
  }

  send(to: SendTarget, data: NetPayload, opts?: SendOptions): void {
    if (!this.connected) return;
    this.post({ k: 'msg', id: this.localId, to, data, reliable: opts?.reliable !== false });
  }

  on<K extends keyof TransportEvents>(event: K, fn: (payload: TransportEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  rtt(): number {
    return 0;
  }

  // ------------------------------------------------------------------ internals

  private post(f: Frame): void {
    try { this.channel?.postMessage(f); } catch (error) { this.events.emit('error', { error, message: 'BroadcastChannel post failed' }); }
  }

  private rosterFrame(): { id: PeerId; name: string; seq: number }[] {
    return Array.from(this.members.values()).map((m) => ({ id: m.id, name: m.name, seq: m.seq }));
  }

  private onFrame(f: Frame): void {
    if (!f || typeof f !== 'object' || f.id === this.localId) return;
    switch (f.k) {
      case 'hello':
        if (this.connected && this.isHost) {
          const seq = Math.max(...Array.from(this.members.values()).map((m) => m.seq)) + 1;
          this.addMember(f.id, f.name, seq);
          this.post({ k: 'welcome', id: this.localId, to: f.id, host: this.localId, members: this.rosterFrame() });
          this.post({ k: 'roster', id: this.localId, host: this.localId, members: this.rosterFrame() });
        }
        break;
      case 'welcome':
        if (!this.connected && f.to === this.localId && this.pendingWelcome) this.pendingWelcome(f);
        break;
      case 'roster':
        if (this.connected && f.id === this.hostId) {
          for (const m of f.members) if (m.id !== this.localId && !this.members.has(m.id)) this.addMember(m.id, m.name, m.seq);
          for (const id of Array.from(this.members.keys())) if (id !== this.localId && !f.members.some((m) => m.id === id)) this.removeMember(id);
        }
        break;
      case 'leave':
        if (this.connected) this.removeMember(f.id);
        break;
      case 'beat': {
        const m = this.members.get(f.id);
        if (m) m.lastSeen = Date.now();
        break;
      }
      case 'msg':
        if (this.connected && (f.to === 'all' || f.to === this.localId) && this.members.has(f.id)) {
          this.events.emit('message', { from: f.id, data: f.data, reliable: f.reliable });
        }
        break;
    }
  }

  private addMember(id: PeerId, name: string, seq: number): void {
    if (this.members.has(id)) return;
    this.members.set(id, { id, name, seq, lastSeen: Date.now() });
    this.peers.push(id);
    this.events.emit('peer-join', { peerId: id, displayName: name });
  }

  private removeMember(id: PeerId): void {
    if (!this.members.delete(id)) return;
    const i = this.peers.indexOf(id);
    if (i >= 0) this.peers.splice(i, 1);
    this.events.emit('peer-leave', { peerId: id });
    if (id === this.hostId) this.electHost();
    else if (this.isHost) this.post({ k: 'roster', id: this.localId, host: this.localId, members: this.rosterFrame() });
  }

  private electHost(): void {
    let best: Member | null = null;
    for (const m of this.members.values()) if (!best || m.seq < best.seq) best = m;
    if (!best) return;
    this.hostId = best.id;
    this.isHost = best.id === this.localId;
    if (this.isHost) this.post({ k: 'roster', id: this.localId, host: this.localId, members: this.rosterFrame() });
    this.events.emit('host-changed', { hostId: this.hostId });
  }

  private tick(): void {
    if (!this.connected) return;
    this.post({ k: 'beat', id: this.localId });
    const now = Date.now();
    for (const m of Array.from(this.members.values())) {
      if (m.id !== this.localId && now - m.lastSeen > this.opts.timeoutMs) this.removeMember(m.id);
    }
  }
}
