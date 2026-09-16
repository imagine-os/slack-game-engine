/** Standard-mapping gamepad button names, indexed by `Gamepad.buttons` order. */
export const GAMEPAD_BUTTONS = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'DpadUp', 'DpadDown', 'DpadLeft', 'DpadRight', 'Home',
] as const;

export type GamepadButtonName = (typeof GAMEPAD_BUTTONS)[number];

/** Snapshot of one gamepad. */
export interface GamepadState {
  index: number;
  id: string;
  connected: boolean;
  buttons: boolean[];
  /** Analog trigger values (LT/RT) 0..1. */
  triggers: [number, number];
  /** Axes with deadzone applied: [leftX, leftY, rightX, rightY]. */
  axes: number[];
}

/**
 * Polls connected gamepads (standard mapping). Buttons are exposed by name and
 * axes have a radial deadzone applied.
 */
export class Gamepads {
  /** Radial deadzone applied to sticks. */
  deadzone = 0.15;
  /** Per-pad state, indexed by gamepad index. */
  readonly pads: (GamepadState | null)[] = [];
  private prevButtons: boolean[][] = [];

  /** Poll the browser Gamepad API. Call once per frame. */
  poll(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const list = navigator.getGamepads();
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (!gp) {
        this.pads[i] = null;
        continue;
      }
      let state = this.pads[i];
      if (!state) {
        state = { index: i, id: gp.id, connected: true, buttons: [], triggers: [0, 0], axes: [0, 0, 0, 0] };
        this.pads[i] = state;
      }
      this.prevButtons[i] = state.buttons.slice();
      state.connected = gp.connected;
      for (let b = 0; b < gp.buttons.length; b++) state.buttons[b] = gp.buttons[b].pressed;
      state.triggers[0] = gp.buttons[6]?.value ?? 0;
      state.triggers[1] = gp.buttons[7]?.value ?? 0;
      for (let a = 0; a < 4; a++) state.axes[a] = gp.axes[a] ?? 0;
      applyDeadzone(state.axes, 0, this.deadzone);
      applyDeadzone(state.axes, 2, this.deadzone);
    }
  }

  /** Programmatic state (tests). */
  setPad(index: number, state: GamepadState | null): void {
    this.prevButtons[index] = this.pads[index]?.buttons.slice() ?? [];
    this.pads[index] = state;
  }

  /** Is any connected pad holding the named button? `pad` restricts to one index. */
  held(name: GamepadButtonName, pad = -1): boolean {
    const idx = GAMEPAD_BUTTONS.indexOf(name);
    return this.anyPad(pad, (p) => p.buttons[idx] === true);
  }

  pressed(name: GamepadButtonName, pad = -1): boolean {
    const idx = GAMEPAD_BUTTONS.indexOf(name);
    return this.anyPad(pad, (p) => p.buttons[idx] === true && this.prevButtons[p.index]?.[idx] !== true);
  }

  released(name: GamepadButtonName, pad = -1): boolean {
    const idx = GAMEPAD_BUTTONS.indexOf(name);
    return this.anyPad(pad, (p) => p.buttons[idx] !== true && this.prevButtons[p.index]?.[idx] === true);
  }

  /** Axis value (0 = leftX, 1 = leftY, 2 = rightX, 3 = rightY) from the first pad with a non-zero value. */
  axis(index: number, pad = -1): number {
    let best = 0;
    for (const p of this.pads) {
      if (!p || (pad >= 0 && p.index !== pad)) continue;
      const v = p.axes[index] ?? 0;
      if (Math.abs(v) > Math.abs(best)) best = v;
    }
    return best;
  }

  /** Number of connected pads. */
  get count(): number {
    return this.pads.filter((p) => p?.connected).length;
  }

  private anyPad(pad: number, fn: (p: GamepadState) => boolean): boolean {
    for (const p of this.pads) if (p && p.connected && (pad < 0 || p.index === pad) && fn(p)) return true;
    return false;
  }
}

function applyDeadzone(axes: number[], offset: number, dz: number): void {
  const x = axes[offset];
  const y = axes[offset + 1];
  const len = Math.hypot(x, y);
  if (len < dz) {
    axes[offset] = 0;
    axes[offset + 1] = 0;
    return;
  }
  const scale = Math.min(1, (len - dz) / (1 - dz)) / len;
  axes[offset] = x * scale;
  axes[offset + 1] = y * scale;
}
