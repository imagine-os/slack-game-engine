import { EventEmitter } from '../core/EventEmitter';
import type { ConnectOptions, NetPayload, PeerId, SendOptions, SendTarget, Transport, TransportEvents } from './Transport';
import { isBinary, toU8, utf8Decode, utf8Encode } from './wire';
import type { DataConnection, Peer, PeerOptions } from 'peerjs';

/** Extra options for {@link PeerTransport}. */
export interface PeerTransportOptions {
  /**
   * Self-hosted PeerServer URL (`wss://host:9000/peerjs`). Default: the public
   * PeerJS cloud (`0.peerjs.com`), which needs no server of ours.
   */
  serverUrl?: string;
  /** ICE servers. Default: Google STUN. Add a TURN server for strict NATs. */
  iceServers?: RTCIceServer[];
  /** Prefix for the deterministic host id (`forge-<roomId>`). */
  idPrefix?: string;
  /** Connect / claim timeout (ms). Default 10000. */
  timeoutMs?: number;
  /** PeerJS debug level 0..3. Default 0. */
  debug?: 0 | 1 | 2 | 3;
}

/** Control frames exchanged over the reliable channel (in addition to relayed traffic). */
type Frame =
  | { k: 'hello'; id: PeerId; name: string }
  | { k: 'welcome'; host: PeerId; peers: { id: PeerId; name: string }[] }
  | { k: 'join'; id: PeerId; name: string }
  | { k: 'leave'; id: PeerId }
  | { k: 'full' }
  | { k: 'm'; f: PeerId; to: PeerId | 'all'; d: unknown };

interface Link {
  /** Stable transport id of the remote peer. */
  id: PeerId;
  name: string;
  conn: DataConnection;
  /** Negotiated unordered/no-retransmit channel (binary only). */
  fast: RTCDataChannel | null;
  open: boolean;
}

const FAST_CHANNEL_ID = 42;

/**
 * WebRTC data-channel transport in a star topology. The room creator claims
 * the deterministic PeerJS id `forge-<roomId>`; joiners connect to it. If the
 * id is free the joiner becomes host instead. Signalling goes through the
 * public PeerJS cloud by default (no server of ours, works from GitHub Pages)
 * or a self-hosted PeerServer via `serverUrl`.
 *
 * Every peer has a stable transport id independent of its PeerJS id so host
 * migration keeps identities: when the host disappears, clients re-claim
 * `forge-<roomId>` in roster order; the winner hosts, the others rejoin it.
 *
 * Reliable/ordered traffic uses the PeerJS connection; `reliable: false`
 * binary payloads use a negotiated `RTCDataChannel` with `ordered: false,
 * maxRetransmits: 0`. ICE failures surface as `error` events with a hint.
 */
export class PeerTransport implements Transport {
  readonly name = 'peer';
  readonly localId: PeerId;
  isHost = false;
  hostId: PeerId = '';
  roomId = '';
  readonly peers: PeerId[] = [];
  connected = false;

  private events = new EventEmitter<TransportEvents>();
  private peer: Peer | null = null;
  private links = new Map<PeerId, Link>();
  private hostLink: Link | null = null;
  private displayName = '';
  private names = new Map<PeerId, string>();
  private readonly opts: PeerTransportOptions;
  private migrating = false;
  private closedByUs = false;
  private maxPlayers = 64;

  constructor(opts: PeerTransportOptions = {}) {
    this.opts = opts;
    this.localId = 'peer-' + Math.random().toString(36).slice(2, 10);
  }

  static get supported(): boolean {
    return typeof RTCPeerConnection !== 'undefined';
  }

  private hostPeerId(): string {
    return `${this.opts.idPrefix ?? 'forge-'}${this.roomId}`;
  }

