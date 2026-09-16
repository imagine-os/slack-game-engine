import type { ComponentData } from '../../core/ecs/Scene';
import { shortId } from '../ui/dom';
import type { EntitySnapshot } from './SceneEditor';

export type EntityPreset =
  | 'empty' | 'sprite' | 'shape' | 'circle' | 'text' | 'camera' | 'light' | 'tilemap' | 'particles' | 'physicsBox'
  | 'cube' | 'sphere' | 'plane' | 'cylinder' | 'camera3d' | 'light3d' | 'pointLight';

export interface PresetInfo { id: EntityPreset; label: string; icon: string; renderer: '2d' | '3d' | 'both' }

/** Presets shown in "Create" menus, filtered by project renderer. */
export const PRESETS: PresetInfo[] = [
  { id: 'empty', label: 'Empty entity', icon: 'entity', renderer: 'both' },
  { id: 'sprite', label: 'Sprite', icon: 'image', renderer: '2d' },
  { id: 'shape', label: 'Shape (rectangle)', icon: 'shapes', renderer: '2d' },
  { id: 'circle', label: 'Shape (circle)', icon: 'circle', renderer: '2d' },
  { id: 'text', label: 'Text', icon: 'type', renderer: '2d' },
  { id: 'physicsBox', label: 'Physics box', icon: 'atom', renderer: '2d' },
  { id: 'camera', label: 'Camera', icon: 'camera', renderer: '2d' },
  { id: 'light', label: 'Light 2D', icon: 'sun', renderer: '2d' },
  { id: 'tilemap', label: 'Tilemap', icon: 'grid', renderer: '2d' },
  { id: 'particles', label: 'Particle emitter', icon: 'sparkles', renderer: '2d' },
  { id: 'cube', label: 'Cube', icon: 'box', renderer: '3d' },
  { id: 'sphere', label: 'Sphere', icon: 'circle', renderer: '3d' },
  { id: 'plane', label: 'Plane', icon: 'grid', renderer: '3d' },
  { id: 'cylinder', label: 'Cylinder', icon: 'box', renderer: '3d' },
  { id: 'camera3d', label: 'Camera', icon: 'camera', renderer: '3d' },
  { id: 'light3d', label: 'Directional light', icon: 'sun', renderer: '3d' },
  { id: 'pointLight', label: 'Point light', icon: 'sun', renderer: '3d' },
];

/** Build a snapshot for a preset at a world position. */
export function makePreset(preset: EntityPreset, opts: { position?: { x: number; y: number; z?: number }; parent?: string | null; name?: string; texture?: string } = {}): EntitySnapshot {
  const pos = { x: opts.position?.x ?? 0, y: opts.position?.y ?? 0, z: opts.position?.z ?? 0 };
  const comps: ComponentData[] = [{ type: 'Transform', data: { position: pos } }];
  let name = opts.name ?? 'Entity';
  const add = (type: string, data: Record<string, unknown> = {}): void => { comps.push({ type, data }); };
  switch (preset) {
    case 'sprite': name = opts.name ?? 'Sprite'; add('Sprite', { texture: opts.texture ?? '', width: opts.texture ? 0 : 1, height: opts.texture ? 0 : 1 }); break;
    case 'shape': name = opts.name ?? 'Shape'; add('Shape', { kind: 'rect', width: 1, height: 1, fill: { r: 0.3, g: 0.76, b: 1, a: 1 } }); break;
    case 'circle': name = opts.name ?? 'Circle'; add('Shape', { kind: 'circle', radius: 0.5, fill: { r: 1, g: 0.48, b: 0.24, a: 1 } }); break;
    case 'text': name = opts.name ?? 'Text'; add('Text', { text: 'Hello', size: 0.6 }); break;
    case 'physicsBox': name = opts.name ?? 'Box'; add('Shape', { kind: 'rect', width: 1, height: 1, fill: { r: 0.55, g: 0.49, b: 1, a: 1 } }); add('RigidBody2D', { bodyType: 'dynamic' }); add('BoxCollider2D', { width: 1, height: 1 }); break;
    case 'camera': name = opts.name ?? 'Camera'; add('Camera2D', {}); break;
    case 'light': name = opts.name ?? 'Light'; add('Light2D', {}); break;
    case 'tilemap': name = opts.name ?? 'Tilemap'; add('Tilemap', { width: 16, height: 8 }); break;
    case 'particles': name = opts.name ?? 'Particles'; add('ParticleEmitter', {}); break;
    case 'cube': name = opts.name ?? 'Cube'; add('MeshRenderer', { mesh: 'cube', color: { r: 0.9, g: 0.5, b: 0.3, a: 1 } }); break;
    case 'sphere': name = opts.name ?? 'Sphere'; add('MeshRenderer', { mesh: 'sphere', color: { r: 0.4, g: 0.7, b: 1, a: 1 } }); break;
    case 'plane': name = opts.name ?? 'Plane'; add('MeshRenderer', { mesh: 'plane', color: { r: 0.5, g: 0.6, b: 0.5, a: 1 } }); comps[0].data.scale = { x: 5, y: 1, z: 5 }; break;
    case 'cylinder': name = opts.name ?? 'Cylinder'; add('MeshRenderer', { mesh: 'cylinder', color: { r: 0.8, g: 0.8, b: 0.4, a: 1 } }); break;
    case 'camera3d': name = opts.name ?? 'Camera'; comps[0].data.position = { x: pos.x + 6, y: pos.y + 5, z: pos.z + 8 }; add('Camera3D', {}); break;
    case 'light3d': name = opts.name ?? 'Sun'; comps[0].data.position = { x: 0, y: 10, z: 0 }; comps[0].data.rotation = { x: -0.5, y: 0.3, z: 0.15, w: 0.79 }; add('Light', { kind: 'directional', intensity: 1.2 }); break;
    case 'pointLight': name = opts.name ?? 'Point light'; add('Light', { kind: 'point', range: 10 }); break;
    case 'empty': default: break;
  }
  return { guid: shortId(10), name, parent: opts.parent ?? null, index: -1, components: comps, children: [] };
}
