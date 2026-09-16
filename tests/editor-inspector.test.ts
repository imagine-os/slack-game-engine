// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createFieldRow, numberInput, type FieldContext } from '../src/editor/inspector/fields';
import { Quat } from '../src/core/math';

const ctx: FieldContext = {
  assets: (kind) => [{ id: 'hero', kind: 'image', url: 'data:,' }, { id: 'jump', kind: 'audio', url: 'data:,' }].filter((a) => !kind || a.kind === kind),
  refName: (ref) => (ref ? `Entity ${(ref as { $ref: string }).$ref}` : '(none)'),
  pickEntity: () => Promise.resolve({ $ref: 'picked' }),
  revealRef: () => undefined,
  is3d: false,
};

function fire(el: Element, type: string): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

describe('Inspector field editors', () => {
  it('number: commits typed values, clamps, evaluates arithmetic and steps with arrows', () => {
    const changes: [number, boolean][] = [];
    const n = numberInput(1, (v, live) => changes.push([v, live]), { min: 0, max: 10, step: 0.5 });
    const input = n.root.querySelector('input.num-input') as HTMLInputElement;
    input.value = '4.25';
    fire(input, 'change');
    expect(changes.at(-1)).toEqual([4.25, false]);
    input.value = '+=2';
    fire(input, 'change');
    expect(changes.at(-1)![0]).toBe(6.25);
    input.value = '99';
    fire(input, 'change');
    expect(changes.at(-1)![0]).toBe(10); // clamped
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(changes.at(-1)![0]).toBe(9.5);
    n.set(3, true);
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('—');
    const slider = n.root.querySelector('input[type=range]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    slider.value = '2';
    fire(slider, 'input');
    expect(changes.at(-1)).toEqual([2, true]);
  });

  it('vec3 / quat / color / enum / boolean / entity editors round-trip values', () => {
    const vals: unknown[] = [];
    const vec = createFieldRow({ meta: { type: 'vec3' }, label: 'Position', value: { x: 1, y: 2, z: 3 }, onChange: (v) => vals.push(v), context: ctx });
    const inputs = vec.root.querySelectorAll<HTMLInputElement>('input.num-input');
    expect(inputs.length).toBe(3);
    inputs[1].value = '7';
    fire(inputs[1], 'change');
    expect(vals.at(-1)).toEqual({ x: 1, y: 7, z: 3 });
    vec.update({ x: 0, y: 0, z: 9 });
    expect(inputs[2].value).toBe('9');

    const q = createFieldRow({ meta: { type: 'quat' }, label: 'Angle', value: Quat.fromAngle2D(Math.PI / 2).toJSON(), onChange: (v) => vals.push(v), context: ctx });
    const angle = q.root.querySelector<HTMLInputElement>('input.num-input')!;
    expect(Number(angle.value)).toBeCloseTo(90, 3);
    angle.value = '180';
    fire(angle, 'change');
    const out = vals.at(-1) as { x: number; y: number; z: number; w: number };
    expect(new Quat(out.x, out.y, out.z, out.w).angle2D()).toBeCloseTo(Math.PI, 4);

    const color = createFieldRow({ meta: { type: 'color' }, label: 'Tint', value: { r: 1, g: 0, b: 0, a: 1 }, onChange: (v) => vals.push(v), context: ctx });
    const hex = color.root.querySelector<HTMLInputElement>('.color-hex')!;
    expect(hex.value.toLowerCase()).toBe('#ff0000');
    hex.value = '#00ff00';
    fire(hex, 'change');
    expect(vals.at(-1)).toMatchObject({ r: 0, g: 1, b: 0, a: 1 });

    const en = createFieldRow({ meta: { type: 'enum', options: ['normal', 'add'] }, label: 'Blend', value: 'normal', onChange: (v) => vals.push(v), context: ctx });
    const select = en.root.querySelector('select')!;
    select.value = 'add';
    fire(select, 'change');
    expect(vals.at(-1)).toBe('add');
    en.update('normal', true);
    expect(select.value).toBe('__mixed');

    const bool = createFieldRow({ meta: { type: 'boolean' }, label: 'Visible', value: true, onChange: (v) => vals.push(v), context: ctx });
    const cb = bool.root.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    cb.checked = false;
    fire(cb, 'change');
    expect(vals.at(-1)).toBe(false);

    const asset = createFieldRow({ meta: { type: 'asset', assetKind: 'image' }, label: 'Texture', value: '', onChange: (v) => vals.push(v), context: ctx });
    const as = asset.root.querySelector('select')!;
    expect(Array.from(as.options).map((o) => o.value)).toEqual(['', 'hero']);
    as.value = 'hero';
    fire(as, 'change');
    expect(vals.at(-1)).toBe('hero');
  });

  it('entity picker resolves through the context and json validates input', async () => {
    const vals: unknown[] = [];
    const ent = createFieldRow({ meta: { type: 'entity' }, label: 'Follow', value: null, onChange: (v) => vals.push(v), context: ctx });
    expect(ent.root.querySelector('.entity-ref')!.textContent).toBe('(none)');
    (ent.root.querySelector('[aria-label="Pick entity"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(vals.at(-1)).toEqual({ $ref: 'picked' });
    expect(ent.root.querySelector('.entity-ref')!.textContent).toBe('Entity picked');
    (ent.root.querySelector('[aria-label="Clear reference"]') as HTMLButtonElement).click();
    expect(vals.at(-1)).toBeNull();

    const json = createFieldRow({ meta: { type: 'json' }, label: 'Points', value: [1, 2], onChange: (v) => vals.push(v), context: ctx });
    const ta = json.root.querySelector('textarea')!;
    ta.value = '[1, 2, 3';
    fire(ta, 'change');
    expect(json.root.querySelector('.field-error')!.textContent).toContain('Invalid JSON');
    const before = vals.length;
    expect(vals.length).toBe(before);
    ta.value = '[1, 2, 3]';
    fire(ta, 'change');
    expect(vals.at(-1)).toEqual([1, 2, 3]);
  });
});
