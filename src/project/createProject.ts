import { createEmptyScene, type SceneData } from '../core/ecs/Scene';
import { PROJECT_VERSION, type Project, type ProjectSettings } from './types';

/** Generate a URL-safe random id. */
export function generateId(prefix = 'p'): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
}

/** Default settings for a new project. */
export function defaultSettings(renderer: '2d' | '3d' = '2d'): ProjectSettings {
  return {
    renderer,
    pixelsPerUnit: 32,
    pixelPerfect: false,
    fixedRate: 60,
    viewport: { width: 960, height: 540 },
    physics: { gravity: { x: 0, y: -20 }, gravity3d: { x: 0, y: -20, z: 0 } },
    network: { mode: 'none', maxPlayers: 8, tickRate: 20 },
    multiUser: { sharedControl: false, mergeStrategy: 'average' },
    input: {
      actions: {
        jump: ['Space', 'KeyW', 'ArrowUp', 'GamepadA', 'Touch:jump'],
        fire: ['MouseLeft', 'KeyJ', 'GamepadX', 'Touch:fire'],
        action: ['KeyE', 'Enter', 'GamepadB', 'Touch:action'],
        pause: ['Escape', 'GamepadStart'],
      },
      axes: {
        moveX: { negative: ['KeyA', 'ArrowLeft', 'GamepadDpadLeft'], positive: ['KeyD', 'ArrowRight', 'GamepadDpadRight'], gamepadAxis: 0, touchJoystick: 'x' },
        moveY: { negative: ['KeyS', 'ArrowDown', 'GamepadDpadDown'], positive: ['KeyW', 'ArrowUp', 'GamepadDpadUp'], gamepadAxis: 1, invertGamepad: true, touchJoystick: 'y' },
      },
    },
    touchControls: true,
    touchButtons: ['jump', 'fire'],
  };
}

/** A starter scene with a camera (and a light for 3D). */
export function defaultScene(renderer: '2d' | '3d', name = 'Main'): SceneData {
  const scene = createEmptyScene(name);
  if (renderer === '2d') {
    scene.entities.push({
      id: 1, name: 'Camera',
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        { type: 'Camera2D', data: {} },
        { type: 'AudioListener', data: {} },
      ],
    });
  } else {
    scene.entities.push(
      {
        id: 1, name: 'Camera',
        components: [
          { type: 'Transform', data: { position: { x: 6, y: 5, z: 8 } } },
          { type: 'Camera3D', data: { lookAt: 3 } },
          { type: 'AudioListener', data: {} },
        ],
      },
      {
        id: 2, name: 'Sun',
        components: [
          { type: 'Transform', data: { position: { x: 0, y: 10, z: 0 }, rotation: { x: -0.5, y: 0.3, z: 0.15, w: 0.79 } } },
          { type: 'Light', data: { kind: 'directional', intensity: 1.2 } },
        ],
      },
      {
        id: 3, name: 'Ground',
        components: [
          { type: 'Transform', data: { scale: { x: 20, y: 1, z: 20 } } },
          { type: 'MeshRenderer', data: { mesh: 'plane', color: { r: 0.35, g: 0.45, b: 0.35, a: 1 } } },
        ],
      },
    );
  }
  return scene;
}

/** Create a new, empty project with sensible defaults. */
export function createProject(opts: { name?: string; renderer?: '2d' | '3d'; id?: string; author?: string } = {}): Project {
  const renderer = opts.renderer ?? '2d';
  const now = new Date().toISOString();
  return {
    id: opts.id ?? generateId(),
    name: opts.name ?? 'Untitled Project',
    version: PROJECT_VERSION,
    projectVersion: '0.1.0',
    description: '',
    author: opts.author ?? '',
    thumbnail: '',
    createdAt: now,
    updatedAt: now,
    scenes: [defaultScene(renderer)],
    startScene: 'Main',
    scripts: [],
    prefabs: [],
    assets: { assets: [] },
    settings: defaultSettings(renderer),
  };
}

/** Fill in missing fields from older or partial documents. Throws on incompatible versions. */
export function normalizeProject(input: Partial<Project> & { id?: string }): Project {
  const version = input.version ?? PROJECT_VERSION;
  if (version > PROJECT_VERSION) throw new Error(`Project version ${version} is newer than supported ${PROJECT_VERSION}`);
  const renderer = input.settings?.renderer ?? '2d';
  const base = createProject({ name: input.name, renderer, id: input.id });
  const settings: ProjectSettings = {
    ...base.settings,
    ...input.settings,
    physics: { ...base.settings.physics, ...input.settings?.physics },
    network: { ...base.settings.network, ...input.settings?.network },
    multiUser: { ...base.settings.multiUser, ...input.settings?.multiUser },
    input: { actions: { ...base.settings.input.actions, ...input.settings?.input?.actions }, axes: { ...base.settings.input.axes, ...input.settings?.input?.axes } },
    viewport: { ...base.settings.viewport, ...input.settings?.viewport },
  };
  const scenes = input.scenes && input.scenes.length ? input.scenes : base.scenes;
  return {
    ...base,
    ...input,
    version: PROJECT_VERSION,
    scenes,
    startScene: input.startScene && scenes.some((s) => s.name === input.startScene) ? input.startScene : scenes[0].name,
    scripts: input.scripts ?? [],
    prefabs: input.prefabs ?? [],
    assets: input.assets ?? { assets: [] },
    settings,
  };
}

/** Deep clone a project. */
export function cloneProject(p: Project): Project {
  return structuredClone(p);
}
