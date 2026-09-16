import { Component } from '../core/ecs/Component';
import { registerComponent } from '../core/ecs/Registry';
import type { SoundHandle } from './AudioEngine';

/** Plays an audio asset from this entity's position. */
export class AudioSource extends Component {
  static override readonly type = 'AudioSource';
  /** Asset id of a loaded `audio` asset. */
  clip = '';
  volume = 1;
  pitch = 1;
  pitchVariation = 0;
  loop = false;
  /** Start playing when the entity is created. */
  playOnStart = true;
  /** Attenuate and pan by distance to the AudioListener. */
  spatial = true;
  maxDistance = 20;
  bus: 'sfx' | 'music' = 'sfx';

  /** Live handle (runtime only). */
  handle: SoundHandle | null = null;
  /** Set to true to trigger playback on the next update. */
  playRequested = false;
  /** @internal */
  _started = false;

  /** Request playback (processed by the AudioSystem). */
  play(): void {
    this.playRequested = true;
  }

  stop(fade = 0): void {
    this.handle?.stop(fade);
    this.handle = null;
  }

  get playing(): boolean {
    return this.handle?.playing ?? false;
  }
}
registerComponent(AudioSource, {
  category: 'Audio',
  description: 'Plays a sound clip, optionally positional.',
  icon: 'volume',
  fields: {
    clip: { type: 'asset', assetKind: 'audio' },
    volume: { type: 'number', min: 0, max: 1, step: 0.01 },
    pitch: { type: 'number', min: 0.1, max: 4, step: 0.01 },
    pitchVariation: { type: 'number', min: 0, max: 1, step: 0.01 },
    bus: { type: 'enum', options: ['sfx', 'music'] },
    handle: { type: 'json', transient: true, hidden: true },
    playRequested: { type: 'boolean', transient: true, hidden: true },
  },
});

/** Marks the entity whose position is the audio listener (usually the camera). */
export class AudioListener extends Component {
  static override readonly type = 'AudioListener';
  enabled = true;
}
registerComponent(AudioListener, { category: 'Audio', description: 'Position used for spatial audio.', icon: 'ear' });
