/** One rung of the quality ladder. */
export interface QualityLevel {
  name: string;
  renderScale: number;
  shadowMapSize: number;
  msaa: number;
  bloom: boolean;
  fxaa: boolean;
}

/** Default ladder from best to cheapest. */
export const DEFAULT_QUALITY_LEVELS: readonly QualityLevel[] = [
  { name: 'ultra', renderScale: 1, shadowMapSize: 2048, msaa: 4, bloom: true, fxaa: true },
  { name: 'high', renderScale: 1, shadowMapSize: 2048, msaa: 2, bloom: true, fxaa: true },
  { name: 'medium', renderScale: 0.85, shadowMapSize: 1024, msaa: 0, bloom: true, fxaa: true },
  { name: 'low', renderScale: 0.7, shadowMapSize: 1024, msaa: 0, bloom: false, fxaa: true },
  { name: 'potato', renderScale: 0.5, shadowMapSize: 512, msaa: 0, bloom: false, fxaa: false },
];

/** Something that can receive a quality level (the WebGL renderer, or a test double). */
export interface QualityTarget {
  applyQuality(level: QualityLevel): void;
}

/**
 * Frame-time driven quality ladder. Feed it frame durations; when the smoothed
 * FPS stays below `lowFps` for `settleTime` seconds it steps down a level, and
 * when it stays above `highFps` for `recoverTime` seconds it steps back up.
 * Pure logic: the renderer applies the level through {@link QualityTarget}.
 */
export class AutoQuality {
  enabled = false;
  /** Step down when the smoothed FPS is below this. */
  lowFps = 45;
  /** Step up when the smoothed FPS is above this. */
  highFps = 58;
  /** Seconds a condition must hold before changing level. */
  settleTime = 1.5;
  recoverTime = 6;
  /** Smoothing factor for the FPS estimate (per sample). */
  smoothing = 0.08;
  levels: readonly QualityLevel[];
  level: number;
  /** Smoothed frames per second. */
  fps = 60;
  private lowTime = 0;
  private highTime = 0;
  private warmup = 1;

  constructor(private readonly target: QualityTarget | null = null, levels: readonly QualityLevel[] = DEFAULT_QUALITY_LEVELS, startLevel = 0) {
    this.levels = levels;
    this.level = Math.min(Math.max(0, startLevel), levels.length - 1);
  }

  get current(): QualityLevel {
    return this.levels[this.level];
  }

  /** Reset timers and (optionally) jump to a level, applying it. */
  setLevel(index: number): void {
    this.level = Math.min(Math.max(0, index), this.levels.length - 1);
    this.lowTime = this.highTime = 0;
    this.target?.applyQuality(this.current);
  }

  /**
   * Record one frame of `dt` seconds. Returns the new level index when the
   * level changed, otherwise -1.
   */
  sample(dt: number): number {
    if (!this.enabled || dt <= 0 || !Number.isFinite(dt)) return -1;
    if (dt > 0.5) return -1; // tab switch / hitch: ignore
    const instant = 1 / dt;
    this.fps += (instant - this.fps) * this.smoothing;
    if (this.warmup > 0) { this.warmup -= dt; return -1; }
    if (this.fps < this.lowFps) { this.lowTime += dt; this.highTime = 0; }
    else if (this.fps > this.highFps) { this.highTime += dt; this.lowTime = 0; }
    else { this.lowTime = Math.max(0, this.lowTime - dt); this.highTime = Math.max(0, this.highTime - dt); }
    if (this.lowTime >= this.settleTime && this.level < this.levels.length - 1) {
      this.setLevel(this.level + 1);
      this.fps = this.highFps; // optimistic: give the new level time to prove itself
      return this.level;
    }
    if (this.highTime >= this.recoverTime && this.level > 0) {
      this.setLevel(this.level - 1);
      this.fps = (this.lowFps + this.highFps) / 2;
      return this.level;
    }
    return -1;
  }
}
