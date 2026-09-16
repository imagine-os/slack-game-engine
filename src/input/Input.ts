import { EventEmitter } from '../core/EventEmitter';
import { clamp } from '../core/math';
import { Gamepads, type GamepadButtonName, GAMEPAD_BUTTONS } from './Gamepad';
import { Keyboard } from './Keyboard';
import { Mouse } from './Mouse';
import { Touch, type TouchOverlayOptions } from './Touch';
import { type InputSnapshot, createEmptySnapshot } from './InputSnapshot';

/**
 * Binding string grammar:
 * - Keyboard: any `KeyboardEvent.code` (`"Space"`, `"KeyW"`, `"ArrowLeft"`).
 * - Mouse: `"MouseLeft"`, `"MouseRight"`, `"MouseMiddle"`, `"Mouse<n>"`.
 * - Gamepad: `"Gamepad<Button>"` using {@link GAMEPAD_BUTTONS} names (`"GamepadA"`, `"GamepadDpadUp"`).
 * - Touch overlay button: `"Touch:<name>"`.
 */
export type Binding = string;

/** Axis definition: digital bindings and/or analog sources. */
export interface AxisBinding {
  /** Bindings that push the axis to +1. */
  positive?: Binding[];
  /** Bindings that push the axis to -1. */
  negative?: Binding[];
  /** Gamepad stick axis index (0 leftX, 1 leftY, 2 rightX, 3 rightY). */
  gamepadAxis?: number;
  /** Invert the gamepad axis (browser Y axes point down). */
  invertGamepad?: boolean;
  /** Read the virtual joystick component. */
  touchJoystick?: 'x' | 'y';
  /** Analog triggers: 0 = LT, 1 = RT. */
  gamepadTrigger?: number;
}

export interface InputEvents extends Record<string, unknown> {
  /** An action was pressed this frame. */
  action: { name: string; pressed: boolean };
  /** Devices attached to an element. */
  attached: HTMLElement;
}

/**
 * Unified input: keyboard, mouse, touch and gamepad behind an action mapping
 * layer. Call {@link update} once per frame in the `input` phase and
 * {@link endFrame} after rendering; the Engine does both automatically.
 *
 * ```ts
 * input.bind('jump', ['Space', 'GamepadA', 'Touch:jump']);
 * input.bindAxis('moveX', { negative: ['KeyA', 'ArrowLeft'], positive: ['KeyD', 'ArrowRight'], gamepadAxis: 0, touchJoystick: 'x' });
 * if (input.pressed('jump')) ...
 * ```
 */
export class Input {
  readonly keyboard = new Keyboard();
  readonly mouse = new Mouse();
  readonly touch = new Touch();
  readonly gamepads = new Gamepads();
  readonly events = new EventEmitter<InputEvents>();

  /** When false, action queries return neutral values (e.g. while a menu is open). */
  enabled = true;
  /** Current simulation tick, stamped onto snapshots (set by the Engine). */
  tick = 0;

  private actions = new Map<string, Binding[]>();
  private axes = new Map<string, AxisBinding>();
  private heldNow = new Set<string>();
  private heldPrev = new Set<string>();
  private axisValues = new Map<string, number>();
  private snapshot: InputSnapshot = createEmptySnapshot();
  private element: HTMLElement | null = null;

  /** Attach device listeners to a canvas (keyboard listens on window). */
  attach(element: HTMLElement): void {
    this.element = element;
    if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
    this.keyboard.attach(window);
    this.mouse.attach(element);
    this.touch.attach(element);
    this.events.emit('attached', element);
  }

  detach(): void {
    this.keyboard.detach();
    this.mouse.detach();
    this.touch.detach();
    this.element = null;
  }

  /** Show the mobile joystick/buttons overlay (no-op on non-touch devices unless `autoDetect: false`). */
  enableTouchOverlay(opts?: TouchOverlayOptions): void {
    this.touch.showOverlay(opts);
  }

