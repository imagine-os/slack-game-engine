import { EventEmitter } from '../core/EventEmitter';
import { clamp, type Vec2Like } from '../core/math';
import type { Random } from '../core/math';

export type AudioBus = 'master' | 'sfx' | 'music';

export interface PlayOptions {
  volume?: number;
  /** Playback rate multiplier. Default 1. */
  pitch?: number;
  /** Random +/- variation applied to pitch (e.g. 0.1 = 10%). */
  pitchVariation?: number;
  /** Random +/- variation applied to volume. */
  volumeVariation?: number;
  loop?: boolean;
  /** World position for 2D spatialisation; omit for non-positional. */
  position?: Vec2Like;
  /** Distance at which the sound is fully attenuated. Default `AudioEngine.maxDistance`. */
  maxDistance?: number;
  bus?: AudioBus;
  /** Start offset in seconds. */
  offset?: number;
}

export interface AudioEvents extends Record<string, unknown> {
  unlocked: void;
  musicChanged: string | null;
}

/** Handle to a playing sound. */
export class SoundHandle {
  /** @internal */
  constructor(
    private readonly engine: AudioEngine,
    readonly source: AudioBufferSourceNode,
    readonly gain: GainNode,
    readonly panner: StereoPannerNode | null,
    private opts: PlayOptions,
  ) {
    this.position = opts.position ? { ...opts.position } : null;
    source.onended = () => {
      this.playing = false;
      engine._release(this);
    };
  }

  playing = true;
  /** World position for positional sounds; update and call `refresh()` per frame if the source moves. */
  position: Vec2Like | null = null;

  setVolume(v: number): void {
    this.opts.volume = v;
    this.refresh();
  }

  setPitch(rate: number): void {
    this.source.playbackRate.value = rate;
  }

  /** Recompute spatial gain/pan from the current listener. */
  refresh(): void {
    this.engine._spatialize(this);
  }

  /** Stop, optionally fading out over `fade` seconds. */
  stop(fade = 0): void {
    if (!this.playing) return;
    const ctx = this.engine.context;
    if (fade > 0 && ctx) {
      this.gain.gain.setValueAtTime(this.gain.gain.value, ctx.currentTime);
      this.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      this.source.stop(ctx.currentTime + fade);
    } else {
      try { this.source.stop(); } catch { /* already stopped */ }
    }
  }

  /** @internal */
  get options(): PlayOptions {
    return this.opts;
  }
}

/**
 * WebAudio wrapper with master/sfx/music buses, one-shot sfx with pitch and
 * volume variation, cross-fading music and simple 2D positional audio (gain
 * + stereo pan relative to a listener). The AudioContext is created lazily
 * and resumed on the first user gesture via {@link unlockOnGesture}.
 */
export class AudioEngine {
  readonly events = new EventEmitter<AudioEvents>();
  /** Default max hearing distance in world units. */
  maxDistance = 20;
  /** Distance below which positional sounds play at full volume. */
  refDistance = 2;
  /** Listener position in world units. */
  readonly listener: { x: number; y: number } = { x: 0, y: 0 };

  private ctx: AudioContext | null = null;
  private buses: Record<AudioBus, GainNode> | null = null;
  private busVolumes: Record<AudioBus, number> = { master: 1, sfx: 1, music: 0.8 };
  private muted = false;
  private active = new Set<SoundHandle>();
  private music: SoundHandle | null = null;
  private musicId: string | null = null;
  private gestureTargets: EventTarget[] = [];
  private random: Random | null;

  constructor(random: Random | null = null) {
    this.random = random;
  }

  /** The underlying context (null until first use / unlock). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** True when audio can play. */
  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Create the context now (may stay suspended until a gesture). */
  init(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    const master = this.ctx.createGain();
    const sfx = this.ctx.createGain();
    const music = this.ctx.createGain();
    sfx.connect(master);
    music.connect(master);
    master.connect(this.ctx.destination);
    this.buses = { master, sfx, music };
    this.applyVolumes();
    return this.ctx;
  }

  /** Resume the context on the next pointer/key gesture on the targets (default: window). */
  unlockOnGesture(...targets: EventTarget[]): void {
    if (typeof window === 'undefined') return;
    if (targets.length === 0) targets = [window];
    const handler = () => {
      void this.unlock();
    };
    for (const t of targets) {
      for (const ev of GESTURES) t.addEventListener(ev, handler, { once: true, passive: true });
      this.gestureTargets.push(t);
    }
  }

