/**
 * Human-friendly world seeds (`amber-lagoon-42`): any string works, the
 * words just make them shareable. `seedValue` hashes the normalized form so
 * `Amber Lagoon 42` and `amber-lagoon-42` are the same world.
 */
import { Random } from '../core/math/Random';
import { hashString } from './noise';

export const SEED_ADJECTIVES: readonly string[] = [
  'amber', 'ashen', 'azure', 'bright', 'calm', 'cobalt', 'coral', 'crimson', 'dusky', 'ember', 'faded', 'gilded',
  'golden', 'hazy', 'hollow', 'ivory', 'jade', 'lucid', 'misty', 'moss', 'opal', 'pale', 'quiet', 'rosy',
  'saffron', 'silver', 'slate', 'sunlit', 'teal', 'umber', 'velvet', 'wild',
];

export const SEED_NOUNS: readonly string[] = [
  'archipelago', 'bloom', 'breeze', 'canyon', 'cascade', 'cloud', 'crest', 'current', 'drift', 'dusk', 'echo', 'feather',
  'gale', 'harbor', 'haven', 'horizon', 'lagoon', 'lantern', 'meadow', 'mirror', 'orchard', 'petal', 'reach', 'ridge',
  'shoal', 'sky', 'spire', 'strand', 'summit', 'thermal', 'tide', 'zephyr',
];

/** Canonical form: lower case, words joined by single dashes. */
export function normalizeSeed(seed: string): string {
  return seed.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'driftwind';
}

/** Numeric seed for a seed phrase. */
export function seedValue(seed: string): number {
  return hashString(normalizeSeed(seed));
}

/** A fresh word seed from a generator (or a time-based one when omitted). */
export function randomSeed(rng: Random = new Random()): string {
  return `${rng.pick(SEED_ADJECTIVES)}-${rng.pick(SEED_NOUNS)}-${rng.int(10, 99)}`;
}

/** The seed everyone gets on a given day (UTC), for daily challenges. */
export function dailySeed(date: Date = new Date()): string {
  const day = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return randomSeed(new Random(hashString(`daily:${day}`)));
}

/** Title-case a seed for display (`Amber Lagoon 42`). */
export function seedTitle(seed: string): string {
  return normalizeSeed(seed).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}
