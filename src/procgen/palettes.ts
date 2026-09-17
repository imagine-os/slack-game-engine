/**
 * Biome palettes for the archipelago. Every colour is an {@link RGB}; the
 * generators pick from these so an island's grass, cliffs, trees and props
 * read as one place. Sky presets describe the time-of-day cycle.
 */
import { type RGB, rgb } from './MeshBuilder';

export type BiomeId = 'meadow' | 'lagoon' | 'dusk' | 'ember' | 'crest';
export type TreeSpecies = 'pine' | 'broadleaf' | 'palm' | 'dead';

export interface Palette {
  id: BiomeId;
  name: string;
  /** Grass tones, light to dark (per-face variation picks among them). */
  grass: RGB[];
  cliff: RGB;
  cliffDark: RGB;
  rock: RGB;
  rockDark: RGB;
  sand: RGB;
  trunk: RGB;
  canopy: RGB[];
  water: RGB;
  foam: RGB;
  crystal: RGB;
  crystalGlow: RGB;
  stone: RGB;
  stoneDark: RGB;
  accent: RGB;
  lantern: RGB;
  /** Tree species that grow here with relative weights. */
  trees: { species: TreeSpecies; weight: number }[];
  /** Decoration density multipliers. */
  density: { trees: number; rocks: number; crystals: number; ruins: number };
}

