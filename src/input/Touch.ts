import { Vec2 } from '../core/math';

/** One active touch point in canvas CSS pixels. */
export interface TouchPoint {
  id: number;
  position: Vec2;
  start: Vec2;
  delta: Vec2;
  startTime: number;
}

/** Configuration for the mobile overlay. */
export interface TouchOverlayOptions {
  /** Show a virtual joystick on the left half. Feeds `joystick` (x/y in -1..1). */
  joystick?: boolean;
  /** Joystick radius in CSS px. Default 60. */
  joystickRadius?: number;
  /** Virtual buttons rendered on the right; each becomes a binding `Touch:<name>`. */
  buttons?: { name: string; label?: string }[];
  /** Only show when a touch-capable device is detected. Default true. */
  autoDetect?: boolean;
}

/**
 * Multi-touch tracking with an optional DOM overlay providing a virtual
 * joystick and buttons for mobile play. Virtual buttons are read via
 * {@link held} / {@link pressed} using their configured name.
 */
export class Touch {
  readonly touches: TouchPoint[] = [];
  /** Virtual joystick vector (-1..1), zero when idle. */
  readonly joystick = new Vec2();
  /** True when the overlay is showing. */
  overlayVisible = false;
  /** Canvas position of the most recent touch start/move (taps end before a frame can see them). */
  readonly lastPosition = new Vec2();

  private element: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private joystickBase: HTMLElement | null = null;
  private joystickKnob: HTMLElement | null = null;
  private joystickTouchId: number | null = null;
  private joystickCenter = new Vec2();
  private joystickRadius = 60;
  private buttonState = new Map<string, boolean>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  private tapCount = 0;

  private onStart = (ev: TouchEvent): void => {
    ev.preventDefault();
    const r = this.element!.getBoundingClientRect();
    for (const t of Array.from(ev.changedTouches)) {
      const p = new Vec2(t.clientX - r.left, t.clientY - r.top);
      this.lastPosition.copy(p);
      this.touches.push({ id: t.identifier, position: p, start: p.clone(), delta: new Vec2(), startTime: performance.now() });
      if (this.overlayVisible && this.joystickBase && this.joystickTouchId === null && p.x < r.width / 2) {
        this.joystickTouchId = t.identifier;
        this.joystickCenter.copy(p);
        this.positionJoystick(p.x, p.y, 0, 0);
      }
    }
    this.tapCount++;
  };

  private onMove = (ev: TouchEvent): void => {
    ev.preventDefault();
    const r = this.element!.getBoundingClientRect();
    for (const t of Array.from(ev.changedTouches)) {
      const tp = this.touches.find((x) => x.id === t.identifier);
      if (!tp) continue;
      const nx = t.clientX - r.left;
      const ny = t.clientY - r.top;
      tp.delta.set(nx - tp.position.x, ny - tp.position.y);
      tp.position.set(nx, ny);
      this.lastPosition.set(nx, ny);
      if (t.identifier === this.joystickTouchId) {
        const dx = nx - this.joystickCenter.x;
        const dy = ny - this.joystickCenter.y;
        const len = Math.hypot(dx, dy);
        const s = len > this.joystickRadius ? this.joystickRadius / len : 1;
        this.joystick.set((dx * s) / this.joystickRadius, (-dy * s) / this.joystickRadius);
        this.positionJoystick(this.joystickCenter.x, this.joystickCenter.y, dx * s, dy * s);
      }
    }
  };

  private onEnd = (ev: TouchEvent): void => {
    ev.preventDefault();
    for (const t of Array.from(ev.changedTouches)) {
      const i = this.touches.findIndex((x) => x.id === t.identifier);
      if (i >= 0) this.touches.splice(i, 1);
      if (t.identifier === this.joystickTouchId) {
        this.joystickTouchId = null;
        this.joystick.set(0, 0);
        if (this.joystickBase) this.joystickBase.style.opacity = '0.35';
      }
    }
  };

  attach(element: HTMLElement): void {
    this.detach();
    this.element = element;
    element.style.touchAction = 'none';
    element.addEventListener('touchstart', this.onStart, { passive: false });
    element.addEventListener('touchmove', this.onMove, { passive: false });
    element.addEventListener('touchend', this.onEnd, { passive: false });
    element.addEventListener('touchcancel', this.onEnd, { passive: false });
  }

