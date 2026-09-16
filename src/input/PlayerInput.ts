import { Component } from '../core/ecs/Component';
import { registerComponent } from '../core/ecs/Registry';
import { type InputSnapshot, createEmptySnapshot } from './InputSnapshot';

/**
 * Attaches a player's input to an entity. `owner` is the peer id controlling
 * this entity (`"local"` for the local player in single-player). The network
 * layer writes remote peers' snapshots into `snapshot`; scripts read it via
 * `onOwnerInput` or the accessors below so the same code drives local and
 * remote players.
 */
export class PlayerInput extends Component {
  static override readonly type = 'PlayerInput';

  /** Peer id that controls this entity. */
  owner = 'local';
  /** Additional peers that share control (see NetSync shared-control merging). */
  coOwners: string[] = [];
  /** Merge strategy used when several peers control this entity. */
  mergeStrategy: 'first-wins' | 'average' | 'additive' = 'average';
  /** Latest snapshot applied to this entity. */
  snapshot: InputSnapshot = createEmptySnapshot();
  /** True when the snapshot has been updated since the last fixed step. */
  fresh = false;

  held(action: string): boolean {
    return this.snapshot.held.includes(action);
  }

  pressed(action: string): boolean {
    return this.snapshot.pressed.includes(action);
  }

  released(action: string): boolean {
    return this.snapshot.released.includes(action);
  }

  axis(name: string): number {
    return this.snapshot.axes[name] ?? 0;
  }

  /** Replace the snapshot (deep copy) and mark it fresh. */
  apply(s: InputSnapshot): void {
    this.snapshot.tick = s.tick;
    this.snapshot.held = s.held.slice();
    this.snapshot.pressed = s.pressed.slice();
    this.snapshot.released = s.released.slice();
    this.snapshot.axes = { ...s.axes };
    this.snapshot.pointer = s.pointer ? { ...s.pointer } : undefined;
    this.fresh = true;
  }
}

registerComponent(PlayerInput, {
  category: 'Input',
  description: 'Binds a peer\'s input snapshot to this entity.',
  icon: 'gamepad',
  fields: {
    owner: { type: 'string', description: 'Peer id; "local" for the local player.' },
    coOwners: { type: 'json' },
    mergeStrategy: { type: 'enum', options: ['first-wins', 'average', 'additive'] },
    snapshot: { type: 'json', transient: true, hidden: true },
    fresh: { type: 'boolean', transient: true, hidden: true },
  },
});
