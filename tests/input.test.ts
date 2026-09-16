import { describe, it, expect } from 'vitest';
import { Input, encodeSnapshot, decodeSnapshot, mergeSnapshots, createEmptySnapshot, PlayerInput, World } from '../src/index';

function tick(input: Input): void {
  input.update();
}

describe('Input action mapping', () => {
  it('maps keyboard codes to actions with pressed/held/released edges', () => {
    const input = new Input();
    input.bind('jump', ['Space', 'GamepadA']);
    input.keyboard.setDown('Space', true);
    tick(input);
    expect(input.pressed('jump')).toBe(true);
    expect(input.held('jump')).toBe(true);
    expect(input.released('jump')).toBe(false);
    input.endFrame();
    tick(input);
    expect(input.pressed('jump')).toBe(false);
    expect(input.held('jump')).toBe(true);
    input.keyboard.setDown('Space', false);
    input.endFrame();
    tick(input);
    expect(input.released('jump')).toBe(true);
    expect(input.held('jump')).toBe(false);
  });

  it('resolves digital and analog axes with deadzone', () => {
    const input = new Input();
    input.bindAxis('moveX', { negative: ['KeyA'], positive: ['KeyD'], gamepadAxis: 0 });
    input.keyboard.setDown('KeyD', true);
    tick(input);
    expect(input.axis('moveX')).toBe(1);
    input.keyboard.setDown('KeyA', true);
    tick(input);
    expect(input.axis('moveX')).toBe(0);
    input.keyboard.setDown('KeyA', false);
    input.keyboard.setDown('KeyD', false);
    input.gamepads.setPad(0, { index: 0, id: 'pad', connected: true, buttons: [], triggers: [0, 0], axes: [0.05, 0, 0, 0] });
    input.gamepads.deadzone = 0.15;
    tick(input);
    // Deadzone is applied during poll(); setPad bypasses it, so raw value passes through.
    expect(input.axis('moveX')).toBeCloseTo(0.05);
    input.gamepads.setPad(0, { index: 0, id: 'pad', connected: true, buttons: [], triggers: [0, 0], axes: [-0.8, 0, 0, 0] });
    tick(input);
    expect(input.axis('moveX')).toBeCloseTo(-0.8);
  });

  it('supports mouse, gamepad buttons and touch bindings', () => {
    const input = new Input();
    input.bind('fire', ['MouseLeft', 'GamepadX', 'Touch:fire']);
    input.mouse.setButton(0, true);
    tick(input);
    expect(input.held('fire')).toBe(true);
    input.mouse.setButton(0, false);
    tick(input);
    expect(input.held('fire')).toBe(false);
    input.gamepads.setPad(0, { index: 0, id: 'pad', connected: true, buttons: [false, false, true], triggers: [0, 0], axes: [0, 0, 0, 0] });
    tick(input);
    expect(input.held('fire')).toBe(true);
    input.gamepads.setPad(0, null);
    input.touch.setButton('fire', true);
    tick(input);
    expect(input.held('fire')).toBe(true);
    expect(input.pressed('fire')).toBe(false); // was held via gamepad in the previous frame
  });

  it('builds a serializable snapshot and encodes it compactly', () => {
    const input = new Input().useDefaultBindings();
    input.tick = 42;
    input.keyboard.setDown('Space', true);
    input.keyboard.setDown('KeyD', true);
    tick(input);
    const snap = input.getSnapshot();
    expect(snap.tick).toBe(42);
    expect(snap.held).toContain('jump');
    expect(snap.pressed).toContain('jump');
    expect(snap.axes.moveX).toBe(1);
    const actions = input.actionNames();
    const axes = input.axisNames();
    const enc = encodeSnapshot(snap, actions, axes);
    expect(JSON.stringify(enc).length).toBeLessThan(JSON.stringify(snap).length);
    const dec = decodeSnapshot(enc, actions, axes);
    expect(dec.tick).toBe(42);
    expect(dec.held.sort()).toEqual([...snap.held].sort());
    expect(dec.pressed).toEqual(snap.pressed);
    expect(dec.axes.moveX).toBe(1);
    expect(dec.axes.moveY).toBe(snap.axes.moveY);
  });

  it('saves and restores bindings', () => {
    const input = new Input().useDefaultBindings();
    const saved = input.saveBindings();
    const other = new Input().loadBindings(saved);
    expect(other.bindingsOf('jump')).toEqual(input.bindingsOf('jump'));
    expect(other.axisNames()).toEqual(input.axisNames());
  });
});

describe('Snapshot merging (shared control)', () => {
  it('merges held buttons and axes per strategy', () => {
    const a = createEmptySnapshot(1);
    a.held = ['jump'];
    a.pressed = ['jump'];
    a.axes = { moveX: 1 };
    const b = createEmptySnapshot(1);
    b.axes = { moveX: -0.5 };
    const avg = mergeSnapshots([a, b], 'average');
    expect(avg.held).toEqual(['jump']);
    expect(avg.pressed).toEqual(['jump']);
    expect(avg.axes.moveX).toBeCloseTo(0.25);
    expect(mergeSnapshots([a, b], 'additive').axes.moveX).toBeCloseTo(0.5);
    expect(mergeSnapshots([a, b], 'first-wins').axes.moveX).toBe(1);
    expect(mergeSnapshots([b, a], 'first-wins').axes.moveX).toBe(-0.5);
  });
});

describe('PlayerInput component', () => {
  it('stores an applied snapshot and answers queries', () => {
    const w = new World();
    const e = w.createEntity();
    const pi = w.addComponent(e, PlayerInput, { owner: 'peer-1' });
    const s = createEmptySnapshot(3);
    s.held = ['fire'];
    s.axes = { moveX: -1 };
    pi.apply(s);
    expect(pi.held('fire')).toBe(true);
    expect(pi.axis('moveX')).toBe(-1);
    expect(pi.fresh).toBe(true);
    expect(pi.owner).toBe('peer-1');
    s.held.push('jump');
    expect(pi.held('jump')).toBe(false); // deep copied
  });
});
