/** Configuration for {@link Clock}. */
export interface ClockOptions {
  /** Fixed simulation rate in Hz. Default 60. */
  fixedRate?: number;
  /** Cap for a single frame's delta in seconds, to avoid spiral-of-death after tab switches. Default 0.25. */
  maxFrameDelta?: number;
  /** Maximum fixed steps per frame. Default 8. */
  maxSubSteps?: number;
  /** Time scale multiplier. Default 1. */
  timeScale?: number;
}

/**
 * Engine time source. Advances a fixed-step accumulator for deterministic
 * simulation while exposing variable render deltas and an interpolation alpha.
 *
 * Units are seconds unless the name says otherwise.
 */
export class Clock {
  /** Fixed step duration in seconds. */
  fixedDelta: number;
  /** Time scale multiplier applied to incoming frame deltas. */
  timeScale: number;
  /** Variable delta of the current frame (scaled). */
  delta = 0;
  /** Unscaled variable delta of the current frame. */
  unscaledDelta = 0;
  /** Total scaled time since start. */
  elapsed = 0;
  /** Total unscaled time since start. */
  unscaledElapsed = 0;
  /** Number of fixed steps executed so far. Increments deterministically. */
  tick = 0;
  /** Number of render frames since start. */
  frame = 0;
  /** Fraction of a fixed step elapsed since the last fixed update, for interpolation. */
  alpha = 0;
  /** Smoothed frames per second. */
  fps = 0;

  private accumulator = 0;
  private maxFrameDelta: number;
  private maxSubSteps: number;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private lastTimestamp: number | null = null;

  constructor(opts: ClockOptions = {}) {
    this.fixedDelta = 1 / (opts.fixedRate ?? 60);
    this.maxFrameDelta = opts.maxFrameDelta ?? 0.25;
    this.maxSubSteps = opts.maxSubSteps ?? 8;
    this.timeScale = opts.timeScale ?? 1;
  }

  /** Fixed rate in Hz. */
  get fixedRate(): number {
    return 1 / this.fixedDelta;
  }

  set fixedRate(hz: number) {
    this.fixedDelta = 1 / hz;
  }

  /** Reset all counters. */
  reset(): void {
    this.delta = this.unscaledDelta = this.elapsed = this.unscaledElapsed = 0;
    this.tick = this.frame = 0;
    this.alpha = 0;
    this.accumulator = 0;
    this.lastTimestamp = null;
  }

  /**
   * Advance the clock by a wall-clock timestamp in milliseconds (as given by
   * requestAnimationFrame). Returns the number of fixed steps to run this frame.
   */
  advance(timestampMs: number): number {
    if (this.lastTimestamp === null) this.lastTimestamp = timestampMs;
    let dt = (timestampMs - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestampMs;
    if (dt < 0) dt = 0;
    if (dt > this.maxFrameDelta) dt = this.maxFrameDelta;
    return this.advanceBy(dt);
  }

  /** Advance by an explicit unscaled delta in seconds. Returns fixed step count. */
  advanceBy(unscaledDt: number): number {
    this.unscaledDelta = unscaledDt;
    this.delta = unscaledDt * this.timeScale;
    this.unscaledElapsed += unscaledDt;
    this.elapsed += this.delta;
    this.frame++;
    this.accumulator += this.delta;
    let steps = Math.floor(this.accumulator / this.fixedDelta);
    if (steps > this.maxSubSteps) {
      steps = this.maxSubSteps;
      this.accumulator = this.fixedDelta * steps;
    }
    this.fpsAccum += unscaledDt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    return steps;
  }

  /** Consume one fixed step from the accumulator (call once per executed step). */
  consumeFixedStep(): void {
    this.accumulator -= this.fixedDelta;
    this.tick++;
    this.alpha = this.accumulator / this.fixedDelta;
  }

  /** Update interpolation alpha without stepping. */
  updateAlpha(): void {
    this.alpha = this.accumulator / this.fixedDelta;
  }
}
