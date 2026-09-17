import type { SceneData } from '../core/ecs/Scene';
import type { PrefabData } from '../core/ecs/Scene';
import type { AssetManifest } from '../assets/types';
import type { ScriptSource } from '../scripting/types';
import type { AxisBinding, Binding } from '../input/Input';
import type { NetworkMode } from '../net/NetSync';
import type { InputMergeStrategy } from '../input/InputSnapshot';

/** Current project schema version. */
export const PROJECT_VERSION = 1;

export interface ProjectSettings {
  renderer: '2d' | '3d';
  pixelsPerUnit: number;
  pixelPerfect: boolean;
  /** Fixed simulation rate in Hz. */
  fixedRate: number;
  /** Design resolution hint for the editor/player (CSS px). */
  viewport: { width: number; height: number };
  physics: { gravity: { x: number; y: number }; gravity3d: { x: number; y: number; z: number } };
  network: { mode: NetworkMode; maxPlayers: number; tickRate: number };
  multiUser: { sharedControl: boolean; mergeStrategy: InputMergeStrategy };
  input: { actions: Record<string, Binding[]>; axes: Record<string, AxisBinding> };
  /** Show the touch overlay on mobile. */
  touchControls: boolean;
  /** Names of touch buttons (become `Touch:<name>` bindings). */
  touchButtons: string[];
  /**
   * Optional renderer options passed to `Engine.create` (`RendererOptions`):
   * 3D quality knobs such as `autoQuality`, `shadows`, `shadowMapSize`,
   * `renderScale`. Absent in older projects.
   */
  render?: { autoQuality?: boolean; shadows?: boolean; shadowMapSize?: number; renderScale?: number };
}

/** Full project document as stored/exported. */
export interface Project {
  id: string;
  name: string;
  /** Schema version (see PROJECT_VERSION). */
  version: number;
  /** Author-defined project version string. */
  projectVersion: string;
  description: string;
  author: string;
  /** Data URL or path of a thumbnail. */
  thumbnail: string;
  createdAt: string;
  updatedAt: string;
  scenes: SceneData[];
  /** Name of the scene to load first. */
  startScene: string;
  scripts: ScriptSource[];
  prefabs: PrefabData[];
  assets: AssetManifest;
  settings: ProjectSettings;
}

/** Lightweight row for project listings. */
export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  updatedAt: string;
  renderer: '2d' | '3d';
}