export const PALETTES: Record<BiomeId, Palette> = {
  meadow: {
    id: 'meadow', name: 'Golden Meadow',
    grass: [rgb('#b8d46a'), rgb('#8fbf4f'), rgb('#6ea23e'), rgb('#d9c96a')],
    cliff: rgb('#c98a5a'), cliffDark: rgb('#9c6740'), rock: rgb('#9a8b7c'), rockDark: rgb('#6f6258'), sand: rgb('#e8d7a8'),
    trunk: rgb('#7a5236'), canopy: [rgb('#68b04e'), rgb('#4f9a3c'), rgb('#9fcf5c')],
    water: rgb('#5fc7e8'), foam: rgb('#e8fbff'), crystal: rgb('#ffd166'), crystalGlow: rgb('#ffe9a8'),
    stone: rgb('#d9cfbf'), stoneDark: rgb('#a89a86'), accent: rgb('#ff7a3d'), lantern: rgb('#ffcf7a'),
    trees: [{ species: 'broadleaf', weight: 3 }, { species: 'pine', weight: 1 }],
    density: { trees: 1, rocks: 0.6, crystals: 0.2, ruins: 0.5 },
  },
  lagoon: {
    id: 'lagoon', name: 'Teal Lagoon',
    grass: [rgb('#7fd6a4'), rgb('#57bf8a'), rgb('#3fa374'), rgb('#a9e6b8')],
    cliff: rgb('#8fa4a8'), cliffDark: rgb('#657b80'), rock: rgb('#7f8e93'), rockDark: rgb('#55636a'), sand: rgb('#f3e7c4'),
    trunk: rgb('#9c7a4e'), canopy: [rgb('#3fb27a'), rgb('#2f9a66'), rgb('#7fd08f')],
    water: rgb('#2fd3d6'), foam: rgb('#e8ffff'), crystal: rgb('#4cc2ff'), crystalGlow: rgb('#b8ecff'),
    stone: rgb('#e6e0d0'), stoneDark: rgb('#b0a894'), accent: rgb('#ff9f6b'), lantern: rgb('#ffe1a3'),
    trees: [{ species: 'palm', weight: 3 }, { species: 'broadleaf', weight: 1 }],
    density: { trees: 0.8, rocks: 0.6, crystals: 0.4, ruins: 0.6 },
  },
  dusk: {
    id: 'dusk', name: 'Lavender Dusk',
    grass: [rgb('#a68fd6'), rgb('#8a72c4'), rgb('#6b58a6'), rgb('#c8a8e6')],
    cliff: rgb('#5c5580'), cliffDark: rgb('#3f3a5e'), rock: rgb('#6f6a8c'), rockDark: rgb('#4a4666'), sand: rgb('#d8c6e8'),
    trunk: rgb('#4a3552'), canopy: [rgb('#e08bb8'), rgb('#c46da0'), rgb('#f2a8c8')],
    water: rgb('#7f8dff'), foam: rgb('#eef0ff'), crystal: rgb('#ff8bd1'), crystalGlow: rgb('#ffd1ec'),
    stone: rgb('#c9c3dd'), stoneDark: rgb('#8f88a8'), accent: rgb('#ffb347'), lantern: rgb('#ffd9a0'),
    trees: [{ species: 'pine', weight: 2 }, { species: 'broadleaf', weight: 2 }],
    density: { trees: 1, rocks: 0.5, crystals: 0.7, ruins: 0.8 },
  },
  ember: {
    id: 'ember', name: 'Ember Canyon',
    grass: [rgb('#c9a35a'), rgb('#a98443'), rgb('#7f6330'), rgb('#d9b56a')],
    cliff: rgb('#b8513a'), cliffDark: rgb('#7f3526'), rock: rgb('#8f5a4a'), rockDark: rgb('#5c3a30'), sand: rgb('#e8b07a'),
    trunk: rgb('#3f2b24'), canopy: [rgb('#8a9a3f'), rgb('#6e7f33'), rgb('#b0b25a')],
    water: rgb('#ff9a4a'), foam: rgb('#ffe6c8'), crystal: rgb('#ff5f3d'), crystalGlow: rgb('#ffb08a'),
    stone: rgb('#c8a88a'), stoneDark: rgb('#8a6e58'), accent: rgb('#ffd166'), lantern: rgb('#ffb86b'),
    trees: [{ species: 'dead', weight: 3 }, { species: 'pine', weight: 1 }],
    density: { trees: 0.5, rocks: 1.2, crystals: 1.4, ruins: 0.5 },
  },
  crest: {
    id: 'crest', name: 'Snow Crest',
    grass: [rgb('#f4f7ff'), rgb('#dfe8f5'), rgb('#c4d3e6'), rgb('#ffffff')],
    cliff: rgb('#6b7a8f'), cliffDark: rgb('#4a5568'), rock: rgb('#7d8899'), rockDark: rgb('#535c6b'), sand: rgb('#e6edf5'),
    trunk: rgb('#4f3a2e'), canopy: [rgb('#2f6b4f'), rgb('#255540'), rgb('#4a8a62')],
    water: rgb('#8fd8ff'), foam: rgb('#ffffff'), crystal: rgb('#a8e8ff'), crystalGlow: rgb('#e8fbff'),
    stone: rgb('#dde3ea'), stoneDark: rgb('#a3adb9'), accent: rgb('#ff7a3d'), lantern: rgb('#ffe0b0'),
    trees: [{ species: 'pine', weight: 4 }, { species: 'dead', weight: 1 }],
    density: { trees: 1.1, rocks: 0.9, crystals: 0.5, ruins: 0.4 },
  },
};

export const BIOME_IDS: readonly BiomeId[] = ['meadow', 'lagoon', 'dusk', 'ember', 'crest'];