  detach(): void {
    this.hideOverlay();
    const el = this.element;
    if (!el) return;
    el.removeEventListener('touchstart', this.onStart);
    el.removeEventListener('touchmove', this.onMove);
    el.removeEventListener('touchend', this.onEnd);
    el.removeEventListener('touchcancel', this.onEnd);
    this.element = null;
  }

  /** Is this a touch-capable device? */
  static isTouchDevice(): boolean {
    return typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  }

  /** Show the virtual joystick / buttons overlay inside the canvas parent. */
  showOverlay(opts: TouchOverlayOptions = {}): void {
    if (!this.element || this.overlay) return;
    if (opts.autoDetect !== false && !Touch.isTouchDevice()) return;
    const parent = this.element.parentElement ?? document.body;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    const ov = document.createElement('div');
    ov.className = 'forge-touch-overlay';
    ov.style.cssText = 'position:absolute;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;z-index:10;';
    this.joystickRadius = opts.joystickRadius ?? 60;
    if (opts.joystick !== false) {
      const base = document.createElement('div');
      const R = this.joystickRadius;
      base.style.cssText = `position:absolute;width:${R * 2}px;height:${R * 2}px;border-radius:50%;background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.35);left:40px;bottom:40px;opacity:0.35;`;
      const knob = document.createElement('div');
      knob.style.cssText = `position:absolute;width:${R}px;height:${R}px;border-radius:50%;background:rgba(255,255,255,0.6);left:${R / 2}px;top:${R / 2}px;`;
      base.appendChild(knob);
      ov.appendChild(base);
      this.joystickBase = base;
      this.joystickKnob = knob;
    }
    for (const [i, b] of (opts.buttons ?? []).entries()) {
      const btn = document.createElement('div');
      btn.textContent = b.label ?? b.name;
      btn.style.cssText = `position:absolute;right:${30 + (i % 2) * 90}px;bottom:${40 + Math.floor(i / 2) * 90}px;width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.4);color:#fff;font:600 14px system-ui;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;`;
      const down = (ev: Event) => { ev.preventDefault(); this.setButton(b.name, true); btn.style.background = 'rgba(255,255,255,0.45)'; };
      const up = (ev: Event) => { ev.preventDefault(); this.setButton(b.name, false); btn.style.background = 'rgba(255,255,255,0.15)'; };
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up, { passive: false });
      ov.appendChild(btn);
    }
    parent.appendChild(ov);
    this.overlay = ov;
    this.overlayVisible = true;
  }

  hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = this.joystickBase = this.joystickKnob = null;
    this.overlayVisible = false;
  }

  /** Programmatically set a virtual button. */
  setButton(name: string, isDown: boolean): void {
    const was = this.buttonState.get(name) === true;
    if (isDown && !was) this.pressedSet.add(name);
    if (!isDown && was) this.releasedSet.add(name);
    this.buttonState.set(name, isDown);
  }

  held(name: string): boolean {
    return this.buttonState.get(name) === true;
  }

  pressed(name: string): boolean {
    return this.pressedSet.has(name);
  }

  released(name: string): boolean {
    return this.releasedSet.has(name);
  }

  /** Number of touch starts since the last frame (for "tap anywhere" logic). */
  get taps(): number {
    return this.tapCount;
  }

  endFrame(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.tapCount = 0;
    for (const t of this.touches) t.delta.set(0, 0);
  }

  private positionJoystick(cx: number, cy: number, dx: number, dy: number): void {
    if (!this.joystickBase || !this.joystickKnob) return;
    const R = this.joystickRadius;
    this.joystickBase.style.left = `${cx - R}px`;
    this.joystickBase.style.top = `${cy - R}px`;
    this.joystickBase.style.bottom = 'auto';
    this.joystickBase.style.opacity = '0.8';
    this.joystickKnob.style.left = `${R / 2 + dx}px`;
    this.joystickKnob.style.top = `${R / 2 + dy}px`;
  }
}
