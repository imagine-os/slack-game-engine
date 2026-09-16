/**
 * Registry of every bundled demo. Order here is the order in
 * `public/demos/index.json` (and on the launcher).
 */
import type { DemoBundle } from './lib';
import { build as starter2d } from './starter-2d/index';
import { build as starter3d } from './starter-3d/index';

export const DEMO_BUILDERS: Record<string, () => DemoBundle> = {
  'starter-2d': starter2d,
  'starter-3d': starter3d,
};

export function buildAllDemos(): DemoBundle[] {
  return Object.values(DEMO_BUILDERS).map((fn) => fn());
}