/** Sky/atmosphere colours at one moment of the day cycle. */
export interface SkyPreset {
  /** 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  time: number;
  top: RGB;
  horizon: RGB;
  fog: RGB;
  sun: RGB;
  sunIntensity: number;
  ambient: RGB;
  ambientIntensity: number;
}

/** Keyframes of the day cycle; the Sky script interpolates between them. */
export const SKY_PRESETS: readonly SkyPreset[] = [
  { time: 0.0, top: rgb('#0b1030'), horizon: rgb('#2a2f5a'), fog: rgb('#232848'), sun: rgb('#8fa4ff'), sunIntensity: 0.35, ambient: rgb('#4a5aa8'), ambientIntensity: 0.35 },
  { time: 0.22, top: rgb('#3a3f7a'), horizon: rgb('#ff9a7a'), fog: rgb('#e0a8a0'), sun: rgb('#ffb08a'), sunIntensity: 0.9, ambient: rgb('#a08cc8'), ambientIntensity: 0.4 },
  { time: 0.32, top: rgb('#4f8fd8'), horizon: rgb('#ffd9a8'), fog: rgb('#f0d8c0'), sun: rgb('#fff1d6'), sunIntensity: 1.25, ambient: rgb('#b8c8ff'), ambientIntensity: 0.42 },
  { time: 0.5, top: rgb('#3f7fdc'), horizon: rgb('#cfe6ff'), fog: rgb('#dbe8f7'), sun: rgb('#fff8ec'), sunIntensity: 1.35, ambient: rgb('#b0c4ff'), ambientIntensity: 0.45 },
  { time: 0.7, top: rgb('#5a6fd0'), horizon: rgb('#ffcf8a'), fog: rgb('#f3d2b0'), sun: rgb('#ffe2b0'), sunIntensity: 1.2, ambient: rgb('#c0b0ff'), ambientIntensity: 0.42 },
  { time: 0.8, top: rgb('#3f3a86'), horizon: rgb('#ff8a5a'), fog: rgb('#e8a898'), sun: rgb('#ffa068'), sunIntensity: 0.95, ambient: rgb('#a888d8'), ambientIntensity: 0.4 },
  { time: 0.9, top: rgb('#141a48'), horizon: rgb('#6a4c8a'), fog: rgb('#4a4070'), sun: rgb('#b09cff'), sunIntensity: 0.45, ambient: rgb('#5a5ab0'), ambientIntensity: 0.36 },
  { time: 1.0, top: rgb('#0b1030'), horizon: rgb('#2a2f5a'), fog: rgb('#232848'), sun: rgb('#8fa4ff'), sunIntensity: 0.35, ambient: rgb('#4a5aa8'), ambientIntensity: 0.35 },
];

/** Interpolated sky state for a time of day in `[0, 1)`. */
export function skyAt(time: number): SkyPreset {
  const t = ((time % 1) + 1) % 1;
  let a = SKY_PRESETS[0], b = SKY_PRESETS[SKY_PRESETS.length - 1];
  for (let i = 1; i < SKY_PRESETS.length; i++) {
    if (t <= SKY_PRESETS[i].time) { a = SKY_PRESETS[i - 1]; b = SKY_PRESETS[i]; break; }
  }
  const k = (t - a.time) / Math.max(1e-6, b.time - a.time);
  const s = k * k * (3 - 2 * k);
  const mix = (x: RGB, y: RGB): RGB => ({ r: x.r + (y.r - x.r) * s, g: x.g + (y.g - x.g) * s, b: x.b + (y.b - x.b) * s });
  return {
    time: t, top: mix(a.top, b.top), horizon: mix(a.horizon, b.horizon), fog: mix(a.fog, b.fog), sun: mix(a.sun, b.sun),
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * s,
    ambient: mix(a.ambient, b.ambient), ambientIntensity: a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * s,
  };
}

/** Three glider liveries (hull, wing, trim, canopy tint). */
export interface Livery { name: string; hull: RGB; wing: RGB; trim: RGB; canopy: RGB }
export const LIVERIES: readonly Livery[] = [
  { name: 'Sunset', hull: rgb('#f7f2e8'), wing: rgb('#ff7a3d'), trim: rgb('#1a2238'), canopy: rgb('#3a6fd8') },
  { name: 'Lagoon', hull: rgb('#e8fbff'), wing: rgb('#2fb8c9'), trim: rgb('#ffd166'), canopy: rgb('#2a4d8f') },
  { name: 'Dusk', hull: rgb('#f2e9ff'), wing: rgb('#8b7dff'), trim: rgb('#ff8bd1'), canopy: rgb('#2a2f5a') },
  { name: 'Ember', hull: rgb('#fff1e0'), wing: rgb('#ef476f'), trim: rgb('#ffd166'), canopy: rgb('#3a2a1a') },
  { name: 'Moss', hull: rgb('#f4f7ee'), wing: rgb('#06d6a0'), trim: rgb('#1a2238'), canopy: rgb('#2a4d3f') },
  { name: 'Snow', hull: rgb('#ffffff'), wing: rgb('#4cc2ff'), trim: rgb('#ef476f'), canopy: rgb('#1a2238') },
];
