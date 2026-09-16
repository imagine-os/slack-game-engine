import { SystemBase } from '../core/ecs/System';
import { Transform } from '../core/ecs/Transform';
import type { World } from '../core/ecs/World';
import type { AssetManager } from '../assets/AssetManager';
import type { AudioEngine } from './AudioEngine';
import { AudioListener, AudioSource } from './components';

/** Drives AudioSource/AudioListener components each frame. */
export class AudioSystem extends SystemBase {
  readonly name = 'AudioSystem';
  readonly phase = 'lateUpdate' as const;
  override readonly priority = 500;

  constructor(private audio: AudioEngine, private assets: AssetManager) {
    super();
  }

  override update(world: World): void {
    const listeners = world.query([AudioListener, Transform]).entities;
    if (listeners.length) {
      const t = world.getComponent(listeners[0], Transform)!;
      this.audio.setListener(t.worldMatrix.m[12], t.worldMatrix.m[13]);
    }
    world.each(AudioSource, Transform, (_e, src, t) => {
      if ((src.playOnStart && !src._started) || src.playRequested) {
        src._started = true;
        src.playRequested = false;
        const buffer = this.assets.get<AudioBuffer>(src.clip);
        if (buffer) {
          src.handle = this.audio.play(buffer, {
            volume: src.volume,
            pitch: src.pitch,
            pitchVariation: src.pitchVariation,
            loop: src.loop,
            bus: src.bus,
            maxDistance: src.maxDistance,
            position: src.spatial ? { x: t.worldMatrix.m[12], y: t.worldMatrix.m[13] } : undefined,
          });
        }
      }
      if (src.handle?.playing && src.handle.position) {
        src.handle.position.x = t.worldMatrix.m[12];
        src.handle.position.y = t.worldMatrix.m[13];
        src.handle.refresh();
      }
    });
  }
}
