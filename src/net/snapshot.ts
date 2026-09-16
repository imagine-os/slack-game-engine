/**
 * World snapshot encoding for host-authoritative sync.
 *
 * Every replicated entity is captured into a compact quantized
 * {@link EntityState} (12 ints + replicated component JSON). Snapshots are
 * encoded as deltas against a baseline the receiver acknowledged: only the
 * field groups that changed (beyond the entity's thresholds) are written,
 * and unchanged entities are skipped entirely. Values are absolute, so a lost
 * delta never corrupts state; the baseline only decides *what* to send.
 *
 * Layout (little endian, after the channel envelope):
 *
 * ```
 * u32 tick · u32 baselineTick (0 = full keyframe) · varint entityCount
 * per entity: varint netId · u8 flags
 *   POS   (1): svarint x,y,z          (1/1000 unit)
 *   ROT   (2): u8 largestIndex · i16 a,b,c   (smallest-three)
 *   SCALE (4): svarint x,y,z          (1/1000)
 *   VEL   (8): svarint vx,vy          (1/100 unit/s)
 *   PROPS (16): u8 count · (string type · string json)*
 * ```
 */
import { ByteReader, ByteWriter, packQuat, quantize } from './wire';

export const POS_STEP = 0.001;
export const SCALE_STEP = 0.001;
export const VEL_STEP = 0.01;

/** Indices into {@link EntityState.ints}. */
export const enum SF {
  PX = 0, PY = 1, PZ = 2,
  QI = 3, QA = 4, QB = 5, QC = 6,
  SX = 7, SY = 8, SZ = 9,
  VX = 10, VY = 11,
  COUNT = 12,
}

/** Field-group flags in the per-entity header. */
export const enum SnapFlag {
  POS = 1,
  ROT = 2,
  SCALE = 4,
  VEL = 8,
  PROPS = 16,
  ALL = 31,
}

/** Quantized replicated state of one entity. */
export interface EntityState {
  netId: number;
  ints: Int32Array;
  /** Component type names for `props` (aligned). */
  propTypes: string[];
  /** JSON of each replicated component's fields. */
  props: string[];
}

/** Map netId → state; one per captured tick. */
export type WorldState = Map<number, EntityState>;

export function newEntityState(netId: number): EntityState {
  return { netId, ints: new Int32Array(SF.COUNT), propTypes: [], props: [] };
}

export function copyEntityState(src: EntityState, dst: EntityState): EntityState {
  dst.netId = src.netId;
  dst.ints.set(src.ints);
  dst.propTypes = src.propTypes.slice();
  dst.props = src.props.slice();
  return dst;
}

/** Fill the transform-derived ints of a state (position/rotation/scale/velocity). */
export function captureTransform(
  s: EntityState,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number },
  scale: { x: number; y: number; z: number },
  velocity: { x: number; y: number } | null,
): void {
  const i = s.ints;
  i[SF.PX] = quantize(position.x, POS_STEP);
  i[SF.PY] = quantize(position.y, POS_STEP);
  i[SF.PZ] = quantize(position.z, POS_STEP);
  packQuat(rotation.x, rotation.y, rotation.z, rotation.w, i, SF.QI);
  i[SF.SX] = quantize(scale.x, SCALE_STEP);
  i[SF.SY] = quantize(scale.y, SCALE_STEP);
  i[SF.SZ] = quantize(scale.z, SCALE_STEP);
  i[SF.VX] = velocity ? quantize(velocity.x, VEL_STEP) : 0;
  i[SF.VY] = velocity ? quantize(velocity.y, VEL_STEP) : 0;
}

/** Per-entity thresholds and which groups to sync (from `NetTransform`). */
export interface EntitySyncPolicy {
  /** Bitmask of groups this entity replicates (SnapFlag). */
  groups: number;
  /** Position change in quantized units below which nothing is sent. */
  posThreshold: number;
  /** Rotation change (in packed i16 units) below which nothing is sent. */
  rotThreshold: number;
}

