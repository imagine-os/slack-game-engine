/** Raw keyboard state. Keys are identified by `KeyboardEvent.code` (e.g. `"KeyA"`, `"Space"`). */
export class Keyboard {
  private down = new Set<string>();
  private pressedSet = new Set<string>();
  private releasedSet = new Set<string>();
  /** Last printable key typed this frame (for text entry). */
  lastKey = '';
  /** Prevent default browser behaviour for game keys (arrows, space, tab). Default true. */
  preventDefault = true;
  private target: EventTarget | null = null;

  private onDown = (ev: KeyboardEvent): void => {
    if (this.preventDefault && PREVENT.has(ev.code) && !isTextTarget(ev.target)) ev.preventDefault();
    if (isTextTarget(ev.target)) return;
    if (!ev.repeat) this.setDown(ev.code, true);
    if (ev.key.length === 1) this.lastKey = ev.key;
  };

  private onUp = (ev: KeyboardEvent): void => {
    this.setDown(ev.code, false);
  };

  private onBlur = (): void => {
    for (const k of this.down) this.releasedSet.add(k);
    this.down.clear();
  };

  attach(target: EventTarget = window): void {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onDown as EventListener);
    target.addEventListener('keyup', this.onUp as EventListener);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onDown as EventListener);
    this.target.removeEventListener('keyup', this.onUp as EventListener);
    window.removeEventListener('blur', this.onBlur);
    this.target = null;
  }

  /** Programmatically set key state (tests, replays, virtual keyboards). */
  setDown(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) {
        this.down.add(code);
        this.pressedSet.add(code);
      }
    } else if (this.down.has(code)) {
      this.down.delete(code);
      this.releasedSet.add(code);
    }
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedSet.has(code);
  }

  released(code: string): boolean {
    return this.releasedSet.has(code);
  }

  /** Codes currently held. */
  heldCodes(): string[] {
    return Array.from(this.down);
  }

  /** Clear per-frame edges. Call at the end of each frame. */
  endFrame(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.lastKey = '';
  }
}

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

function isTextTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
