/**
 * Every bundled demo must load headlessly, run 300 fixed steps without script
 * errors and keep its key entities, both offline and with a fake two-player
 * NetSync. The generator output must also match the committed JSON so nobody
 * forgets `npm run build:demos`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Engine, EventEmitter, PlayerInput, instantiatePrefab, normalizeProject, runProject,
  type Diagnostic, type Entity, type InputSnapshot, type NetSync, type NetSyncEvents, type NetSyncOptions, type Project,
} from '../src/index';
import { DEMOS_DIR, generateAll, stalePaths } from '../scripts/build-demos';

const ids = readdirSync(DEMOS_DIR).filter((d) => existsSync(join(DEMOS_DIR, d, 'project.json'))).sort();

/** Entities (by name or `tag:` prefix) that must exist after the warm-up. */
const KEY_ENTITIES: Record<string, string[]> = {
  'arena-blasters': ['Camera', 'GameManager', 'Ship local', 'tag:asteroid'],
  'sky-hoppers': ['Camera', 'Camera Target', 'Level', 'Hopper local', 'Goal Flag', 'tag:coin', 'tag:checkpoint'],
  'paddle-rush': ['Camera', 'GameManager', 'Paddle Left', 'Paddle Right', 'Puck', 'Goal Left', 'Goal Right'],
  'cube-racers': ['Camera', 'GameManager', 'Kart local', 'Checkpoint 0', 'Checkpoint 3', 'tag:checkpoint'],
  'tower-together': ['Camera', 'GameManager', 'Builder local', 'Base', 'Portal'],
  'starter-2d': ['Camera', 'Player', 'Ground'],
  'starter-3d': ['Camera', 'Cube', 'Ground', 'Sun'],
};

function loadProject(id: string): Project {
  return normalizeProject(JSON.parse(readFileSync(join(DEMOS_DIR, id, 'project.json'), 'utf8')));
}

function headlessEngine(): { engine: Engine; errors: Diagnostic[] } {
  const engine = Engine.create(null, { renderer: 'none', audio: false, seed: 1 });
  // No DOM/network in tests: assets resolve to placeholders.
  engine.assets.registerLoader('image', async () => ({ width: 1, height: 1 }));
  engine.assets.registerLoader('audio', async () => ({}));
  const errors: Diagnostic[] = [];
  engine.diagnostics.on('error', (d) => errors.push(d));
  return { engine, errors };
}

function expectEntities(engine: Engine, id: string): void {
  for (const key of KEY_ENTITIES[id] ?? ['Camera']) {
    if (key.startsWith('tag:')) expect(engine.world.findByTag(key.slice(4)).length, `${id}: entities tagged ${key.slice(4)}`).toBeGreaterThan(0);
    else expect(engine.world.findByName(key), `${id}: entity "${key}"`).toBeDefined();
  }
}

/**
 * Minimal NetSync double: two peers ('local' is host, 'p2' a client). Spawns
 * prefabs locally and assigns ownership the way a real implementation would.
 */
class FakeSync implements NetSync {
  readonly options: NetSyncOptions = { mode: 'host-authoritative', tickRate: 20, maxPlayers: 8, sharedControl: true, mergeStrategy: 'average' };
  tick = 0;
  readonly events = new EventEmitter<NetSyncEvents>();
  readonly spawned: { prefab: string; ownerId: string }[] = [];
  readonly shared: { entity: Entity; peerId: string; enabled: boolean }[] = [];
  peers = ['local', 'p2'];
  constructor(private engine: Engine) {}
  get transport() { return this.engine.net.transport; }
  get isHost() { return true; }
  get localId() { return 'local'; }
  start(): void {}
  stop(): void {}
  update(): void {}
  fixedUpdate(): void { this.tick++; }
  spawn(prefab: string, opts: { ownerId?: string; position?: { x: number; y: number; z?: number } } = {}): Entity {
    const data = this.engine.prefabs.get(prefab);
    if (!data) throw new Error(`prefab ${prefab} missing`);
    const e = instantiatePrefab(this.engine.world, data, { position: opts.position });
    const pi = this.engine.world.getComponent(e, PlayerInput);
    if (pi && opts.ownerId) pi.owner = opts.ownerId;
    this.spawned.push({ prefab, ownerId: opts.ownerId ?? 'host' });
    return e;
  }
  despawn(entity: Entity): void { if (this.engine.world.isAlive(entity)) this.engine.world.destroyEntityDeferred(entity); }
  setOwner(): void {}
  shareControl(entity: Entity, peerId: string, enabled: boolean): void { this.shared.push({ entity, peerId, enabled }); }
  submitInput(_s: InputSnapshot): void {}
  inputFor(): InputSnapshot | undefined { return undefined; }
  onRpc(): () => void { return () => {}; }
  rpc(): void {}
  on<K extends keyof NetSyncEvents>(event: K, fn: (payload: NetSyncEvents[K]) => void): () => void { return this.events.on(event, fn); }
  players() { return this.peers.map((peerId) => ({ peerId, displayName: peerId, isHost: peerId === 'local' })); }
}