export const DEFAULT_POLICY: EntitySyncPolicy = { groups: SnapFlag.POS | SnapFlag.ROT | SnapFlag.VEL | SnapFlag.PROPS, posThreshold: 1, rotThreshold: 1 };

function posChanged(a: Int32Array, b: Int32Array, thr: number): boolean {
  return Math.abs(a[SF.PX] - b[SF.PX]) >= thr || Math.abs(a[SF.PY] - b[SF.PY]) >= thr || Math.abs(a[SF.PZ] - b[SF.PZ]) >= thr;
}

function rotChanged(a: Int32Array, b: Int32Array, thr: number): boolean {
  if (a[SF.QI] !== b[SF.QI]) return true;
  return Math.abs(a[SF.QA] - b[SF.QA]) >= thr || Math.abs(a[SF.QB] - b[SF.QB]) >= thr || Math.abs(a[SF.QC] - b[SF.QC]) >= thr;
}

function scaleChanged(a: Int32Array, b: Int32Array): boolean {
  return a[SF.SX] !== b[SF.SX] || a[SF.SY] !== b[SF.SY] || a[SF.SZ] !== b[SF.SZ];
}

function velChanged(a: Int32Array, b: Int32Array): boolean {
  return a[SF.VX] !== b[SF.VX] || a[SF.VY] !== b[SF.VY];
}

/** Compute which groups of `cur` differ from `base` (all groups when `base` is null). */
export function diffFlags(cur: EntityState, base: EntityState | null, policy: EntitySyncPolicy): number {
  if (!base) return policy.groups;
  let flags = 0;
  if (policy.groups & SnapFlag.POS && posChanged(cur.ints, base.ints, policy.posThreshold)) flags |= SnapFlag.POS;
  if (policy.groups & SnapFlag.ROT && rotChanged(cur.ints, base.ints, policy.rotThreshold)) flags |= SnapFlag.ROT;
  if (policy.groups & SnapFlag.SCALE && scaleChanged(cur.ints, base.ints)) flags |= SnapFlag.SCALE;
  if (policy.groups & SnapFlag.VEL && velChanged(cur.ints, base.ints)) flags |= SnapFlag.VEL;
  if (policy.groups & SnapFlag.PROPS && propsChanged(cur, base)) flags |= SnapFlag.PROPS;
  return flags;
}

function propsChanged(cur: EntityState, base: EntityState): boolean {
  if (cur.props.length !== base.props.length) return cur.props.length > 0;
  for (let i = 0; i < cur.props.length; i++) {
    if (cur.propTypes[i] !== base.propTypes[i] || cur.props[i] !== base.props[i]) return true;
  }
  return false;
}

/**
 * Encode a snapshot of `current` relative to `baseline` into `w` (which the
 * caller has reset and may have prefixed with a message type byte).
 * `policyFor` supplies thresholds per netId; `include` can exclude entities
 * (e.g. owner-authority entities for their owner). Returns the entity count.
 */
export function encodeWorldSnapshot(
  w: ByteWriter,
  tick: number,
  baselineTick: number,
  current: WorldState,
  baseline: WorldState | null,
  policyFor: (netId: number) => EntitySyncPolicy,
  include?: (netId: number) => boolean,
): number {
  w.u32(tick).u32(baseline ? baselineTick : 0);
  const countAt = w.offset;
  w.u32(0); // patched below (fixed width so we can back-patch)
  let count = 0;
  for (const cur of current.values()) {
    if (include && !include(cur.netId)) continue;
    const base = baseline?.get(cur.netId) ?? null;
    const policy = policyFor(cur.netId);
    const flags = diffFlags(cur, base, policy);
    if (flags === 0) continue;
    count++;
    w.varint(cur.netId).u8(flags);
    const i = cur.ints;
    if (flags & SnapFlag.POS) w.svarint(i[SF.PX]).svarint(i[SF.PY]).svarint(i[SF.PZ]);
    if (flags & SnapFlag.ROT) w.u8(i[SF.QI]).i16(i[SF.QA]).i16(i[SF.QB]).i16(i[SF.QC]);
    if (flags & SnapFlag.SCALE) w.svarint(i[SF.SX]).svarint(i[SF.SY]).svarint(i[SF.SZ]);
    if (flags & SnapFlag.VEL) w.svarint(i[SF.VX]).svarint(i[SF.VY]);
    if (flags & SnapFlag.PROPS) {
      // Send only components whose JSON changed (all when no baseline).
      let n = 0;
      const nAt = w.offset;
      w.u8(0);
      for (let k = 0; k < cur.props.length; k++) {
        const type = cur.propTypes[k];
        if (base) {
          const bi = base.propTypes.indexOf(type);
          if (bi >= 0 && base.props[bi] === cur.props[k]) continue;
        }
        w.string(type).string(cur.props[k]);
        n++;
      }
      w.view8()[nAt] = n;
    }
  }
  w.patchU32(countAt, count);
  return count;
}

