import { Vec3, Quat } from '../core/math';
import { Component } from '../core/ecs/Component';
import { registerComponent } from '../core/ecs/Registry';

/** Who may write authoritative state for this entity. */
export type Authority = 'host' | 'owner';

/**
 * Marks an entity as replicated. `netId` is stable across peers and assigned
 * by the host on spawn; `ownerId` is the controlling peer (or `"host"`).
 */
export class NetworkIdentity extends Component {
  static override readonly type = 'NetworkIdentity';
  /** Stable network id (0 = not yet assigned). */
  netId = 0;
  /** Peer id of the owner. */
  ownerId = 'host';
  /** `host`: only the host simulates and sends state. `owner`: the owner sends state, host relays. */
  authority: Authority = 'host';
  /** Prefab name used to spawn this entity on remote peers. */
  prefab = '';
  /** Additional peers that share control (see NetSync input merging). */
  sharedWith: string[] = [];
  /** Replicate at all (false = local-only decoration on a networked entity). */
  replicate = true;
  /**
   * Extra component types on this entity whose serializable fields replicate
   * host → clients (in addition to types registered globally with
   * `markReplicated`). Example: `['Health', 'Score']`.
   */
  syncComponents: string[] = [];
  /** True when this entity was spawned by the sync layer (vs. loaded with the scene). */
  spawned = false;
}
registerComponent(NetworkIdentity, {
  category: 'Networking',
  description: 'Replicated entity identity and ownership.',
  icon: 'globe',
  fields: {
    netId: { type: 'integer', readonly: true },
    authority: { type: 'enum', options: ['host', 'owner'] },
    sharedWith: { type: 'json' },
    syncComponents: { type: 'json', description: 'Component types replicated from the authority.' },
    spawned: { type: 'boolean', transient: true, hidden: true },
  },
});

/**
 * Transform replication settings. The receiving side interpolates between the
 * last two snapshots (`interpolationDelay` ticks behind) and optionally
 * extrapolates with the last velocity.
 */
export class NetTransform extends Component {
  static override readonly type = 'NetTransform';
  syncPosition = true;
  syncRotation = true;
  syncScale = false;
  /** Ticks of buffered delay used for interpolation. */
  interpolationDelay = 2;
  /** Max seconds to extrapolate when snapshots are late (0 = never). */
  extrapolation = 0.1;
  /** Position change below which no update is sent (delta compression threshold). */
  positionThreshold = 0.001;
  rotationThreshold = 0.001;
  /** Snap instead of interpolating when the error exceeds this distance. */
  teleportDistance = 5;

  /** Interpolation targets written by the NetSync implementation. */
  readonly targetPosition = new Vec3();
  readonly targetRotation = new Quat();
  readonly targetVelocity = new Vec3();
  /** Tick of the latest received snapshot. */
  lastTick = 0;
}
registerComponent(NetTransform, {
  category: 'Networking',
  description: 'Interpolated transform replication.',
  icon: 'move',
  fields: {
    targetPosition: { type: 'vec3', transient: true, hidden: true },
    targetRotation: { type: 'quat', transient: true, hidden: true },
    targetVelocity: { type: 'vec3', transient: true, hidden: true },
    lastTick: { type: 'integer', transient: true, hidden: true },
  },
});
