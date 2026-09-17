import { Color, Vec3 } from '../../core/math';
import { clamp, lerp } from '../../core/math/scalar';

/** Inputs for {@link evaluateSky}; a subset of the `SkySettings` component. */
export interface SkyParams {
  timeOfDay: number;
  sunAzimuth: number;
  sunElevationScale: number;
  turbidity: number;
  exposure: number;
  tint: { r: number; g: number; b: number };
  sunIntensity: number;
  moonIntensity: number;
  ambientIntensity: number;
}

/** Resolved sky/lighting state for one frame. */
export interface SkyState {
  /** Unit vector pointing toward the sun (may be below the horizon). */
  sunDir: Vec3;
  /** Sun elevation above the horizon, radians. */
  sunElevation: number;
  /** Colour of the sun disc and, when above the horizon, the directional light. */
  sunColor: Color;
  /** Directional light: direction light travels and colour*intensity (sun by day, moon by night). */
  lightDir: Vec3;
  lightColor: Color;
  lightIntensity: number;
  zenith: Color;
  horizon: Color;
  /** Colour a little above the horizon (transition band). */
  mid: Color;
  ground: Color;
  ambientSky: Color;
  ambientGround: Color;
  fogColor: Color;
  /** 0 by day, 1 at night (drives stars). */
  night: number;
}

export function createSkyState(): SkyState {
  return {
    sunDir: new Vec3(0, 1, 0), sunElevation: Math.PI / 2, sunColor: new Color(), lightDir: new Vec3(0, -1, 0), lightColor: new Color(), lightIntensity: 1,
    zenith: new Color(), horizon: new Color(), mid: new Color(), ground: new Color(), ambientSky: new Color(), ambientGround: new Color(), fogColor: new Color(), night: 0,
  };
}

/** Sun elevation in radians for an hour of the day (6 = sunrise, 12 = noon, 18 = sunset). */
export function sunElevation(timeOfDay: number, elevationScale = 1): number {
  const t = ((timeOfDay % 24) + 24) % 24;
  return Math.sin(((t - 6) * Math.PI) / 12) * (Math.PI / 2) * elevationScale;
}

/** Unit vector toward the sun. Azimuth is the compass heading at noon (0 = +Z, 90 = +X). */
export function sunDirection(timeOfDay: number, azimuthDeg: number, elevationScale: number, out: Vec3): Vec3 {
  const t = ((timeOfDay % 24) + 24) % 24;
  const elev = sunElevation(t, elevationScale);
  // The sun sweeps 180 degrees across the sky between sunrise and sunset.
  const az = (azimuthDeg * Math.PI) / 180 + ((t - 12) * Math.PI) / 12;
  const ce = Math.cos(elev);
  return out.set(Math.sin(az) * ce, Math.sin(elev), Math.cos(az) * ce).normalize();
}

interface SkyKey { e: number; zenith: string; mid: string; horizon: string; ground: string; sun: string; sunI: number }

/** Palette keyframes by sun elevation (degrees). */
const KEYS: SkyKey[] = [
  { e: -90, zenith: '#04060f', mid: '#070b1a', horizon: '#0a1020', ground: '#05060a', sun: '#000000', sunI: 0 },
  { e: -14, zenith: '#060a18', mid: '#0c1328', horizon: '#111a33', ground: '#06070c', sun: '#000000', sunI: 0 },
  { e: -6, zenith: '#131c3d', mid: '#3a2f5c', horizon: '#5a3556', ground: '#0d0b12', sun: '#4a2a3a', sunI: 0 },
  { e: 0, zenith: '#2c4a86', mid: '#b07a8c', horizon: '#ff9457', ground: '#2a1d1a', sun: '#ff7132', sunI: 0.35 },
  { e: 6, zenith: '#3c73c2', mid: '#bf95a3', horizon: '#f5ad6b', ground: '#3d2f26', sun: '#ffb26a', sunI: 0.85 },
  { e: 15, zenith: '#3574d1', mid: '#86a9d8', horizon: '#dcc4a3', ground: '#4a4034', sun: '#ffe6c2', sunI: 1 },
  { e: 45, zenith: '#2a66cc', mid: '#76a3d9', horizon: '#bcd2e6', ground: '#4a4a48', sun: '#fff5e6', sunI: 1 },
  { e: 90, zenith: '#245cc4', mid: '#6f9dd6', horizon: '#b6cde4', ground: '#4a4a48', sun: '#fff9f0', sunI: 1 },
];
const KEY_COLORS = KEYS.map((k) => ({ zenith: Color.fromHex(k.zenith), mid: Color.fromHex(k.mid), horizon: Color.fromHex(k.horizon), ground: Color.fromHex(k.ground), sun: Color.fromHex(k.sun) }));

const _a = new Color();

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Evaluate sky colours, sun/moon light and ambient for the given settings.
 * Deterministic and allocation-free after the first call (writes into `out`).
 */
export function evaluateSky(p: SkyParams, out: SkyState): SkyState {
  sunDirection(p.timeOfDay, p.sunAzimuth, p.sunElevationScale, out.sunDir);
  const elev = Math.asin(clamp(out.sunDir.y, -1, 1));
  out.sunElevation = elev;
  const deg = (elev * 180) / Math.PI;
  // Find the keyframe pair.
  let i = 0;
  while (i < KEYS.length - 2 && deg > KEYS[i + 1].e) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const t = smooth(clamp((deg - k0.e) / (k1.e - k0.e), 0, 1));
  const c0 = KEY_COLORS[i], c1 = KEY_COLORS[i + 1];
  out.zenith.copy(c0.zenith).lerp(c1.zenith, t);
  out.horizon.copy(c0.horizon).lerp(c1.horizon, t);
  out.mid.copy(c0.mid).lerp(c1.mid, t);
  out.ground.copy(c0.ground).lerp(c1.ground, t);
  out.sunColor.copy(c0.sun).lerp(c1.sun, t);
  const sunI = lerp(k0.sunI, k1.sunI, t);
  // Turbidity washes the horizon toward a bright haze.
  const lum = 0.3 * out.horizon.r + 0.59 * out.horizon.g + 0.11 * out.horizon.b;
  _a.set(lum * 1.15, lum * 1.12, lum * 1.05, 1);
  out.horizon.lerp(_a, p.turbidity * 0.6);
  for (const c of [out.zenith, out.mid, out.horizon, out.ground, out.sunColor]) {
    c.r *= p.tint.r * p.exposure; c.g *= p.tint.g * p.exposure; c.b *= p.tint.b * p.exposure; c.a = 1;
  }
  out.night = smooth(clamp((2 - deg) / 10, 0, 1));
  // Fog sits between the horizon and the band above it.
  out.fogColor.copy(out.horizon).lerp(out.mid, 0.35);
  // Hemisphere ambient.
  out.ambientSky.copy(out.horizon).lerp(out.mid, 0.6).scale(0.55 * p.ambientIntensity);
  out.ambientGround.copy(out.ground).scale(0.7 * p.ambientIntensity);
  out.ambientSky.a = out.ambientGround.a = 1;
  // Directional light: the sun by day, a faint moon at night.
  if (sunI > 0.001) {
    out.lightDir.copy(out.sunDir).negate();
    out.lightColor.copy(out.sunColor);
    out.lightIntensity = sunI * p.sunIntensity;
  } else {
    out.lightDir.set(-out.sunDir.x, -Math.abs(out.sunDir.y) - 0.35, -out.sunDir.z).normalize();
    out.lightColor.set(0.62, 0.72, 1, 1);
    out.lightIntensity = p.moonIntensity;
  }
  return out;
}