  // ------------------------------------------------------------- bindings

  /** Bind (replace) the bindings of an action. */
  bind(action: string, bindings: Binding | Binding[]): this {
    this.actions.set(action, Array.isArray(bindings) ? bindings.slice() : [bindings]);
    return this;
  }

  /** Append bindings to an action. */
  addBinding(action: string, ...bindings: Binding[]): this {
    const list = this.actions.get(action) ?? [];
    list.push(...bindings);
    this.actions.set(action, list);
    return this;
  }

  unbind(action: string): this {
    this.actions.delete(action);
    return this;
  }

  bindAxis(name: string, axis: AxisBinding): this {
    this.axes.set(name, { ...axis });
    return this;
  }

  unbindAxis(name: string): this {
    this.axes.delete(name);
    return this;
  }

  /** Names of bound actions (deterministic order for snapshot encoding). */
  actionNames(): string[] {
    return Array.from(this.actions.keys()).sort();
  }

  axisNames(): string[] {
    return Array.from(this.axes.keys()).sort();
  }

  bindingsOf(action: string): readonly Binding[] {
    return this.actions.get(action) ?? [];
  }

  /** Replace all bindings from a plain serializable map (project settings). */
  loadBindings(config: { actions?: Record<string, Binding[]>; axes?: Record<string, AxisBinding> }): this {
    this.actions.clear();
    this.axes.clear();
    for (const [k, v] of Object.entries(config.actions ?? {})) this.bind(k, v);
    for (const [k, v] of Object.entries(config.axes ?? {})) this.bindAxis(k, v);
    return this;
  }

  saveBindings(): { actions: Record<string, Binding[]>; axes: Record<string, AxisBinding> } {
    return {
      actions: Object.fromEntries(Array.from(this.actions.entries()).map(([k, v]) => [k, v.slice()])),
      axes: Object.fromEntries(Array.from(this.axes.entries()).map(([k, v]) => [k, { ...v }])),
    };
  }

  /** Common platformer/top-down defaults: moveX, moveY, jump, fire, action, pause. */
  useDefaultBindings(): this {
    this.bind('jump', ['Space', 'KeyW', 'ArrowUp', 'GamepadA', 'Touch:jump']);
    this.bind('fire', ['MouseLeft', 'KeyJ', 'GamepadX', 'GamepadRT', 'Touch:fire']);
    this.bind('action', ['KeyE', 'Enter', 'GamepadB', 'Touch:action']);
    this.bind('pause', ['Escape', 'GamepadStart']);
    this.bindAxis('moveX', {
      negative: ['KeyA', 'ArrowLeft', 'GamepadDpadLeft'],
      positive: ['KeyD', 'ArrowRight', 'GamepadDpadRight'],
      gamepadAxis: 0,
      touchJoystick: 'x',
    });
    this.bindAxis('moveY', {
      negative: ['KeyS', 'ArrowDown', 'GamepadDpadDown'],
      positive: ['KeyW', 'ArrowUp', 'GamepadDpadUp'],
      gamepadAxis: 1,
      invertGamepad: true,
      touchJoystick: 'y',
    });
    return this;
  }

  // --------------------------------------------------------------- queries

  held(action: string): boolean {
    return this.enabled && this.heldNow.has(action);
  }

  pressed(action: string): boolean {
    return this.enabled && this.heldNow.has(action) && !this.heldPrev.has(action);
  }

  released(action: string): boolean {
    return this.enabled && !this.heldNow.has(action) && this.heldPrev.has(action);
  }

  /** Axis value in -1..1. */
  axis(name: string): number {
    return this.enabled ? (this.axisValues.get(name) ?? 0) : 0;
  }

