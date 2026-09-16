import type { AssetManifestEntry, AtlasJSON } from '../../assets/types';
import { el } from '../ui/dom';
import { openDialog } from '../ui/Dialog';

export interface AtlasResult { entry: AssetManifestEntry; frameCount: number }

/**
 * Grid slicing dialog: turns an image asset into an atlas asset (frames
 * `prefix0..N`, optional animation) stored as a data-URL JSON manifest entry.
 */
export function openAtlasEditor(image: { id: string; url: string }, existingIds: string[], onDone: (result: AtlasResult) => void): void {
  const img = new Image();
  const canvas = el('canvas', { class: 'atlas-canvas' });
  const ctx = canvas.getContext('2d')!;
  const params = { tileW: 32, tileH: 32, margin: 0, spacing: 0, prefix: 'frame', anim: '', fps: 12, pivotX: 0.5, pivotY: 0.5 };
  const info = el('div', { class: 'dim small' });
  const num = (label: string, key: keyof typeof params, min = 0, step = 1): HTMLElement => {
    const input = el('input', { class: 'num-input', attrs: { type: 'number', min: String(min), step: String(step), value: String(params[key]), 'aria-label': label } });
    input.addEventListener('input', () => { (params as Record<string, unknown>)[key] = Number(input.value) || 0; draw(); });
    return el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: label }), input);
  };
  const text = (label: string, key: 'prefix' | 'anim', placeholder = ''): HTMLElement => {
    const input = el('input', { class: 'text-input', attrs: { type: 'text', value: params[key], placeholder, 'aria-label': label } });
    input.addEventListener('input', () => { params[key] = input.value; draw(); });
    return el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: label }), input);
  };
  const frames = (): { name: string; x: number; y: number; w: number; h: number }[] => {
    const out: { name: string; x: number; y: number; w: number; h: number }[] = [];
    if (!img.width || params.tileW <= 0 || params.tileH <= 0) return out;
    let i = 0;
    for (let y = params.margin; y + params.tileH <= img.height - params.margin + 1e-6; y += params.tileH + params.spacing) {
      for (let x = params.margin; x + params.tileW <= img.width - params.margin + 1e-6; x += params.tileW + params.spacing) {
        out.push({ name: `${params.prefix}${i++}`, x, y, w: params.tileW, h: params.tileH });
        if (i > 4096) return out;
      }
    }
    return out;
  };
  const draw = (): void => {
    if (!img.width) return;
    const scale = Math.min(1, 520 / img.width, 360 / img.height);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const list = frames();
    ctx.strokeStyle = 'rgba(76,194,255,0.9)';
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (const [i, f] of list.entries()) {
      ctx.strokeRect(f.x * scale + 0.5, f.y * scale + 0.5, f.w * scale, f.h * scale);
      if (f.w * scale > 22) ctx.fillText(String(i), f.x * scale + 3, f.y * scale + 11);
    }
    info.textContent = `${img.width}×${img.height} px · ${list.length} frames`;
  };
  img.onload = draw;
  img.src = image.url;
  const form = el('div', { class: 'atlas-form' },
    num('Tile width', 'tileW', 1), num('Tile height', 'tileH', 1), num('Margin', 'margin'), num('Spacing', 'spacing'),
    text('Frame prefix', 'prefix'), text('Animation name', 'anim', 'optional: one animation with all frames'), num('Animation fps', 'fps', 1),
    num('Pivot X', 'pivotX', 0, 0.05), num('Pivot Y', 'pivotY', 0, 0.05),
  );
  const idInput = el('input', { class: 'text-input', attrs: { type: 'text', value: uniqueId(`${image.id}_atlas`, existingIds), 'aria-label': 'Atlas asset id' } });
  openDialog({
    title: `Slice "${image.id}" into an atlas`,
    size: 'xl',
    className: 'atlas-dialog',
    body: el('div', { class: 'atlas-layout' }, el('div', { class: 'atlas-preview' }, canvas, info), el('div', {}, form, el('label', { class: 'field-row' }, el('span', { class: 'field-label', text: 'Atlas id' }), idInput))),
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      {
        label: 'Create atlas', primary: true, onClick: (close) => {
          const list = frames();
          if (!list.length) return false;
          const json: AtlasJSON = { image: image.id, frames: {} };
          for (const f of list) json.frames[f.name] = { x: f.x, y: f.y, w: f.w, h: f.h, pivotX: params.pivotX, pivotY: params.pivotY };
          if (params.anim.trim()) json.animations = { [params.anim.trim()]: { frames: list.map((f) => f.name), fps: params.fps, loop: true } };
          const url = `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(json))))}`;
          onDone({ entry: { id: idInput.value.trim() || uniqueId(`${image.id}_atlas`, existingIds), kind: 'atlas', url, meta: { image: image.id } }, frameCount: list.length });
          close();
          return true;
        },
      },
    ],
  });
}

function uniqueId(base: string, existing: string[]): string {
  let id = base, i = 2;
  while (existing.includes(id)) id = `${base}_${i++}`;
  return id;
}
