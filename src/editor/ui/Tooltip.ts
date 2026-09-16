import { el } from './dom';

/**
 * Global tooltip driven by `data-tip` attributes: shows after a short delay
 * on hover or focus, positioned below the element. One element serves all.
 */
export function installTooltips(root: HTMLElement = document.body): void {
  const tip = el('div', { class: 'tooltip', attrs: { role: 'tooltip', hidden: 'true' } });
  document.body.appendChild(tip);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: HTMLElement | null = null;

  const show = (target: HTMLElement): void => {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    const extra = target.getAttribute('data-tip-key');
    if (extra) tip.appendChild(el('kbd', { text: extra }));
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    tip.style.left = '0px';
    tip.style.top = '0px';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    let y = r.bottom + 6;
    if (y + h > innerHeight - 4) y = r.top - h - 6;
    x = Math.max(4, Math.min(innerWidth - w - 4, x));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    current = target;
  };
  const hide = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    tip.hidden = true;
    current = null;
  };
  root.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!t || t === current) return;
    hide();
    timer = setTimeout(() => show(t), 450);
  });
  root.addEventListener('mouseout', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (t) hide();
  });
  root.addEventListener('focusin', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (t) { hide(); timer = setTimeout(() => show(t), 300); }
  });
  root.addEventListener('focusout', hide);
  root.addEventListener('mousedown', hide, true);
  window.addEventListener('scroll', hide, true);
}