describe('bundled demos (headless)', () => {
  it('lists every demo folder in index.json', () => {
    const index = JSON.parse(readFileSync(join(DEMOS_DIR, 'index.json'), 'utf8')) as { demos: { id: string; name: string; renderer: string; players: { min: number; max: number }; controls: string[] }[] };
    expect(index.demos.map((d) => d.id).sort()).toEqual(ids);
    for (const d of index.demos) {
      expect(d.name).toBeTruthy();
      expect(['2d', '3d']).toContain(d.renderer);
      expect(d.players.min).toBeGreaterThan(0);
      expect(d.players.max).toBeGreaterThanOrEqual(d.players.min);
      expect(d.controls.length).toBeGreaterThan(0);
      for (const f of ['project.json', 'README.md', 'thumbnail.svg']) expect(existsSync(join(DEMOS_DIR, d.id, f)), `${d.id}/${f}`).toBe(true);
    }
  });

  for (const id of ids) {
    it(`${id}: runs 300 fixed steps offline without script errors`, async () => {
      const project = loadProject(id);
      const { engine, errors } = headlessEngine();
      await runProject(engine, project);
      expect(engine.scripting.names().sort()).toEqual(project.scripts.map((s) => s.name).sort());
      for (let i = 0; i < 300; i++) engine.step(1 / 60);
      expect(errors.map((e) => e.message)).toEqual([]);
      expect(engine.clock.tick).toBe(300);
      expectEntities(engine, id);
      // Every script prop has a type and a default (what the editor's inspector needs).
      for (const def of engine.scripting.definitions.values()) {
        for (const [k, p] of Object.entries(def.props ?? {})) {
          expect(p.type, `${def.name}.${k}.type`).toBeTruthy();
          expect(p, `${def.name}.${k}.default`).toHaveProperty('default');
        }
      }
      engine.dispose();
    });
  }

  for (const id of ids.filter((d) => loadProject(d).settings.network.mode !== 'none')) {
    it(`${id}: spawns per-player entities through NetSync for a second peer`, async () => {
      const project = loadProject(id);
      const { engine, errors } = headlessEngine();
      const sync = new FakeSync(engine);
      engine.net.setSync(sync);
      await runProject(engine, project);
      for (let i = 0; i < 120; i++) engine.step(1 / 60);
      // A third peer joins mid-game and later leaves.
      sync.peers.push('p3');
      sync.events.emit('playerJoined', { peerId: 'p3', displayName: 'p3' });
      for (let i = 0; i < 60; i++) engine.step(1 / 60);
      sync.events.emit('playerLeft', { peerId: 'p3' });
      for (let i = 0; i < 60; i++) engine.step(1 / 60);
      expect(errors.map((e) => e.message)).toEqual([]);
      const owners = new Set<string>();
      for (const pi of engine.world.componentsOfType(PlayerInput)) { owners.add(pi.owner); for (const c of pi.coOwners) owners.add(c); }
      expect(owners.has('local'), `${id}: local peer controls something`).toBe(true);
      expect(owners.has('p2'), `${id}: remote peer p2 controls something`).toBe(true);
      expect(owners.has('p3'), `${id}: p3 released control after leaving`).toBe(false);
      if (id !== 'paddle-rush') {
        // Player prefabs were spawned through the sync layer with the right owner.
        expect(sync.spawned.filter((s) => s.ownerId === 'p2').length).toBeGreaterThan(0);
        expect(engine.world.componentsOfType(PlayerInput).filter((pi) => pi.owner === 'p3').length).toBe(0);
      } else {
        // Team mode: peers share paddles via coOwners and shareControl.
        sync.peers.push('p4');
        sync.events.emit('playerJoined', { peerId: 'p4', displayName: 'p4' });
        engine.step(1 / 60);
        const paddles = engine.world.componentsOfType(PlayerInput);
        const shared = paddles.filter((pi) => pi.coOwners.length > 0);
        expect(shared.length).toBeGreaterThan(0);
        expect(sync.shared.some((s) => s.peerId === 'p4' && s.enabled)).toBe(true);
        expect(paddles.every((pi) => pi.mergeStrategy === 'average')).toBe(true);
      }
      engine.dispose();
    });
  }
});

describe('demo generator', () => {
  it('matches the committed public/demos output (run `npm run build:demos` after editing demos/src)', () => {
    const out = generateAll();
    expect(stalePaths(out)).toEqual([]);
    expect(out.bundles.map((b) => b.id).sort()).toEqual(ids);
  });
});
