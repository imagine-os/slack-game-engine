/** Listener signature for {@link EventEmitter}. */
export type Listener<T> = (payload: T) => void;

/** Unsubscribe handle returned by {@link EventEmitter.on}. */
export type Unsubscribe = () => void;

/**
 * Minimal typed event emitter. The type parameter maps event names to payload
 * types, e.g. `EventEmitter<{ tick: number; ready: void }>`.
 */
export class EventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();
  private onceSet = new WeakSet<Listener<never>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(event, fn);
  }

  /** Subscribe for a single emission. */
  once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): Unsubscribe {
    this.onceSet.add(fn as Listener<never>);
    return this.on(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(fn as Listener<never>);
  }

  /** Emit to all listeners. Listeners added during emit run next time. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      if (this.onceSet.has(fn)) {
        set.delete(fn);
        this.onceSet.delete(fn);
      }
      (fn as Listener<Events[K]>)(payload);
    }
  }

  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Remove all listeners for one event or for every event. */
  clear(event?: keyof Events): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }
}
