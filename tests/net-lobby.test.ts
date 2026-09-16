// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/index';
import { NetLobbyOverlay, connectionHint } from '../src/net/ui/NetLobbyOverlay';
import type { NetParams } from '../src/net/createTransport';

const params = (net: NetParams['net']): NetParams => ({ room: 'ABC123', net, server: '', name: '' });

function lobby(net: NetParams['net']): { overlay: NetLobbyOverlay; root: HTMLElement; engine: Engine } {
  const engine = Engine.create(null, { audio: false, renderer: 'none' });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const overlay = new NetLobbyOverlay(engine, container, { params: params(net), refreshMs: 100000 });
  return { overlay, root: overlay.root, engine };
}

describe('NetLobbyOverlay connection errors', () => {
  it('shows the error, a hint about WebRTC/TURN, "Play offline" and a same-browser fallback', () => {
    const { overlay, root, engine } = lobby('peer');
    expect(root.querySelector<HTMLElement>('.net-lobby-error')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.net-lobby-hint')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.net-local')!.hidden).toBe(true);
    overlay.setError('Signalling error (network): Lost connection to server.');
    expect(root.dataset.phase).toBe('error');
    expect(overlay.collapsed).toBe(false);
    const error = root.querySelector<HTMLElement>('.net-lobby-error')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('Signalling error');
    const hint = root.querySelector<HTMLElement>('.net-lobby-hint')!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toMatch(/internet access/);
    expect(hint.textContent).toMatch(/TURN/);
    expect(root.querySelector<HTMLElement>('.net-offline')!.hidden).toBe(false);
    const local = root.querySelector<HTMLElement>('.net-local')!;
    expect(local.hidden).toBe(false);
    expect(local.textContent).toMatch(/same-browser/i);
    overlay.dispose();
    engine.dispose();
  });

  it('does not offer same-browser mode when that is already the transport', () => {
    const { overlay, root, engine } = lobby('local');
    overlay.setError('No host answered');
    expect(root.querySelector<HTMLElement>('.net-local')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.net-lobby-hint')!.textContent).toMatch(/this browser/);
    expect(connectionHint(params('ws'))).toMatch(/relay server/i);
    overlay.dispose();
    engine.dispose();
  });

  it('collapses to a pill and comes back', () => {
    const { overlay, root, engine } = lobby('peer');
    overlay.setConnected();
    overlay.setCollapsed(true);
    expect(root.classList.contains('collapsed')).toBe(true);
    expect(root.querySelector<HTMLElement>('.net-lobby-pill')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.net-lobby-pill')!.textContent).toContain('ABC123');
    overlay.setCollapsed(false);
    expect(root.classList.contains('collapsed')).toBe(false);
    overlay.dispose();
    engine.dispose();
  });
});
