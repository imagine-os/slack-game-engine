import { Vec2 } from '../core/math';

/** Mouse button indices. */
export const MouseButton = { Left: 0, Middle: 1, Right: 2 } as const;

/** Raw mouse state relative to an attached canvas. */
export class Mouse {
  /** Position in canvas CSS pixels (top-left origin). */
  readonly position = new Vec2();
  /** Movement since last frame in CSS pixels. */
  readonly delta = new Vec2();
  /** World position, filled in by the active camera each frame. */
  readonly worldPosition = new Vec2();
  /** Wheel delta this frame (positive = scroll down). */
  wheel = 0;
  /** True while the pointer is over the canvas. */
  inside = false;
  /** Bitmask of held buttons. */
  buttons = 0;

  private pressedMask = 0;
  private releasedMask = 0;
  private element: HTMLElement | null = null;
  private lastX = 0;
  private lastY = 0;
  private accDx = 0;
  private accDy = 0;
  private accWheel = 0;

  private onMove = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    this.updatePosition(ev.clientX, ev.clientY);
  };

  private onDown = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    this.updatePosition(ev.clientX, ev.clientY);
    this.setButton(ev.button, true);
    (ev.currentTarget as HTMLElement | null)?.focus?.();
  };

  private onUp = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    this.setButton(ev.button, false);
  };

  private onWheel = (ev: WheelEvent): void => {
    this.accWheel += Math.sign(ev.deltaY) * (ev.deltaMode === 1 ? 40 : 1) * (ev.deltaMode === 0 ? Math.abs(ev.deltaY) / 100 : 1);
    ev.preventDefault();
  };

  private onEnter = (): void => { this.inside = true; };
  private onLeave = (): void => { this.inside = false; };
  private onContext = (ev: Event): void => ev.preventDefault();

  attach(element: HTMLElement): void {
    this.detach();
    this.element = element;
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('pointerenter', this.onEnter);
    element.addEventListener('pointerleave', this.onLeave);
    element.addEventListener('contextmenu', this.onContext);
  }

  detach(): void {
    const el = this.element;
    if (!el) return;
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('pointerenter', this.onEnter);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('contextmenu', this.onContext);
    this.element = null;
  }

  /** Set position from client coordinates (converted to canvas space). */
  updatePosition(clientX: number, clientY: number): void {
    let x = clientX;
    let y = clientY;
    if (this.element) {
      const r = this.element.getBoundingClientRect();
      x = clientX - r.left;
      y = clientY - r.top;
    }
    this.accDx += x - this.lastX;
    this.accDy += y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    this.position.set(x, y);
  }

  setButton(button: number, isDown: boolean): void {
    const bit = 1 << button;
    if (isDown) {
      if (!(this.buttons & bit)) this.pressedMask |= bit;
      this.buttons |= bit;
    } else {
      if (this.buttons & bit) this.releasedMask |= bit;
      this.buttons &= ~bit;
    }
  }

  held(button: number): boolean {
    return (this.buttons & (1 << button)) !== 0;
  }

  pressed(button: number): boolean {
    return (this.pressedMask & (1 << button)) !== 0;
  }

  released(button: number): boolean {
    return (this.releasedMask & (1 << button)) !== 0;
  }

  /** Latch accumulated deltas into per-frame values. Call at frame start. */
  beginFrame(): void {
    this.delta.set(this.accDx, this.accDy);
    this.wheel = this.accWheel;
    this.accDx = this.accDy = this.accWheel = 0;
  }

  endFrame(): void {
    this.pressedMask = 0;
    this.releasedMask = 0;
  }
}
