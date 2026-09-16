/**
 * Serializable per-frame input state. This is the unit the networking layer
 * relays from clients to the host; the host applies each remote player's
 * snapshot to the entities that player controls (see `PlayerInput`).
 *
 * Action names are kept as strings for readability; use
 * {@link encodeSnapshot} / {@link decodeSnapshot} with a shared action list to
 * pack into a compact array for the wire.
 */
export interface InputSnapshot {
  /** Simulation tick this snapshot was captured for. */
  tick: number;
  /** Actions currently held. */
  held: string[];
  /** Actions that transitioned to held this frame. */
  pressed: string[];
  /** Actions that transitioned to released this frame. */
  released: string[];
  /** Named axis values in -1..1. */
  axes: Record<string, number>;
  /** Pointer in world units (if a camera resolved it) with a button bitmask. */
  pointer?: { x: number; y: number; buttons: number };
}

/** Compact wire form: `[tick, heldMask, pressedMask, releasedMask, axes[], pointer?]`. */
export type EncodedSnapshot = [number, number, number, number, number[], [number, number, number]?];

export function createEmptySnapshot(tick = 0): InputSnapshot {
  return { tick, held: [], pressed: [], released: [], axes: {} };
}

/** Deep copy a snapshot. */
export function cloneSnapshot(s: InputSnapshot): InputSnapshot {
  return {
    tick: s.tick,
    held: s.held.slice(),
    pressed: s.pressed.slice(),
    released: s.released.slice(),
    axes: { ...s.axes },
    pointer: s.pointer ? { ...s.pointer } : undefined,
  };
}

function mask(names: readonly string[], list: readonly string[]): number {
  let m = 0;
  for (const n of list) {
    const i = names.indexOf(n);
    if (i >= 0 && i < 31) m |= 1 << i;
  }
  return m;
}

function unmask(names: readonly string[], m: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < names.length && i < 31; i++) if (m & (1 << i)) out.push(names[i]);
  return out;
}

/** Pack a snapshot using shared ordered action/axis name lists (max 31 each). */
export function encodeSnapshot(s: InputSnapshot, actions: readonly string[], axes: readonly string[]): EncodedSnapshot {
  const ax = axes.map((a) => Math.round((s.axes[a] ?? 0) * 1000) / 1000);
  const out: EncodedSnapshot = [s.tick, mask(actions, s.held), mask(actions, s.pressed), mask(actions, s.released), ax];
  if (s.pointer) out.push([s.pointer.x, s.pointer.y, s.pointer.buttons]);
  return out;
}

/** Inverse of {@link encodeSnapshot}. */
export function decodeSnapshot(e: EncodedSnapshot, actions: readonly string[], axes: readonly string[]): InputSnapshot {
  const out: InputSnapshot = {
    tick: e[0],
    held: unmask(actions, e[1]),
    pressed: unmask(actions, e[2]),
    released: unmask(actions, e[3]),
    axes: {},
  };
  axes.forEach((a, i) => (out.axes[a] = e[4][i] ?? 0));
  if (e[5]) out.pointer = { x: e[5][0], y: e[5][1], buttons: e[5][2] };
  return out;
}

/** Strategy for merging several users' snapshots into one (shared control). */
export type InputMergeStrategy = 'first-wins' | 'average' | 'additive';

/**
 * Merge multiple snapshots controlling the same entity. Buttons are OR-ed;
 * axes follow the strategy (`additive` sums and clamps, `average` averages,
 * `first-wins` takes the first non-zero contributor).
 */
export function mergeSnapshots(snaps: readonly InputSnapshot[], strategy: InputMergeStrategy = 'average'): InputSnapshot {
  if (snaps.length === 0) return createEmptySnapshot();
  if (snaps.length === 1) return cloneSnapshot(snaps[0]);
  const out = createEmptySnapshot(Math.max(...snaps.map((s) => s.tick)));
  const held = new Set<string>();
  const pressed = new Set<string>();
  const released = new Set<string>();
  const axisSum: Record<string, number> = {};
  const axisCount: Record<string, number> = {};
  for (const s of snaps) {
    s.held.forEach((a) => held.add(a));
    s.pressed.forEach((a) => pressed.add(a));
    s.released.forEach((a) => released.add(a));
    for (const [k, v] of Object.entries(s.axes)) {
      if (strategy === 'first-wins') {
        if (axisSum[k] === undefined || axisSum[k] === 0) axisSum[k] = v;
      } else {
        axisSum[k] = (axisSum[k] ?? 0) + v;
        axisCount[k] = (axisCount[k] ?? 0) + 1;
      }
    }
    if (s.pointer && !out.pointer) out.pointer = { ...s.pointer };
  }
  out.held = [...held];
  out.pressed = [...pressed].filter((a) => !snaps.every((s) => s.held.includes(a) && !s.pressed.includes(a)));
  out.released = [...released].filter((a) => !held.has(a));
  for (const k of Object.keys(axisSum)) {
    let v = axisSum[k];
    if (strategy === 'average') v /= axisCount[k] || 1;
    out.axes[k] = Math.max(-1, Math.min(1, v));
  }
  return out;
}
