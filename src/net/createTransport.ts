import { LocalTransport, type LocalTransportOptions } from './LocalTransport';
import { MemoryNetwork, type MemoryNetworkOptions } from './MemoryTransport';
import type { TransportKind } from './NetHub';
import { NullTransport } from './NullTransport';
import { PeerTransport, type PeerTransportOptions } from './PeerTransport';
import type { Transport } from './Transport';
import { WebSocketTransport, type WebSocketTransportOptions } from './WebSocketTransport';

/** Options accepted by {@link createTransport}; the union of every transport's extras. */
export interface CreateTransportOptions extends LocalTransportOptions, PeerTransportOptions, WebSocketTransportOptions, MemoryNetworkOptions {
  /** For `memory`: share one network between several transports (default: a fresh network). */
  network?: MemoryNetwork;
  /** Anything else is passed through to the transport. */
  [key: string]: unknown;
}

/** Shared network used by `createTransport('memory')` calls that do not pass one (bots in the same tab). */
let sharedMemoryNetwork: MemoryNetwork | null = null;

/**
 * Build a transport by kind:
 * - `local`: BroadcastChannel between tabs of the same browser (no server).
 * - `peer`: WebRTC data channels with PeerJS signalling (default; no server of ours).
 * - `ws`: our relay server (`server/index.js`), `serverUrl` or `?server=`.
 * - `memory`: in-process (tests, bots).
 * - `null`: offline.
 */
export function createTransport(kind: TransportKind | string, opts: CreateTransportOptions = {}): Transport {
  switch (kind) {
    case 'local':
      return new LocalTransport(opts);
    case 'peer':
    case 'webrtc':
      return new PeerTransport(opts);
    case 'ws':
    case 'websocket':
      return new WebSocketTransport(opts);
    case 'memory': {
      const net = opts.network ?? (sharedMemoryNetwork ??= new MemoryNetwork({ ...opts, autoFlush: opts.autoFlush ?? true }));
      return net.createTransport();
    }
    case 'null':
    case 'none':
      return new NullTransport();
    default:
      throw new Error(`Unknown transport kind "${kind}" (expected local, peer, ws, memory)`);
  }
}

/** Networking parameters parsed from a page URL. */
export interface NetParams {
  /** Room id (`?room=`), empty when absent. */
  room: string;
  /** Transport kind (`?net=`), default `peer`. */
  net: TransportKind;
  /** Relay/signalling server override (`?server=`). */
  server: string;
  /** Display name (`?name=`). */
  name: string;
}

/**
 * Parse `room`, `net`, `server` and `name` from a query string. Unknown
 * transports fall back to `peer`. Pass `location.search`.
 */
export function parseNetParams(search: string): NetParams {
  const q = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const netRaw = (q.get('net') ?? 'peer').toLowerCase();
  const net: TransportKind = netRaw === 'local' || netRaw === 'ws' || netRaw === 'memory' || netRaw === 'null' ? netRaw : netRaw === 'websocket' ? 'ws' : 'peer';
  return {
    room: (q.get('room') ?? '').trim(),
    net,
    server: q.get('server') ?? '',
    name: (q.get('name') ?? '').trim(),
  };
}

/**
 * Build a shareable invite URL: the current page with `room`, the transport
 * (`net=` is written whenever it is not the default, and an explicit `net=`
 * already in the page URL is kept) and `server` when set. The personal
 * `name` is dropped so the invitee picks their own.
 */
export function inviteUrl(params: NetParams, base: string = typeof location !== 'undefined' ? location.href : ''): string {
  const url = new URL(base || 'http://localhost/play.html');
  url.searchParams.set('room', params.room);
  if (params.net !== 'peer') url.searchParams.set('net', params.net);
  if (params.server) url.searchParams.set('server', params.server);
  url.searchParams.delete('name');
  return url.toString();
}

/** The current page with a different transport (`?net=`), same room and name. */
export function switchTransportUrl(net: TransportKind, base: string = typeof location !== 'undefined' ? location.href : ''): string {
  const url = new URL(base || 'http://localhost/play.html');
  url.searchParams.set('net', net);
  if (net !== 'ws') url.searchParams.delete('server');
  return url.toString();
}

/** Short, human-friendly room code (6 chars, no ambiguous letters). */
export function randomRoomCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