/** Decoded header of a snapshot message. */
export interface SnapshotHeader {
  tick: number;
  baselineTick: number;
  count: number;
}

/** Callback per decoded entity. `ints` is reused between calls; copy what you keep. */
export type SnapshotEntityVisitor = (netId: number, flags: number, ints: Int32Array, propTypes: string[], props: string[]) => void;

const _ints = new Int32Array(SF.COUNT);
const _types: string[] = [];
const _props: string[] = [];

/** Decode a snapshot produced by {@link encodeWorldSnapshot}; visits each entity. */
export function decodeWorldSnapshot(r: ByteReader, visit: SnapshotEntityVisitor, header?: SnapshotHeader): SnapshotHeader {
  const h = header ?? { tick: 0, baselineTick: 0, count: 0 };
  h.tick = r.u32();
  h.baselineTick = r.u32();
  h.count = r.u32();
  for (let e = 0; e < h.count; e++) {
    const netId = r.varint();
    const flags = r.u8();
    const i = _ints;
    if (flags & SnapFlag.POS) { i[SF.PX] = r.svarint(); i[SF.PY] = r.svarint(); i[SF.PZ] = r.svarint(); }
    if (flags & SnapFlag.ROT) { i[SF.QI] = r.u8(); i[SF.QA] = r.i16(); i[SF.QB] = r.i16(); i[SF.QC] = r.i16(); }
    if (flags & SnapFlag.SCALE) { i[SF.SX] = r.svarint(); i[SF.SY] = r.svarint(); i[SF.SZ] = r.svarint(); }
    if (flags & SnapFlag.VEL) { i[SF.VX] = r.svarint(); i[SF.VY] = r.svarint(); }
    _types.length = 0;
    _props.length = 0;
    if (flags & SnapFlag.PROPS) {
      const n = r.u8();
      for (let k = 0; k < n; k++) { _types.push(r.string()); _props.push(r.string()); }
    }
    visit(netId, flags, i, _types, _props);
  }
  return h;
}

/** Ring of past world states so deltas can be computed against acked ticks. */
export class SnapshotHistory {
  private states = new Map<number, WorldState>();
  private order: number[] = [];

  constructor(readonly capacity = 64) {}

  /**
   * Store the state captured at `tick` (takes ownership of the map). Returns
   * the evicted oldest state, if any, so its entries can be recycled.
   */
  push(tick: number, state: WorldState): WorldState | undefined {
    this.states.set(tick, state);
    this.order.push(tick);
    let evicted: WorldState | undefined;
    while (this.order.length > this.capacity) {
      const old = this.order.shift()!;
      evicted = this.states.get(old);
      this.states.delete(old);
    }
    return evicted;
  }

  get(tick: number): WorldState | undefined {
    return this.states.get(tick);
  }

  get latestTick(): number {
    return this.order.length ? this.order[this.order.length - 1] : 0;
  }

  clear(): void {
    this.states.clear();
    this.order.length = 0;
  }
}
