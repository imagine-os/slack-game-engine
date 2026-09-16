import type { Engine } from '../../core/Engine';
import { shortId } from '../ui/dom';

export type SendTarget = string | 'all' | 'host' | 'others';

/** Minimal messaging surface the collaboration layer needs. */
export interface CollabChannel {
  readonly localId: string;
  readonly isHost: boolean;
  readonly roomId: string;
  peers(): string[];
  send(to: SendTarget, data: object): void;
  onMessage(fn: (from: string, data: unknown) => void): () => void;
  onPeerJoin(fn: (id: string) => void): () => void;
  onPeerLeave(fn: (id: string) => void): () => void;
  close(): void;
}

/** Shape of the networking worker's channel API (feature-detected at runtime). */
interface NetWithChannels {
  connect?(kind: 'local' | 'peer' | 'ws', opts: { roomId: string; displayName?: string }): Promise<unknown>;
  channel?(name: string): { send(to: SendTarget, data: object, opts?: { reliable?: boolean }): void; on(fn: (from: string, data: unknown) => void): () => void };
  localId?: string;
  isHost?: boolean;
  events?: { on(event: string, fn: (payload: unknown) => void): () => void };
  presence?: { id: string; displayName: string }[];
  transport?: { peers?: readonly string[]; connected?: boolean };
}

/**
 * Open a collaboration channel for a room. Uses the networking layer's
 * `engine.net.connect` / `engine.net.channel` when present, otherwise falls
 * back to a same-browser BroadcastChannel implementation (two tabs).
 */
export async function openChannel(engine: Engine | null, roomId: string, displayName: string, prefer: ('ws' | 'peer' | 'local')[] = ['ws', 'peer']): Promise<CollabChannel> {
  const net = engine?.net as unknown as NetWithChannels | undefined;
  if (net && typeof net.connect === 'function' && typeof net.channel === 'function') {
    for (const kind of prefer) {
      try {
        await net.connect(kind, { roomId, displayName });
        return new NetChannel(net, roomId);
      } catch (err) {
        console.warn(`[collab] ${kind} transport failed:`, err);
      }
    }
  }
  const local = new LocalChannel(roomId);
  await local.ready;
  return local;
}

/** Adapter over the networking worker's channel API. */
class NetChannel implements CollabChannel {
  private ch: NonNullable<ReturnType<NonNullable<NetWithChannels['channel']>>>;
  private msgHandlers = new Set<(from: string, data: unknown) => void>();
  private off: (() => void)[] = [];
  private joinHandlers = new Set<(id: string) => void>();
  private leaveHandlers = new Set<(id: string) => void>();

  constructor(private readonly net: NetWithChannels, readonly roomId: string) {
    this.ch = net.channel!('editor-collab');
    this.off.push(this.ch.on((from, data) => { for (const h of this.msgHandlers) h(from, data); }));
    if (net.events) {
      this.off.push(net.events.on('peer-join', (p) => { const id = peerId(p); for (const h of this.joinHandlers) h(id); }));
      this.off.push(net.events.on('peer-leave', (p) => { const id = peerId(p); for (const h of this.leaveHandlers) h(id); }));
    }
  }
  get localId(): string { return this.net.localId ?? 'local'; }
  get isHost(): boolean { return !!this.net.isHost; }
  peers(): string[] { return Array.from(this.net.transport?.peers ?? this.net.presence?.map((p) => p.id).filter((id) => id !== this.localId) ?? []); }
  send(to: SendTarget, data: object): void { this.ch.send(to, data, { reliable: true }); }
  onMessage(fn: (from: string, data: unknown) => void): () => void { this.msgHandlers.add(fn); return () => this.msgHandlers.delete(fn); }
  onPeerJoin(fn: (id: string) => void): () => void { this.joinHandlers.add(fn); return () => this.joinHandlers.delete(fn); }
  onPeerLeave(fn: (id: string) => void): () => void { this.leaveHandlers.add(fn); return () => this.leaveHandlers.delete(fn); }
  close(): void { for (const o of this.off) o(); }
}

function peerId(p: unknown): string {
  if (typeof p === 'string') return p;
  const o = p as { peerId?: string; id?: string };
  return o.peerId ?? o.id ?? String(p);
}

interface LocalMsg { kind: 'hello' | 'welcome' | 'bye' | 'msg'; from: string; to?: SendTarget; data?: unknown; host?: string; peers?: string[] }

/**
 * Same-browser fallback over `BroadcastChannel`. The lowest peer id in the
 * room acts as host so that a joiner knows whom to ask for the full state.
 */
export class LocalChannel implements CollabChannel {
  readonly localId = shortId(8);
  readonly ready: Promise<void>;
  private bc: BroadcastChannel;
  private known = new Set<string>();
  private msgHandlers = new Set<(from: string, data: unknown) => void>();
  private joinHandlers = new Set<(id: string) => void>();
  private leaveHandlers = new Set<(id: string) => void>();
  private closed = false;

