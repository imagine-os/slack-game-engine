import type { ProjectMutation } from '../project/ProjectService';
import type { Mutation } from '../project/SceneEditor';

/** Lamport timestamp with the author's peer id as tie-breaker. */
export interface LamportClock { t: number; peer: string }

/** Operation exchanged between collaborating editors. */
export type CollabOp =
  | { kind: 'scene'; scene: string; mutation: Mutation; clock: LamportClock }
  | { kind: 'project'; mutation: ProjectMutation; clock: LamportClock };

export function compareClocks(a: LamportClock, b: LamportClock): number {
  return a.t - b.t || (a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0);
}

/** Key identifying one replicated field. */
export function fieldKey(scene: string, guid: string, type: string, field: string): string {
  return [scene, guid, type, field].join('|');
}

/**
 * Per-peer Lamport clock plus last-writer-wins registers for fields and
 * whole-file script sources. Structural ops (create/delete/reparent/add/
 * remove) are applied in arrival order; they are idempotent in the
 * SceneEditor so re-delivery is harmless.
 */
export class OpModel {
  private time = 0;
  private fields = new Map<string, LamportClock>();
  private scripts = new Map<string, LamportClock>();
  private settings = new Map<string, LamportClock>();

  constructor(readonly peer: string) {}

  /** Clock for a locally generated op. */
  tick(): LamportClock {
    this.time++;
    return { t: this.time, peer: this.peer };
  }

  /** Merge a received clock (Lamport receive rule). */
  observe(c: LamportClock): void {
    this.time = Math.max(this.time, c.t) + 1;
  }

  /** Record a local op so later remote ops with older clocks lose. */
  recordLocal(op: CollabOp): void {
    this.record(op, op.clock);
  }

  /**
   * Decide whether a remote op should be applied (LWW for field sets, script
   * sources and settings paths; always for structural ops) and record it.
   */
  accept(op: CollabOp): boolean {
    this.observe(op.clock);
    const key = this.registerKey(op);
    if (key) {
      const [map, k] = key;
      const prev = map.get(k);
      if (prev && compareClocks(op.clock, prev) <= 0) return false;
    }
    this.record(op, op.clock);
    return true;
  }

  /** Clock of the last accepted write to a field, if any. */
  fieldClock(scene: string, guid: string, type: string, field: string): LamportClock | undefined {
    return this.fields.get(fieldKey(scene, guid, type, field));
  }

  /** Export registers (host sends them with the full state). */
  export(): { time: number; fields: [string, LamportClock][]; scripts: [string, LamportClock][]; settings: [string, LamportClock][] } {
    return { time: this.time, fields: [...this.fields], scripts: [...this.scripts], settings: [...this.settings] };
  }

  import(data: ReturnType<OpModel['export']>): void {
    this.time = Math.max(this.time, data.time) + 1;
    for (const [k, c] of data.fields) this.fields.set(k, c);
    for (const [k, c] of data.scripts) this.scripts.set(k, c);
    for (const [k, c] of data.settings) this.settings.set(k, c);
  }

  private registerKey(op: CollabOp): [Map<string, LamportClock>, string] | null {
    if (op.kind === 'scene') {
      const m = op.mutation;
      if (m.kind === 'field-set') return [this.fields, fieldKey(op.scene, m.guid, m.type, m.field)];
      if (m.kind === 'entity-rename') return [this.fields, fieldKey(op.scene, m.guid, 'Name', 'name')];
      if (m.kind === 'meta-set') return [this.fields, fieldKey(op.scene, m.guid, '$meta', m.key)];
      return null;
    }
    const m = op.mutation;
    if (m.kind === 'script-set') return [this.scripts, m.name];
    if (m.kind === 'settings-set') return [this.settings, m.path];
    return null;
  }

  private record(op: CollabOp, clock: LamportClock): void {
    const key = this.registerKey(op);
    if (key) key[0].set(key[1], clock);
  }
}
