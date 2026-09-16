import { el, storage } from '../ui/dom';

export interface TourStep {
  /** CSS selector of the element to highlight (null = centered). */
  target: string | null;
  title: string;
  text: string;
}

const KEY = 'forge.editor.tourDone';

export function tourDone(): boolean { return storage.get(KEY, false); }

/**
 * Guided first-run tour: dims the page, cuts out the target panel and shows a
 * tooltip with Next / Back / Skip. Skippable at any time with Escape.
 */
export function startTour(steps: TourStep[], onEnd?: () => void): void {
  let i = 0;
  const overlay = el('div', { class: 'tour-overlay', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Editor tour' } });
  const hole = el('div', { class: 'tour-hole' });
  const tip = el('div', { class: 'tour-tip' });
  overlay.append(hole, tip);
  document.body.appendChild(overlay);
  const end = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    storage.set(KEY, true);
    onEnd?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (i > 0) { i--; render(); } }
  };
  const next = (): void => { if (i >= steps.length - 1) end(); else { i++; render(); } };
  let target: HTMLElement | null = null;
  const place = (): void => {
    const pad = 8;
    if (target) {
      const r = target.getBoundingClientRect();
      hole.hidden = false;
      hole.style.left = `${r.left - pad}px`;
      hole.style.top = `${r.top - pad}px`;
      hole.style.width = `${r.width + pad * 2}px`;
      hole.style.height = `${r.height + pad * 2}px`;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2;
      let y = r.bottom + pad + 12;
      if (y + th > innerHeight - 12) y = r.top - th - pad - 12;
      if (y < 12) { y = Math.max(12, r.top); x = r.right + 16; if (x + tw > innerWidth - 12) x = r.left - tw - 16; }
      x = Math.max(12, Math.min(innerWidth - tw - 12, x));
      tip.style.left = `${x}px`;
      tip.style.top = `${Math.max(12, y)}px`;
    } else {
      hole.hidden = true;
      tip.style.left = `${innerWidth / 2 - tip.offsetWidth / 2}px`;
      tip.style.top = `${innerHeight / 2 - tip.offsetHeight / 2}px`;
    }
  };
  const render = (): void => {
    const s = steps[i];
    target = s.target ? document.querySelector<HTMLElement>(s.target) : null;
    tip.textContent = '';
    const back = el('button', { class: 'ghost small', text: 'Back', attrs: { type: 'button' } });
    back.disabled = i === 0;
    back.addEventListener('click', () => { if (i > 0) { i--; render(); } });
    const skip = el('button', { class: 'ghost small', text: 'Skip tour', attrs: { type: 'button' } });
    skip.addEventListener('click', end);
    const nextBtn = el('button', { class: 'primary small', text: i === steps.length - 1 ? 'Done' : 'Next', attrs: { type: 'button' } });
    nextBtn.addEventListener('click', next);
    tip.append(
      el('div', { class: 'tour-step dim small', text: `${i + 1} / ${steps.length}` }),
      el('h3', { text: s.title }),
      el('p', { text: s.text }),
      el('div', { class: 'tour-actions' }, skip, el('span', { class: 'spacer' }), back, nextBtn),
    );
    place();
    nextBtn.focus();
  };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  render();
}