  constructor(readonly roomId: string) {
    this.bc = new BroadcastChannel(`forge-collab-${roomId}`);
    this.bc.onmessage = (ev: MessageEvent<LocalMsg>) => this.onRaw(ev.data);
    this.post({ kind: 'hello', from: this.localId });
    this.ready = new Promise((resolve) => setTimeout(resolve, 350));
    addEventListener('pagehide', () => this.close());
  }

  get isHost(): boolean {
    const all = [this.localId, ...this.known];
    return all.sort()[0] === this.localId;
  }

  private post(m: LocalMsg): void { if (!this.closed) this.bc.postMessage(m); }

  private onRaw(m: LocalMsg): void {
    if (m.from === this.localId) return;
    switch (m.kind) {
      case 'hello':
        this.post({ kind: 'welcome', from: this.localId, peers: [...this.known] });
        this.addPeer(m.from);
        break;
      case 'welcome':
        this.addPeer(m.from);
        for (const p of m.peers ?? []) if (p !== this.localId) this.addPeer(p);
        break;
      case 'bye':
        if (this.known.delete(m.from)) for (const h of this.leaveHandlers) h(m.from);
        break;
      case 'msg': {
        const to = m.to ?? 'all';
        const hostId = [this.localId, ...this.known].sort()[0];
        const mine = to === 'all' || to === 'others' || to === this.localId || (to === 'host' && hostId === this.localId);
        if (mine) for (const h of this.msgHandlers) h(m.from, m.data);
        break;
      }
    }
  }

  private addPeer(id: string): void {
    if (this.known.has(id)) return;
    this.known.add(id);
    for (const h of this.joinHandlers) h(id);
  }

  peers(): string[] { return [...this.known]; }
  send(to: SendTarget, data: object): void { this.post({ kind: 'msg', from: this.localId, to, data }); }
  onMessage(fn: (from: string, data: unknown) => void): () => void { this.msgHandlers.add(fn); return () => this.msgHandlers.delete(fn); }
  onPeerJoin(fn: (id: string) => void): () => void { this.joinHandlers.add(fn); return () => this.joinHandlers.delete(fn); }
  onPeerLeave(fn: (id: string) => void): () => void { this.leaveHandlers.add(fn); return () => this.leaveHandlers.delete(fn); }
  close(): void {
    if (this.closed) return;
    this.post({ kind: 'bye', from: this.localId });
    this.closed = true;
    this.bc.close();
  }
}

/** In-memory channel pair/mesh for tests: every peer sees every other peer's messages synchronously. */
export class MemoryHub {
  private peers = new Map<string, MemoryChannel>();

  join(id: string): MemoryChannel {
    const ch = new MemoryChannel(id, this);
    for (const other of this.peers.values()) { other.notifyJoin(id); ch.notifyJoin(other.localId); }
    this.peers.set(id, ch);
    return ch;
  }

  leave(id: string): void {
    this.peers.delete(id);
    for (const other of this.peers.values()) other.notifyLeave(id);
  }

  deliver(from: string, to: SendTarget, data: object): void {
    const host = [...this.peers.keys()].sort()[0];
    for (const [id, ch] of this.peers) {
      if (id === from) continue;
      if (to === 'all' || to === 'others' || to === id || (to === 'host' && id === host)) ch.receive(from, structuredClone(data));
    }
  }

  hostId(): string { return [...this.peers.keys()].sort()[0]; }
  ids(): string[] { return [...this.peers.keys()]; }
}

export class MemoryChannel implements CollabChannel {
  readonly roomId = 'memory';
  private msgHandlers = new Set<(from: string, data: unknown) => void>();
  private joinHandlers = new Set<(id: string) => void>();
  private leaveHandlers = new Set<(id: string) => void>();
  /** Messages are queued and delivered by `flush()` so tests control ordering. */
  queue: { from: string; data: unknown }[] = [];
  constructor(readonly localId: string, private readonly hub: MemoryHub) {}
  get isHost(): boolean { return this.hub.hostId() === this.localId; }
  peers(): string[] { return this.hub.ids().filter((i) => i !== this.localId); }
  send(to: SendTarget, data: object): void { this.hub.deliver(this.localId, to, data); }
  receive(from: string, data: unknown): void { this.queue.push({ from, data }); }
  flush(): void { const q = this.queue; this.queue = []; for (const m of q) for (const h of this.msgHandlers) h(m.from, m.data); }
  notifyJoin(id: string): void { for (const h of this.joinHandlers) h(id); }
  notifyLeave(id: string): void { for (const h of this.leaveHandlers) h(id); }
  onMessage(fn: (from: string, data: unknown) => void): () => void { this.msgHandlers.add(fn); return () => this.msgHandlers.delete(fn); }
  onPeerJoin(fn: (id: string) => void): () => void { this.joinHandlers.add(fn); return () => this.joinHandlers.delete(fn); }
  onPeerLeave(fn: (id: string) => void): () => void { this.leaveHandlers.add(fn); return () => this.leaveHandlers.delete(fn); }
  close(): void { this.hub.leave(this.localId); }
}
