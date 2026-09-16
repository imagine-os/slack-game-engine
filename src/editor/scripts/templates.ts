/** Starter scripts offered by the Scripts panel. */
export interface ScriptTemplate { id: string; label: string; /** Default script name (PascalCase). */ name: string; description: string; source: (name: string) => string }

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'blank', name: 'NewScript', label: 'Blank script', description: 'Empty defineScript with the common hooks.',
    source: (name) => `defineScript({
  name: '${name}',
  props: {},

  onStart(ctx) {
  },

  onUpdate(ctx, dt) {
  },
});
`,
  },
  {
    id: 'player', name: 'PlayerController', label: 'Player controller', description: '2D platformer movement with jump, multiplayer-safe (uses onOwnerInput).',
    source: (name) => `defineScript({
  name: '${name}',
  description: 'Platformer controller. Requires RigidBody2D + a collider + PlayerInput + CharacterController2D.',
  props: {
    speed: { type: 'number', default: 6, min: 0, max: 30 },
    jumpSpeed: { type: 'number', default: 12, min: 0, max: 40 },
  },

  onStart(ctx) {
    const cc = ctx.get('CharacterController2D');
    if (cc) { cc.moveSpeed = ctx.props.speed; cc.jumpSpeed = ctx.props.jumpSpeed; }
  },

  // Called with the input of whoever controls this entity (local or remote).
  onOwnerInput(ctx, input, dt) {
    const cc = ctx.get('CharacterController2D');
    if (!cc) return;
    cc.move(input.axes.moveX ?? 0);
    if (input.pressed.includes('jump')) cc.jump();
    if (input.released.includes('jump')) cc.jumpReleased();
  },
});
`,
  },
  {
    id: 'spawner', name: 'Spawner', label: 'Spawner', description: 'Spawns a prefab on a timer.',
    source: (name) => `defineScript({
  name: '${name}',
  props: {
    prefab: { type: 'string', default: 'Enemy' },
    interval: { type: 'number', default: 2, min: 0.1, max: 60 },
    maxAlive: { type: 'integer', default: 10, min: 1, max: 200 },
    spread: { type: 'number', default: 3 },
  },

  onStart(ctx) {
    ctx.state.alive = [];
    ctx.timer(ctx.props.interval, () => this.spawn(ctx), true);
  },

  spawn(ctx) {
    const alive = ctx.state.alive.filter((e) => ctx.world.isAlive(e));
    ctx.state.alive = alive;
    if (alive.length >= ctx.props.maxAlive) return;
    if (!ctx.engine.prefabs.has(ctx.props.prefab)) { ctx.warn('Prefab not found: ' + ctx.props.prefab); return; }
    const p = ctx.transform.getWorldPosition();
    const e = ctx.spawn(ctx.props.prefab, { position: { x: p.x + ctx.random.range(-ctx.props.spread, ctx.props.spread), y: p.y } });
    alive.push(e);
  },
});
`,
  },
  {
    id: 'trigger', name: 'TriggerZone', label: 'Trigger zone', description: 'Sends a message when something enters a trigger collider.',
    source: (name) => `defineScript({
  name: '${name}',
  description: 'Attach to an entity with a collider marked isTrigger.',
  props: {
    message: { type: 'string', default: 'zone-entered' },
    once: { type: 'boolean', default: false },
    tag: { type: 'string', default: '' },
  },

  onTriggerEnter(ctx, other) {
    if (ctx.state.fired && ctx.props.once) return;
    if (ctx.props.tag) {
      const t = ctx.getOn(other, 'Tag');
      if (!t || !t.has(ctx.props.tag)) return;
    }
    ctx.state.fired = true;
    ctx.send(ctx.props.message, { zone: ctx.entity, other });
    ctx.log('Trigger: ' + ctx.nameOf(other));
  },
});
`,
  },
  {
    id: 'cameraFollow', name: 'CameraFollow', label: 'Camera follow', description: 'Smoothly follows a target entity (2D).',
    source: (name) => `defineScript({
  name: '${name}',
  props: {
    targetName: { type: 'string', default: 'Player' },
    smoothing: { type: 'number', default: 6, min: 0, max: 30 },
    offsetY: { type: 'number', default: 1 },
  },

  onLateUpdate(ctx, dt) {
    const target = ctx.find(ctx.props.targetName);
    if (target === undefined) return;
    const tp = ctx.getOn(target, 'Transform').getWorldPosition();
    const t = ctx.transform;
    const k = 1 - Math.exp(-ctx.props.smoothing * dt);
    t.x += (tp.x - t.x) * k;
    t.y += (tp.y + ctx.props.offsetY - t.y) * k;
  },
});
`,
  },
  {
    id: 'netPlayer', name: 'NetPlayer', label: 'Net player', description: 'Top-down movement replicated across peers; reacts to ownership.',
    source: (name) => `defineScript({
  name: '${name}',
  description: 'Requires PlayerInput (owner = peer id) and optionally NetworkIdentity/NetTransform.',
  props: {
    speed: { type: 'number', default: 5 },
  },

  onNetSpawn(ctx, ownerId) {
    ctx.log('Spawned for ' + ownerId + (ctx.net.isOwner() ? ' (mine)' : ''));
    const shape = ctx.get('Shape');
    if (shape && ctx.net.isOwner()) shape.fill.set(0.3, 1, 0.5, 1);
  },

  onOwnerInput(ctx, input, dt) {
    const x = input.axes.moveX ?? 0;
    const y = input.axes.moveY ?? 0;
    ctx.transform.translate(x * ctx.props.speed * dt, y * ctx.props.speed * dt);
    if (input.pressed.includes('fire')) ctx.net.rpc('fire', [ctx.transform.x, ctx.transform.y]);
  },

  onRpc(ctx, name, args, from) {
    if (name === 'fire') ctx.log(from + ' fired at ' + args.join(', '));
  },
});
`,
  },
  {
    id: 'gameManager', name: 'GameManager', label: 'Game manager', description: 'Score, lives and restart handling via messages.',
    source: (name) => `defineScript({
  name: '${name}',
  props: {
    lives: { type: 'integer', default: 3, min: 1, max: 99 },
    scoreLabel: { type: 'string', default: 'Score' },
  },

  onStart(ctx) {
    ctx.state.score = 0;
    ctx.state.lives = ctx.props.lives;
    this.refresh(ctx);
  },

  onMessage(ctx, name, data) {
    if (name === 'score') { ctx.state.score += data?.amount ?? 1; this.refresh(ctx); }
    if (name === 'player-died') {
      ctx.state.lives -= 1;
      this.refresh(ctx);
      if (ctx.state.lives <= 0) ctx.send('game-over');
    }
  },

  refresh(ctx) {
    const label = ctx.find(ctx.props.scoreLabel);
    const text = label !== undefined ? ctx.getOn(label, 'Text') : undefined;
    if (text) text.text = 'Score ' + ctx.state.score + '  Lives ' + ctx.state.lives;
  },
});
`,
  },
];