  /** Attempt to create and resume the context. Safe to call repeatedly. */
  async unlock(): Promise<boolean> {
    const ctx = this.init();
    if (!ctx) return false;
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch { return false; }
    }
    if (ctx.state === 'running') this.events.emit('unlocked', undefined);
    return ctx.state === 'running';
  }

  /** Decode compressed audio data. */
  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.init();
    if (!ctx) throw new Error('WebAudio is not available');
    return ctx.decodeAudioData(data.slice(0));
  }

  setBusVolume(bus: AudioBus, volume: number): void {
    this.busVolumes[bus] = clamp(volume, 0, 1);
    this.applyVolumes();
  }

  getBusVolume(bus: AudioBus): number {
    return this.busVolumes[bus];
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Set the 2D listener position (usually the camera). Re-spatialises active positional sounds. */
  setListener(x: number, y: number): void {
    this.listener.x = x;
    this.listener.y = y;
    for (const h of this.active) if (h.position) this._spatialize(h);
  }

  /** Play a one-shot (or looping) sound. Returns null when audio is unavailable. */
  play(buffer: AudioBuffer, opts: PlayOptions = {}): SoundHandle | null {
    const ctx = this.init();
    if (!ctx || !this.buses) return null;
    const bus = this.buses[opts.bus ?? 'sfx'];
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = opts.loop ?? false;
    const rnd = () => (this.random ? this.random.next() : Math.random()) * 2 - 1;
    const pitch = (opts.pitch ?? 1) * (1 + (opts.pitchVariation ?? 0) * rnd());
    src.playbackRate.value = Math.max(0.01, pitch);
    const gain = ctx.createGain();
    let panner: StereoPannerNode | null = null;
    if (opts.position && typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      src.connect(panner).connect(gain);
    } else src.connect(gain);
    gain.connect(bus);
    const volume = (opts.volume ?? 1) * (1 + (opts.volumeVariation ?? 0) * rnd());
    const handle = new SoundHandle(this, src, gain, panner, { ...opts, volume: clamp(volume, 0, 2), pitch });
    this._spatialize(handle);
    this.active.add(handle);
    src.start(0, opts.offset ?? 0);
    return handle;
  }

  /** Play or cross-fade to a music track. Passing the same `id` again is a no-op. */
  playMusic(buffer: AudioBuffer, id: string, opts: { fade?: number; volume?: number; loop?: boolean } = {}): SoundHandle | null {
    if (this.musicId === id && this.music?.playing) return this.music;
    const fade = opts.fade ?? 1;
    const prev = this.music;
    const handle = this.play(buffer, { bus: 'music', loop: opts.loop ?? true, volume: opts.volume ?? 1 });
    if (!handle) return null;
    const ctx = this.ctx!;
    if (fade > 0) {
      handle.gain.gain.setValueAtTime(0, ctx.currentTime);
      handle.gain.gain.linearRampToValueAtTime(opts.volume ?? 1, ctx.currentTime + fade);
    }
    prev?.stop(fade);
    this.music = handle;
    this.musicId = id;
    this.events.emit('musicChanged', id);
    return handle;
  }

  stopMusic(fade = 1): void {
    this.music?.stop(fade);
    this.music = null;
    this.musicId = null;
    this.events.emit('musicChanged', null);
  }

  get currentMusic(): string | null {
    return this.musicId;
  }

  /** Stop every sound. */
  stopAll(fade = 0): void {
    for (const h of Array.from(this.active)) h.stop(fade);
    this.music = null;
    this.musicId = null;
  }

  /** Number of playing sounds. */
  get activeCount(): number {
    return this.active.size;
  }

  /** Suspend the context (e.g. on tab hide). */
  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  dispose(): void {
    this.stopAll();
    void this.ctx?.close();
    this.ctx = null;
    this.buses = null;
  }

  /** @internal */
  _release(handle: SoundHandle): void {
    this.active.delete(handle);
    try { handle.source.disconnect(); handle.gain.disconnect(); handle.panner?.disconnect(); } catch { /* ignore */ }
  }

  /** @internal compute distance attenuation and stereo pan */
  _spatialize(handle: SoundHandle): void {
    const o = handle.options;
    let vol = o.volume ?? 1;
    if (handle.position) {
      const dx = handle.position.x - this.listener.x;
      const dy = handle.position.y - this.listener.y;
      const dist = Math.hypot(dx, dy);
      const max = o.maxDistance ?? this.maxDistance;
      const att = dist <= this.refDistance ? 1 : clamp(1 - (dist - this.refDistance) / Math.max(0.001, max - this.refDistance), 0, 1);
      vol *= att * att;
      if (handle.panner) handle.panner.pan.value = clamp(dx / Math.max(1, max), -1, 1) * 0.8;
    }
    handle.gain.gain.value = vol;
  }

  private applyVolumes(): void {
    if (!this.buses) return;
    this.buses.master.gain.value = this.muted ? 0 : this.busVolumes.master;
    this.buses.sfx.gain.value = this.busVolumes.sfx;
    this.buses.music.gain.value = this.busVolumes.music;
  }
}

const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'] as const;
