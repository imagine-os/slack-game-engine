/**
 * Registry of every bundled demo. Order here is the order in
 * `public/demos/index.json` (and on the launcher).
 */
import type { DemoBundle } from './lib';
import { build as arenaBlasters } from './arena-blasters/index';
import { build as cubeRacers } from './cube-racers/index';
import { build as paddleRush } from './paddle-rush/index';
import { build as skyHoppers } from './sky-hoppers/index';
import { build as towerTogether } from './tower-together/index';
import { build as starter2d } from './starter-2d/index';
import { build as starter3d } from './starter-3d/index';

export const DEMO_BUILDERS: Record<string, () => DemoBundle> = {
  'arena-blasters': arenaBlasters,
  'sky-hoppers': skyHoppers,
  'paddle-rush': paddleRush,
  'cube-racers': cubeRacers,
  'tower-together': towerTogether,
  'starter-2d': starter2d,
  'starter-3d': starter3d,
};

export function buildAllDemos(): DemoBundle[] {
  return Object.values(DEMO_BUILDERS).map((fn) => fn());
}
