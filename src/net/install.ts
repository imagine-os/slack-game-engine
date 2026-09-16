import type { Engine } from '../core/Engine';
import type { Project } from '../project/types';
import { createTransport, type NetParams } from './createTransport';
import { HostAuthoritativeSync } from './HostAuthoritativeSync';
import { LockstepSync } from './LockstepSync';
import type { NetSync, NetSyncOptions } from './NetSync';
import type { Transport } from './Transport';
import type { NetLobbyOverlay } from './ui/NetLobbyOverlay';

/** Options for {@link installNetworking}. */
export interface InstallNetworkingOptions {
  /** Parsed URL parameters (`parseNetParams(location.search)`). `room` is required. */
  params: NetParams;
  /** Project whose `settings.network` / `settings.multiUser` configure the sync. */
  project?: Project;
  /** Overrides for the sync options (defaults come from the project). */
  sync?: Partial<NetSyncOptions>;
  /** Show the lobby overlay in this element (the player passes its `#app`). Omit for headless use. */
  container?: HTMLElement;
  /** Called when the user chooses "Play offline" or when the connection fails and no lobby is shown. */
  onOffline?: (reason: string) => void;
  /** Pre-built transport (tests, bots). */
  transport?: Transport;
}

/** Result of {@link installNetworking}. */
export interface InstalledNetworking {
  transport: Transport;
  sync: NetSync | null;
  lobby: NetLobbyOverlay | null;
  /** Disconnect, stop the sync and remove the lobby. */
  dispose(): Promise<void>;
}

/** Sync options derived from a project (falls back to defaults). */
export function syncOptionsFor(project?: Project, overrides: Partial<NetSyncOptions> = {}): Partial<NetSyncOptions> {
  const s = project?.settings;
  return {
    mode: s?.network.mode ?? 'host-authoritative',
    tickRate: s?.network.tickRate ?? 20,
    maxPlayers: s?.network.maxPlayers ?? 8,
    sharedControl: s?.multiUser.sharedControl ?? false,
    mergeStrategy: s?.multiUser.mergeStrategy ?? 'average',
    ...overrides,
  };
}

/** Create the sync implementation for a mode (not started). */
export function createSync(engine: Engine, options: Partial<NetSyncOptions>): NetSync | null {
  switch (options.mode ?? 'host-authoritative') {
    case 'none':
      return null;
    case 'lockstep':
      return new LockstepSync(engine, options);
    default:
      return new HostAuthoritativeSync(engine, options);
  }
}

/**
 * One-call multiplayer setup used by the player: create the transport from
 * `params.net`, connect to `params.room`, install the sync for the project's
 * network mode and (optionally) show the {@link NetLobbyOverlay}. Connection
 * failures are reported in the lobby with a "Play offline" fallback instead
 * of throwing, unless no container is given.
 */
export async function installNetworking(engine: Engine, opts: InstallNetworkingOptions): Promise<InstalledNetworking> {
  const { params } = opts;
  const options = syncOptionsFor(opts.project, opts.sync);
  const transport = opts.transport ?? createTransport(params.net, { serverUrl: params.server || undefined });
  engine.net.displayName = params.name || defaultName();
  engine.net.setTransport(transport);

  let lobby: NetLobbyOverlay | null = null;
  let sync: NetSync | null = null;
  const dispose = async (): Promise<void> => {
    lobby?.dispose();
    lobby = null;
    sync?.stop();
    if (engine.net.sync === sync) engine.net.setSync(null);
    await transport.disconnect();
  };
  const goOffline = async (reason: string): Promise<void> => {
    await dispose();
    const { NullTransport } = await import('./NullTransport');
    engine.net.setTransport(new NullTransport());
    await engine.net.transport.connect({ roomId: params.room });
    opts.onOffline?.(reason);
  };

  if (opts.container) {
    const { NetLobbyOverlay } = await import('./ui/NetLobbyOverlay');
    lobby = new NetLobbyOverlay(engine, opts.container, {
      params,
      onPlayOffline: () => { void goOffline('user'); },
      onStart: options.mode === 'lockstep' ? () => (sync as LockstepSync | null)?.begin() : undefined,
    });
    lobby.setConnecting(`Connecting to room ${params.room}…`);
  }

  try {
    await transport.connect({ roomId: params.room, displayName: engine.net.displayName, serverUrl: params.server || undefined, maxPlayers: options.maxPlayers });
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    if (lobby) lobby.setError(message);
    else { await goOffline(message); throw error; }
    return { transport, sync: null, lobby, dispose };
  }

  sync = createSync(engine, options);
  if (sync) {
    engine.net.setSync(sync);
    sync.start();
  }
  lobby?.setConnected();
  if (lobby && options.mode !== 'lockstep') {
    // Collapse the lobby once the game is running so it does not cover the viewport.
    const off = engine.events.on('start', () => { off(); setTimeout(() => lobby?.setCollapsed(true), 2500); });
  }
  return { transport, sync, lobby, dispose };
}

function defaultName(): string {
  const animals = ['Fox', 'Owl', 'Lynx', 'Otter', 'Hawk', 'Wolf', 'Bear', 'Hare', 'Crow', 'Elk'];
  return `${animals[Math.floor(Math.random() * animals.length)]}-${Math.floor(Math.random() * 90 + 10)}`;
}
