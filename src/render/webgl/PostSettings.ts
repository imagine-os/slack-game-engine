import { Color } from '../../core/math';
import type { TonemapMode } from '../components';

/** Plain post-processing settings held by `renderer.post`. Mirrors the `PostProcessSettings` component. */
export interface PostSettings {
  enabled: boolean;
  hdr: boolean;
  msaa: number;
  bloom: boolean;
  bloomThreshold: number;
  bloomSoftKnee: number;
  bloomIntensity: number;
  bloomRadius: number;
  exposure: number;
  tonemap: TonemapMode;
  saturation: number;
  contrast: number;
  lift: Color;
  gamma: Color;
  gain: Color;
  vignette: number;
  vignetteSmoothness: number;
  fxaa: boolean;
  chromaticAberration: number;
}

/** JSON form of {@link PostSettings} (colours as RGB arrays). */
export type PostSettingsJSON = Partial<Omit<PostSettings, 'lift' | 'gamma' | 'gain'> & { lift: number[]; gamma: number[]; gain: number[] }>;

const TONEMAPS: readonly TonemapMode[] = ['none', 'aces', 'reinhard'];

/** Fresh defaults: pipeline disabled, neutral grade. */
export function defaultPostSettings(): PostSettings {
  return {
    enabled: false, hdr: true, msaa: 4,
    bloom: true, bloomThreshold: 1, bloomSoftKnee: 0.5, bloomIntensity: 0.5, bloomRadius: 1,
    exposure: 1, tonemap: 'aces', saturation: 1, contrast: 1,
    lift: new Color(0, 0, 0, 1), gamma: new Color(1, 1, 1, 1), gain: new Color(1, 1, 1, 1),
    vignette: 0, vignetteSmoothness: 0.5, fxaa: true, chromaticAberration: 0,
  };
}

/** Copy every setting from `from` (component or plain object) into `to`. Returns `to`. */
export function copyPostSettings(from: Readonly<PostSettings>, to: PostSettings): PostSettings {
  to.enabled = from.enabled; to.hdr = from.hdr; to.msaa = from.msaa;
  to.bloom = from.bloom; to.bloomThreshold = from.bloomThreshold; to.bloomSoftKnee = from.bloomSoftKnee;
  to.bloomIntensity = from.bloomIntensity; to.bloomRadius = from.bloomRadius;
  to.exposure = from.exposure; to.tonemap = from.tonemap; to.saturation = from.saturation; to.contrast = from.contrast;
  to.lift.copy(from.lift); to.gamma.copy(from.gamma); to.gain.copy(from.gain);
  to.vignette = from.vignette; to.vignetteSmoothness = from.vignetteSmoothness;
  to.fxaa = from.fxaa; to.chromaticAberration = from.chromaticAberration;
  return to;
}

/** Serialize to a compact JSON object (only values that differ from the defaults are required on load). */
export function postSettingsToJSON(s: Readonly<PostSettings>): PostSettingsJSON {
  return {
    enabled: s.enabled, hdr: s.hdr, msaa: s.msaa,
    bloom: s.bloom, bloomThreshold: s.bloomThreshold, bloomSoftKnee: s.bloomSoftKnee, bloomIntensity: s.bloomIntensity, bloomRadius: s.bloomRadius,
    exposure: s.exposure, tonemap: s.tonemap, saturation: s.saturation, contrast: s.contrast,
    lift: [s.lift.r, s.lift.g, s.lift.b], gamma: [s.gamma.r, s.gamma.g, s.gamma.b], gain: [s.gain.r, s.gain.g, s.gain.b],
    vignette: s.vignette, vignetteSmoothness: s.vignetteSmoothness, fxaa: s.fxaa, chromaticAberration: s.chromaticAberration,
  };
}

/** Build settings from JSON, filling gaps with defaults and clamping/validating values. */
export function postSettingsFromJSON(json: PostSettingsJSON | null | undefined, into: PostSettings = defaultPostSettings()): PostSettings {
  const j = json ?? {};
  const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const col = (v: unknown, c: Color) => {
    if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number')) c.set(v[0], v[1], v[2], 1);
    else if (v && typeof v === 'object' && 'r' in v) c.copy(v as Color);
    return c;
  };
  into.enabled = bool(j.enabled, into.enabled);
  into.hdr = bool(j.hdr, into.hdr);
  into.msaa = Math.round(num(j.msaa, into.msaa, 0, 16));
  into.bloom = bool(j.bloom, into.bloom);
  into.bloomThreshold = num(j.bloomThreshold, into.bloomThreshold, 0);
  into.bloomSoftKnee = num(j.bloomSoftKnee, into.bloomSoftKnee, 0, 1);
  into.bloomIntensity = num(j.bloomIntensity, into.bloomIntensity, 0);
  into.bloomRadius = num(j.bloomRadius, into.bloomRadius, 0.01);
  into.exposure = num(j.exposure, into.exposure, 0);
  into.tonemap = TONEMAPS.includes(j.tonemap as TonemapMode) ? (j.tonemap as TonemapMode) : into.tonemap;
  into.saturation = num(j.saturation, into.saturation, 0);
  into.contrast = num(j.contrast, into.contrast, 0);
  col(j.lift, into.lift); col(j.gamma, into.gamma); col(j.gain, into.gain);
  into.vignette = num(j.vignette, into.vignette, 0, 1);
  into.vignetteSmoothness = num(j.vignetteSmoothness, into.vignetteSmoothness, 0.01, 1);
  into.fxaa = bool(j.fxaa, into.fxaa);
  into.chromaticAberration = num(j.chromaticAberration, into.chromaticAberration, 0, 1);
  return into;
}
