import { EventEmitter } from '../core/EventEmitter';
import { Random } from '../core/math';
import type { ConnectOptions, NetPayload, PeerId, SendOptions, SendTarget, Transport, TransportEvents } from './Transport';

/** Simulated link conditions for a {@link MemoryNetwork}. */
export interface MemoryNetworkOptions {
  /** One-way latency in virtual milliseconds. Default 0. */
  latency?: number;
  /** Random extra latency 0..jitter ms. Default 0. */
  jitter?: number;
  /** Packet loss probability 0..1 applied to **unreliable** sends only. Default 0. */
  loss?: number;
  /** Also drop reliable messages (for stress tests). Default false. */
  lossAffectsReliable?: boolean;
  /** Seed for the loss/jitter generator so tests are repeatable. */
  seed?: number;
  /** Deliver immediately on `send` when latency is 0 (default false: call `flush()` / `advance()`). */
  autoFlush?: boolean;
}

interface Pending {
  seq: number;
  at: number;
  to: MemoryTransport;
  from: PeerId;
  data: NetPayload;
  reliable: boolean;
}

interface Room {
  id: string;
  members: MemoryTransport[];
  hostId: PeerId;
  joinCounter: number;
}

/**
 * In-process "network" that links several {@link MemoryTransport}s with
 * virtual time, latency, jitter and loss. Deterministic and synchronous:
 * nothing is delivered until {@link flush} or {@link advance} runs, so tests
 * can interleave engine steps and message delivery precisely.
 */
export class MemoryNetwork {
  readonly options: Required<MemoryNetworkOptions>;
  /** Virtual clock in ms. */
  time = 0;
  private queue: Pending[] = [];
  private seq = 0;
  private rooms = new Map<string, Room>();
  private nextPeer = 1;
  private random: Random;
  /** Total messages dropped by the loss model. */
  dropped = 0;
  /** Total messages delivered. */
  delivered = 0;

  constructor(opts: MemoryNetworkOptions = {}) {
    this.options = {
      latency: opts.latency ?? 0,
      jitter: opts.jitter ?? 0,
      loss: opts.loss ?? 0,
      lossAffectsReliable: opts.lossAffectsReliable ?? false,
      seed: opts.seed ?? 1234,
      autoFlush: opts.autoFlush ?? false,
    };
    this.random = new Random(this.options.seed);
  }

  /** Create a transport attached to this network (not yet connected to a room). */
  createTransport(id?: PeerId): MemoryTransport {
    return new MemoryTransport(this, id ?? `p${this.nextPeer++}`);
  }

  /** Create `n` transports at once. */
  createTransports(n: number): MemoryTransport[] {
    const out: MemoryTransport[] = [];
    for (let i = 0; i < n; i++) out.push(this.createTransport());
    return out;
  }

  /** Peers currently in a room (join order). */
  roomPeers(roomId: string): PeerId[] {
    return this.rooms.get(roomId)?.members.map((m) => m.localId) ?? [];
  }

  hostOf(roomId: string): PeerId {
    return this.rooms.get(roomId)?.hostId ?? '';
  }

  /** @internal */
  join(t: MemoryTransport, roomId: string): { hostId: PeerId; peers: PeerId[] } {
    let room = this.rooms.get(roomId);
    if (!room) this.rooms.set(roomId, (room = { id: roomId, members: [], hostId: '', joinCounter: 0 }));
    const peers = room.members.map((m) => m.localId);
    room.members.push(t);
    room.joinCounter++;
    if (!room.hostId) room.hostId = t.localId;
    for (const m of room.members) if (m !== t) m._emit('peer-join', { peerId: t.localId, displayName: t.displayName });
    return { hostId: room.hostId, peers };
  }

  /** @internal */
  leave(t: MemoryTransport, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const i = room.members.indexOf(t);
    if (i < 0) return;
    room.members.splice(i, 1);
    // Drop anything still in flight to the leaver.
    this.queue = this.queue.filter((p) => p.to !== t);
    for (const m of room.members) m._emit('peer-leave', { peerId: t.localId });
    if (room.hostId === t.localId) {
      room.hostId = room.members[0]?.localId ?? '';
      if (room.hostId) for (const m of room.members) m._hostChanged(room.hostId);
    }
    if (room.members.length === 0) this.rooms.delete(roomId);
  }