  /** Raw check whether a single binding is currently active. */
  bindingHeld(b: Binding): boolean {
    if (b.startsWith('Mouse')) {
      const idx = MOUSE_NAMES[b] ?? parseInt(b.slice(5), 10);
      return Number.isFinite(idx) && this.mouse.held(idx);
    }
    if (b.startsWith('Gamepad')) {
      const name = b.slice(7) as GamepadButtonName;
      return (GAMEPAD_BUTTONS as readonly string[]).includes(name) && this.gamepads.held(name);
    }
    if (b.startsWith('Touch:')) return this.touch.held(b.slice(6));
    return this.keyboard.held(b);
  }

  /** Any binding of any kind currently active (for "press any key"). */
  anyHeld(): boolean {
    return this.keyboard.heldCodes().length > 0 || this.mouse.buttons !== 0 || this.touch.touches.length > 0;
  }

  /** The latest per-frame snapshot (built in {@link update}). */
  getSnapshot(): InputSnapshot {
    return this.snapshot;
  }

  // ------------------------------------------------------------- lifecycle

  /** Poll devices and resolve actions/axes. Call once per frame before game logic. */
  update(): void {
    this.gamepads.poll();
    this.mouse.beginFrame();
    const prev = this.heldPrev;
    prev.clear();
    for (const a of this.heldNow) prev.add(a);
    this.heldNow.clear();
    for (const [name, bindings] of this.actions) {
      for (let i = 0; i < bindings.length; i++) {
        if (this.bindingHeld(bindings[i])) {
          this.heldNow.add(name);
          break;
        }
      }
    }
    for (const [name, ax] of this.axes) this.axisValues.set(name, this.resolveAxis(ax));
    this.buildSnapshot();
    if (this.events.listenerCount('action')) {
      for (const a of this.heldNow) if (!prev.has(a)) this.events.emit('action', { name: a, pressed: true });
      for (const a of prev) if (!this.heldNow.has(a)) this.events.emit('action', { name: a, pressed: false });
    }
  }

  /** Clear per-frame edge state on the raw devices. Call after rendering. */
  endFrame(): void {
    this.keyboard.endFrame();
    this.mouse.endFrame();
    this.touch.endFrame();
  }

  private resolveAxis(ax: AxisBinding): number {
    let v = 0;
    if (ax.negative) for (const b of ax.negative) if (this.bindingHeld(b)) { v -= 1; break; }
    if (ax.positive) for (const b of ax.positive) if (this.bindingHeld(b)) { v += 1; break; }
    if (v === 0 && ax.gamepadAxis !== undefined) {
      v = this.gamepads.axis(ax.gamepadAxis);
      if (ax.invertGamepad) v = -v;
    }
    if (v === 0 && ax.gamepadTrigger !== undefined) {
      for (const p of this.gamepads.pads) if (p) v = Math.max(v, p.triggers[ax.gamepadTrigger] ?? 0);
    }
    if (v === 0 && ax.touchJoystick) v = ax.touchJoystick === 'x' ? this.touch.joystick.x : this.touch.joystick.y;
    return clamp(v, -1, 1);
  }

  private buildSnapshot(): void {
    const s = this.snapshot;
    s.tick = this.tick;
    s.held.length = 0;
    s.pressed.length = 0;
    s.released.length = 0;
    for (const a of this.heldNow) {
      s.held.push(a);
      if (!this.heldPrev.has(a)) s.pressed.push(a);
    }
    for (const a of this.heldPrev) if (!this.heldNow.has(a)) s.released.push(a);
    for (const [k, v] of this.axisValues) s.axes[k] = v;
    if (this.element) {
      s.pointer = s.pointer ?? { x: 0, y: 0, buttons: 0 };
      s.pointer.x = this.mouse.worldPosition.x;
      s.pointer.y = this.mouse.worldPosition.y;
      s.pointer.buttons = this.mouse.buttons;
    }
  }
}

const MOUSE_NAMES: Record<string, number> = { MouseLeft: 0, MouseMiddle: 1, MouseRight: 2 };