  private peerOptions(): PeerOptions {
    const o: PeerOptions = { debug: this.opts.debug ?? 0 };
    if (this.opts.iceServers) o.config = { iceServers: this.opts.iceServers };
    const url = this.opts.serverUrl;
    if (url) {
      const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `wss://${url}`);
      o.host = u.hostname;
      o.secure = u.protocol === 'wss:' || u.protocol === 'https:';
      o.port = u.port ? Number(u.port) : o.secure ? 443 : 80;
      o.path = u.pathname && u.pathname !== '/' ? u.pathname : '/';
    }
    return o;
  }

  // ---------------------------------------------------------------- connect

  async connect(opts: ConnectOptions): Promise<void> {
    if (!PeerTransport.supported) throw new Error('WebRTC is not available in this browser');
    if (this.connected) await this.disconnect();
    this.roomId = opts.roomId;
    this.displayName = opts.displayName ?? this.localId;
    if (typeof opts.maxPlayers === 'number') this.maxPlayers = opts.maxPlayers;
    if (typeof opts.serverUrl === 'string' && opts.serverUrl) this.opts.serverUrl = opts.serverUrl;
    this.closedByUs = false;
    const { Peer: PeerCtor } = await import('peerjs');
    const wantHost = opts.wantHost !== false;
    const claimed = wantHost ? await this.tryClaimHost(PeerCtor) : null;
    if (claimed) {
      this.becomeHost(claimed);
      return;
    }
    await this.joinAsClient(PeerCtor);
  }

  /** Try to register the deterministic host id. Resolves with the Peer when we got it, null when taken. */
  private tryClaimHost(PeerCtor: typeof Peer): Promise<Peer | null> {
    return new Promise((resolve, reject) => {
      const p = new PeerCtor(this.hostPeerId(), this.peerOptions());
      const timer = setTimeout(() => { p.destroy(); reject(new Error('Timed out reaching the signalling server')); }, this.opts.timeoutMs ?? 10000);
      p.on('open', () => { clearTimeout(timer); resolve(p); });
      p.on('error', (err: Error & { type?: string }) => {
        clearTimeout(timer);
        if (err.type === 'unavailable-id') { p.destroy(); resolve(null); return; }
        p.destroy();
        reject(new Error(`Signalling error (${err.type ?? 'unknown'}): ${err.message}`));
      });
    });
  }

  private becomeHost(p: Peer): void {
    this.peer = p;
    this.isHost = true;
    this.hostId = this.localId;
    this.hostLink = null;
    p.on('connection', (conn) => this.acceptConnection(conn));
    p.on('error', (err: Error & { type?: string }) => this.onPeerError(err));
    p.on('disconnected', () => { if (!this.closedByUs) p.reconnect(); });
    if (!this.connected) {
      this.connected = true;
      this.events.emit('connected', { localId: this.localId, isHost: true, roomId: this.roomId, peers: this.peers.slice(), hostId: this.localId });
    } else {
      this.events.emit('host-changed', { hostId: this.localId });
    }
  }

  private joinAsClient(PeerCtor: typeof Peer): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = new PeerCtor(this.peerOptions());
      this.peer = p;
      const timeout = this.opts.timeoutMs ?? 10000;
      let settled = false;
      const fail = (msg: string, fatal = true): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        p.destroy();
        this.peer = null;
        if (!this.connected) reject(new Error(msg));
        else this.events.emit('error', { error: new Error(msg), message: msg, fatal });
      };
      const timer = setTimeout(() => fail(`Timed out connecting to the room host (${this.hostPeerId()})`), timeout);
      p.on('error', (err: Error & { type?: string }) => {
        if (err.type === 'peer-unavailable') fail('The room host is unreachable. Nobody is hosting this room right now.');
        else if (!settled) fail(`Signalling error (${err.type ?? 'unknown'}): ${err.message}`);
        else this.onPeerError(err);
      });
      p.on('open', () => {
        const conn = p.connect(this.hostPeerId(), { reliable: true, serialization: 'binary', metadata: { id: this.localId, name: this.displayName } });
        const link: Link = { id: '', name: '', conn, fast: null, open: false };
        this.wireConnection(link, (welcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          link.id = welcome.host;
          this.hostLink = link;
          this.links.set(link.id, link);
          this.isHost = false;
          this.hostId = welcome.host;
          this.peers.length = 0;
          for (const q of welcome.peers) {
            if (q.id === this.localId || q.id === welcome.host) { this.names.set(q.id, q.name); continue; }
            this.peers.push(q.id);
            this.names.set(q.id, q.name);
          }
          this.names.set(welcome.host, welcome.peers.find((q) => q.id === welcome.host)?.name ?? welcome.host);
          // The host is a peer too (peers = everyone but self).
          if (!this.peers.includes(this.hostId)) this.peers.push(this.hostId);
          if (!this.connected) {
            this.connected = true;
            this.events.emit('connected', { localId: this.localId, isHost: false, roomId: this.roomId, peers: this.peers.slice(), hostId: this.hostId });
            // Surface names for the roster we were handed.
            for (const id of this.peers) this.events.emit('peer-join', { peerId: id, displayName: this.names.get(id) });
          } else {
            this.events.emit('host-changed', { hostId: this.hostId });
          }
          this.migrating = false;
          resolve();
        }, () => fail('Connection to the host closed', false));
        conn.on('open', () => {
          const hello: Frame = { k: 'hello', id: this.localId, name: this.displayName };
          conn.send(hello);
        });
      });
    });
  }

  /** Host side: a client connected. */
  private acceptConnection(conn: DataConnection): void {
    const link: Link = { id: '', name: '', conn, fast: null, open: false };
    this.wireConnection(link, undefined, () => {
      if (!link.id) return;
      this.dropLink(link);
    });
  }

  /** Attach data/close/error handlers to a PeerJS connection and set up the fast channel. */
  private wireConnection(link: Link, onWelcome?: (w: Frame & { k: 'welcome' }) => void, onClose?: () => void): void {
    const conn = link.conn;
    conn.on('open', () => {
      link.open = true;
      this.setupFastChannel(link);
    });
    conn.on('data', (raw: unknown) => this.onData(link, raw, true, onWelcome));
    conn.on('close', () => { link.open = false; onClose?.(); });
    conn.on('error', (err) => this.events.emit('error', { error: err, message: `Data channel error: ${(err as Error).message}` }));
    conn.on('iceStateChanged', (state) => {
      if (state === 'failed') {
        const msg = 'WebRTC connection failed (ICE). The peers cannot reach each other through their NAT/firewall; add a TURN server (iceServers) or use the ws transport.';
        this.events.emit('error', { error: new Error(msg), message: msg, fatal: !this.connected });
      }
    });
  }

  private setupFastChannel(link: Link): void {
    const pc = link.conn.peerConnection;
    if (!pc) return;
    try {
      const ch = pc.createDataChannel('forge-fast', { negotiated: true, id: FAST_CHANNEL_ID, ordered: false, maxRetransmits: 0 });
      ch.binaryType = 'arraybuffer';
      ch.onmessage = (ev) => this.onData(link, ev.data, false);
      ch.onerror = () => { link.fast = null; };
      ch.onclose = () => { if (link.fast === ch) link.fast = null; };
      link.fast = ch;
    } catch {
      link.fast = null; // fall back to the reliable channel
    }
  }

  // ------------------------------------------------------------------- data

  private onData(link: Link, raw: unknown, reliable: boolean, onWelcome?: (w: Frame & { k: 'welcome' }) => void): void {
    if (isBinary(raw)) {
      this.onBinary(link, toU8(raw), reliable);
      return;
    }
    const f = raw as Frame;
    if (!f || typeof f !== 'object') return;
    switch (f.k) {
      case 'hello':
        if (this.isHost) this.onHello(link, f.id, f.name);
        break;
      case 'welcome':
        onWelcome?.(f);
        break;
      case 'join':
        if (!this.isHost && f.id !== this.localId && !this.peers.includes(f.id)) {
          this.peers.push(f.id);
          this.names.set(f.id, f.name);
          this.events.emit('peer-join', { peerId: f.id, displayName: f.name });
        }
        break;
      case 'leave':
        if (!this.isHost) this.removePeer(f.id);
        break;
      case 'full': {
        const msg = 'The room is full.';
        this.events.emit('error', { error: new Error(msg), message: msg, fatal: true });
        break;
      }
      case 'm':
        this.onRelayed(f.f, f.to, f.d as NetPayload, reliable);
        break;
    }
  }

  /** Binary envelope: `[u8 fromLen][from][u8 toLen][to ('' = all)][payload]`. */
  private onBinary(_link: Link, bytes: Uint8Array, reliable: boolean): void {
    if (bytes.length < 2) return;
    const fl = bytes[0];
    const from = utf8Decode(bytes.subarray(1, 1 + fl));
    const tl = bytes[1 + fl];
    const to = tl ? utf8Decode(bytes.subarray(2 + fl, 2 + fl + tl)) : 'all';
    const payload = bytes.subarray(2 + fl + tl);
    if (this.isHost && to !== this.localId) {
      // Relay to the target(s); deliver locally on broadcast.
      if (to === 'all') {
        for (const l of this.links.values()) if (l.id !== from) this.rawSend(l, bytes, reliable);
        this.events.emit('message', { from, data: payload, reliable });
      } else {
        const l = this.links.get(to);
        if (l) this.rawSend(l, bytes, reliable);
      }
      return;
    }
    this.events.emit('message', { from, data: payload, reliable });
  }

  private onRelayed(from: PeerId, to: PeerId | 'all', data: NetPayload, reliable: boolean): void {
    if (this.isHost && to !== this.localId) {
      const frame: Frame = { k: 'm', f: from, to, d: data };
      if (to === 'all') {
        for (const l of this.links.values()) if (l.id !== from && l.open) l.conn.send(frame);
        this.events.emit('message', { from, data, reliable });
      } else {
        const l = this.links.get(to);
        if (l?.open) l.conn.send(frame);
      }
      return;
    }
    this.events.emit('message', { from, data, reliable });
  }

  private onHello(link: Link, id: PeerId, name: string): void {
    if (this.links.size >= this.maxPlayers - 1) {
      const full: Frame = { k: 'full' };
      link.conn.send(full);
      setTimeout(() => link.conn.close(), 100);
      return;
    }
    link.id = id;
    link.name = name;
    this.links.set(id, link);
    this.names.set(id, name);
    const roster = [{ id: this.localId, name: this.displayName }, ...Array.from(this.links.values()).map((l) => ({ id: l.id, name: l.name }))];
    const welcome: Frame = { k: 'welcome', host: this.localId, peers: roster };
    link.conn.send(welcome);
    const join: Frame = { k: 'join', id, name };
    for (const l of this.links.values()) if (l !== link && l.open) l.conn.send(join);
    this.peers.push(id);
    this.events.emit('peer-join', { peerId: id, displayName: name });
  }

  private dropLink(link: Link): void {
    if (!this.links.delete(link.id)) return;
    const leave: Frame = { k: 'leave', id: link.id };
    for (const l of this.links.values()) if (l.open) l.conn.send(leave);
    this.removePeer(link.id);
  }

  private removePeer(id: PeerId): void {
    const i = this.peers.indexOf(id);
    if (i >= 0) this.peers.splice(i, 1);
    this.names.delete(id);
    this.events.emit('peer-leave', { peerId: id });
    if (!this.isHost && id === this.hostId && !this.closedByUs) void this.migrate();
  }

  // -------------------------------------------------------------- migration

  /** Client side: the host vanished. Re-claim the host id in roster order or rejoin the new host. */
  private async migrate(): Promise<void> {
    if (this.migrating) return;
    this.migrating = true;
    const oldHost = this.hostId;
    this.hostLink = null;
    this.links.clear();
    this.peer?.destroy();
    this.peer = null;
    const order = [...this.peers.filter((p) => p !== oldHost), this.localId].sort();
    const rank = Math.max(0, order.indexOf(this.localId));
    await sleep(rank * 700);
    if (this.closedByUs) return;
    try {
      const { Peer: PeerCtor } = await import('peerjs');
      const claimed = await this.tryClaimHost(PeerCtor);
      if (claimed) {
        // Everyone else will rejoin; forget the old roster.
        this.peers.length = 0;
        this.becomeHost(claimed);
        this.migrating = false;
        return;
      }
      await this.joinAsClient(PeerCtor);
    } catch (error) {
      this.migrating = false;
      const msg = `Host migration failed: ${(error as Error).message}`;
      this.events.emit('error', { error, message: msg, fatal: true });
      this.finish('host lost');
    }
  }

  // ------------------------------------------------------------------- send

  send(to: SendTarget, data: NetPayload, opts?: SendOptions): void {
    if (!this.connected) return;
    const reliable = opts?.reliable !== false;
    if (isBinary(data)) {
      const body = toU8(data);
      const from = utf8Encode(this.localId);
      const target = to === 'all' ? new Uint8Array(0) : utf8Encode(to);
      const out = new Uint8Array(2 + from.length + target.length + body.byteLength);
      out[0] = from.length;
      out.set(from, 1);
      out[1 + from.length] = target.length;
      out.set(target, 2 + from.length);
      out.set(body, 2 + from.length + target.length);
      if (this.isHost) {
        if (to === 'all') { for (const l of this.links.values()) this.rawSend(l, out, reliable); }
        else { const l = this.links.get(to); if (l) this.rawSend(l, out, reliable); }
      } else if (this.hostLink) this.rawSend(this.hostLink, out, reliable);
      return;
    }
    const frame: Frame = { k: 'm', f: this.localId, to, d: data };
    if (this.isHost) {
      if (to === 'all') { for (const l of this.links.values()) if (l.open) l.conn.send(frame); }
      else { const l = this.links.get(to); if (l?.open) l.conn.send(frame); }
    } else if (this.hostLink?.open) this.hostLink.conn.send(frame);
  }

  private rawSend(link: Link, bytes: Uint8Array, reliable: boolean): void {
    if (!reliable && link.fast && link.fast.readyState === 'open') {
      try { link.fast.send(bytes as Uint8Array<ArrayBuffer>); return; } catch { /* fall through */ }
    }
    if (link.open) link.conn.send(bytes);
  }

  // ------------------------------------------------------------------- misc

  on<K extends keyof TransportEvents>(event: K, fn: (payload: TransportEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  /** RTT is measured by the hub's presence pings; the transport itself reports 0. */
  rtt(): number {
    return 0;
  }

  async disconnect(): Promise<void> {
    this.closedByUs = true;
    const leave: Frame = { k: 'leave', id: this.localId };
    for (const l of this.links.values()) { try { if (l.open) l.conn.send(leave); } catch { /* ignore */ } }
    await sleep(0);
    this.peer?.destroy();
    this.peer = null;
    this.finish('local');
  }

  private finish(reason: string): void {
    const was = this.connected;
    this.connected = false;
    this.links.clear();
    this.hostLink = null;
    this.peers.length = 0;
    this.isHost = false;
    this.hostId = '';
    this.roomId = '';
    if (was) this.events.emit('disconnected', { reason });
  }

  private onPeerError(err: Error & { type?: string }): void {
    const fatal = err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed';
    this.events.emit('error', { error: err, message: `PeerJS ${err.type ?? 'error'}: ${err.message}`, fatal });
    if (fatal && this.connected && !this.closedByUs) this.finish(err.type ?? 'error');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
