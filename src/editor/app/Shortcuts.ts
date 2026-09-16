import { isTextInputFocused } from '../ui/dom';
import type { ActionRegistry } from './Actions';

/** Canonical form of a key event: `Mod+Shift+Z`, `Delete`, `?`. */
export function keyOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (mac ? e.ctrlKey : e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) {
    // Letters ignore shift for the base key so "Shift+D" works; symbols keep their shifted form.
    if (/[a-z]/i.test(key)) { if (e.shiftKey) parts.push('Shift'); key = key.toUpperCase(); }
  } else if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Normalize a declared shortcut so it compares equal to {@link keyOf} output. */
export function normalizeShortcut(s: string): string {
  const parts = s.split('+');
  const key = parts.pop()!;
  const mods = new Set(parts);
  const out: string[] = [];
  if (mods.has('Mod')) out.push('Mod');
  if (mods.has('Ctrl')) out.push('Ctrl');
  if (mods.has('Alt')) out.push('Alt');
  if (mods.has('Shift')) out.push('Shift');
  out.push(key.length === 1 ? key.toUpperCase() : key);
  return out.join('+');
}

/**
 * Routes window keydown events to registered actions by shortcut. Ignores
 * events from text inputs unless the action is marked `global`.
 */
export class Shortcuts {
  private handler = (e: KeyboardEvent): void => this.onKey(e);
  /** When false nothing is dispatched (e.g. while a modal tour runs). */
  enabled = true;

  constructor(private readonly actions: ActionRegistry) {}

  install(target: Window | HTMLElement = window): () => void {
    target.addEventListener('keydown', this.handler as EventListener);
    return () => target.removeEventListener('keydown', this.handler as EventListener);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.enabled || e.repeat && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') { if (e.repeat) return; }
    const combo = keyOf(e);
    const inText = isTextInputFocused(e.target);
    for (const a of this.actions.all()) {
      if (!a.shortcut) continue;
      const shortcuts = a.shortcut.split(',').map((s) => normalizeShortcut(s.trim()));
      if (!shortcuts.includes(combo)) continue;
      if (inText && !a.global) continue;
      if (!(a.enabled?.() ?? true)) continue;
      e.preventDefault();
      e.stopPropagation();
      void a.run();
      return;
    }
  }
}
