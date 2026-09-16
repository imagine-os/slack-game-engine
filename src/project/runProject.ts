import type { Engine, EngineOptions } from '../core/Engine';
import type { Project } from './types';

export interface RunProjectOptions {
  /** Called with 0..1 as assets load. */
  onProgress?: (fraction: number) => void;
  /** Scene to start instead of `project.startScene`. */
  scene?: string;
  /** Abort on asset failures instead of continuing with placeholders. Default false. */
  strictAssets?: boolean;
}

/** Engine options derived from project settings (pass to `Engine.create`). */
export function engineOptionsFor(project: Project, extra: EngineOptions = {}): EngineOptions {
  const s = project.settings;
  return {
    renderer: s.renderer,
    fixedRate: s.fixedRate,
    pixelsPerUnit: s.pixelsPerUnit,
    render: { pixelPerfect: s.pixelPerfect, ...extra.render },
    gravity: s.physics.gravity,
    touchOverlay: s.touchControls ? { joystick: true, buttons: s.touchButtons.map((name) => ({ name })) } : false,
    defaultBindings: false,
    ...extra,
  };
}

/**
 * Load a project into an engine: input bindings, physics settings, scripts,
 * prefabs, assets (with progress) and the start scene. Does not call
 * `engine.start()`.
 */
export async function runProject(engine: Engine, project: Project, opts: RunProjectOptions = {}): Promise<void> {
  const s = project.settings;
  engine.input.loadBindings(s.input);
  engine.physics.gravity.set(s.physics.gravity.x, s.physics.gravity.y);
  engine.physics3d.gravity.set(s.physics.gravity3d.x, s.physics.gravity3d.y, s.physics.gravity3d.z);
  engine.clock.fixedRate = s.fixedRate;
  if (engine.renderer) engine.renderer.pixelsPerUnit = s.pixelsPerUnit;

  engine.prefabs.clear();
  for (const p of project.prefabs) engine.prefabs.set(p.name, p);

  const problems = engine.scripting.load(project.scripts);
  if (problems.length) engine.warn(`${problems.length} script(s) failed to compile`);

  const total = project.assets.assets.length;
  const off = engine.assets.events.on('progress', (p) => opts.onProgress?.(p.loaded / Math.max(1, p.total)));
  try {
    const { failed } = await engine.assets.loadManifest(project.assets, { strict: opts.strictAssets });
    for (const f of failed) engine.warn(`Asset "${f.id}" (${f.url}) failed to load`);
  } finally {
    off();
  }
  if (total === 0) opts.onProgress?.(1);

  const sceneName = opts.scene ?? project.startScene;
  const scene = project.scenes.find((sc) => sc.name === sceneName) ?? project.scenes[0];
  if (!scene) throw new Error('Project has no scenes');
  engine.loadScene(scene);
}