  /** @internal */
  send(from: MemoryTransport, roomId: string, to: SendTarget, data: NetPayload, reliable: boolean): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const m of room.members) {
      if (m === from) continue;
      if (to !== 'all' && m.localId !== to) continue;
      if (this.options.loss > 0 && (!reliable || this.options.lossAffectsReliable) && this.random.next() < this.options.loss) {
        this.dropped++;
        continue;
      }
      const jitter = this.options.jitter > 0 ? this.random.next() * this.options.jitter : 0;
      const at = this.time + this.options.latency + jitter;
      this.queue.push({ seq: this.seq++, at, to: m, from: from.localId, data: cloneBinary(data), reliable });
    }
    if (this.options.autoFlush && this.options.latency === 0 && this.options.jitter === 0) this.flush();
  }

  /** Advance virtual time by `ms` and deliver everything that is due. */
  advance(ms: number): void {
    this.time += ms;
    this.deliverDue();
  }

  /** Deliver every queued message regardless of time (also advances the clock past the last one). */
  flush(): void {
    if (this.queue.length) {
      let max = this.time;
      for (const p of this.queue) if (p.at > max) max = p.at;
      this.time = max;
    }
    this.deliverDue();
  }

  /** Number of undelivered messages. */
  get pending(): number {
    return this.queue.length;
  }

  private deliverDue(): void {
    // Reliable messages keep order per sender; unreliable ones are sorted by arrival.
    let guard = 0;
    while (guard++ < 100000) {
      let bestIdx = -1;
      let best: Pending | null = null;
      for (let i = 0; i < this.queue.length; i++) {
        const p = this.queue[i];
        if (p.at > this.time) continue;
        if (!best || p.at < best.at || (p.at === best.at && p.seq < best.seq)) { best = p; bestIdx = i; }
      }
      if (!best) break;
      if (best.reliable) {
        // Deliver in send order relative to earlier reliable messages from the same sender to the same peer.
        let earlier: Pending | null = null;
        let earlierIdx = -1;
        for (let i = 0; i < this.queue.length; i++) {
          const p = this.queue[i];
          if (p.reliable && p.from === best.from && p.to === best.to && p.seq < best.seq && (!earlier || p.seq < earlier.seq)) { earlier = p; earlierIdx = i; }
        }
        if (earlier) { best = earlier; bestIdx = earlierIdx; }
      }
      this.queue.splice(bestIdx, 1);
      this.delivered++;
      if (best.to.connected) best.to._emit('message', { from: best.from, data: best.data, reliable: best.reliable });
    }
  }
}

function cloneBinary(data: NetPayload): NetPayload {
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return data.slice(0);
  return data;
}

/**
 * Transport linked through a {@link MemoryNetwork}. Used by the unit tests and
 * useful for bots / local AI peers running in the same process.
 */
export class MemoryTransport implements Transport {
  readonly name = 'memory';
  readonly localId: PeerId;
  isHost = false;
  hostId: PeerId = '';
  roomId = '';
  readonly peers: PeerId[] = [];
  connected = false;
  displayName = '';
  private events = new EventEmitter<TransportEvents>();
  /** Bytes sent (for tests / stats). */
  bytesOut = 0;

  constructor(readonly network: MemoryNetwork, id: PeerId) {
    this.localId = id;
  }

  async connect(opts: ConnectOptions): Promise<void> {
    if (this.connected) await this.disconnect();
    this.displayName = opts.displayName ?? this.localId;
    this.roomId = opts.roomId;
    this.connected = true;
    const { hostId, peers } = this.network.join(this, opts.roomId);
    this.peers.length = 0;
    this.peers.push(...peers);
    this.hostId = hostId;
    this.isHost = hostId === this.localId;
    this.events.emit('connected', { localId: this.localId, isHost: this.isHost, roomId: this.roomId, peers: peers.slice(), hostId });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    const room = this.roomId;
    this.connected = false;
    this.network.leave(this, room);
    this.roomId = '';
    this.peers.length = 0;
    this.isHost = false;
    this.hostId = '';
    this.events.emit('disconnected', { reason: 'local' });
  }

  send(to: SendTarget, data: NetPayload, opts?: SendOptions): void {
    if (!this.connected) return;
    this.bytesOut += data instanceof Uint8Array ? data.byteLength : data instanceof ArrayBuffer ? data.byteLength : JSON.stringify(data).length;
    this.network.send(this, this.roomId, to, data, opts?.reliable !== false);
  }

  on<K extends keyof TransportEvents>(event: K, fn: (payload: TransportEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  rtt(): number {
    return this.network.options.latency * 2 + this.network.options.jitter;
  }

  /** @internal */
  _emit<K extends keyof TransportEvents>(event: K, payload: TransportEvents[K]): void {
    if (event === 'peer-join') {
      const id = (payload as TransportEvents['peer-join']).peerId;
      if (!this.peers.includes(id)) this.peers.push(id);
    } else if (event === 'peer-leave') {
      const id = (payload as TransportEvents['peer-leave']).peerId;
      const i = this.peers.indexOf(id);
      if (i >= 0) this.peers.splice(i, 1);
    }
    this.events.emit(event, payload);
  }

  /** @internal */
  _hostChanged(hostId: PeerId): void {
    this.hostId = hostId;
    this.isHost = hostId === this.localId;
    this.events.emit('host-changed', { hostId });
  }
}
