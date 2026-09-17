// Start screen and notifications: title, seed field, Fly / Race / Play with
// friends / Daily seed / Random seed, control hints, island discovery toasts,
// photo-mode HUD hiding. Talks to the GameManager with messages
// (shell:fly, shell:race, shell:seed). Everything degrades to no-ops headless.
function hud(ctx) { return ctx.engine.canvas ? ctx.engine.hud : null; }
function pg(ctx) { return ctx.engine.procgen || null; }

const FONT = "font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;";

defineScript({
  name: 'Shell',
  description: 'Start screen, seed picker and notifications.',
  props: {
    title: { type: 'string', default: 'DRIFTWIND' },
    tagline: { type: 'string', default: 'A gliding journey through a floating archipelago' },
  },
  onStart(ctx) {
    const s = ctx.state;
    s.open = false; s.started = false; s.toastTimer = null;
    const h = hud(ctx);
    if (!h) return;
    h.root.style.transition = 'opacity 0.4s';
    this.showStart(ctx);
  },
  onDestroy(ctx) {
    const h = hud(ctx);
    if (h) for (const id of ['start', 'toast', 'hints', 'controls', 'flash']) h.remove(id);
  },
  seedNow(ctx) {
    const P = pg(ctx);
    return P && P.world ? P.world.seed : 'amber-lagoon-42';
  },
  showStart(ctx) {
    const h = hud(ctx), s = ctx.state, P = pg(ctx);
    if (!h) return;
    s.open = true;
    const panel = h.panel('start', ctx.props.title, ctx.props.tagline);
    panel.style.cssText += `${FONT}background:rgba(14,16,28,0.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,0.14);border-radius:18px;padding:34px 44px 30px;min-width:340px;box-shadow:0 30px 80px rgba(0,0,0,0.45);`;
    const title = panel.firstChild;
    title.style.cssText = 'font-size:46px;font-weight:200;letter-spacing:0.32em;margin:0 0 6px;background:linear-gradient(90deg,#ffd166,#ff7a3d 55%,#ff8bd1);-webkit-background-clip:text;background-clip:text;color:transparent;';
    if (panel.children[1]) panel.children[1].style.cssText = 'font-size:13px;letter-spacing:0.14em;opacity:0.72;margin-bottom:22px;';
    const guest = ctx.net.online && !ctx.net.isHost;
    // Seed row: an editable label (scripts have no document access; the overlay builds the element).
    const seedLabel = h.text('start-seed-label', guest ? 'world seed (set by the host)' : 'world seed', {});
    seedLabel.style.cssText = 'position:static;margin:0 0 4px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;opacity:0.6;text-align:left;';
    panel.appendChild(seedLabel);
    const seed = h.text('start-seed', P && P.seeds ? P.seeds.seedTitle(this.seedNow(ctx)) : this.seedNow(ctx), {});
    seed.style.cssText = `position:static;margin:0 0 18px;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,${guest ? 0.05 : 0.1});border:1px solid rgba(255,255,255,0.18);font-size:18px;letter-spacing:0.08em;text-align:left;pointer-events:${guest ? 'none' : 'auto'};outline:none;min-width:280px;`;
    if (!guest) { seed.contentEditable = 'true'; seed.spellcheck = false; seed.setAttribute('aria-label', 'World seed'); seed.setAttribute('role', 'textbox'); }
    panel.appendChild(seed);
    s.seedEl = seed;
    const row = (id) => { const r = h.text(id, '', {}); r.style.cssText = 'position:static;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin:0 0 10px;'; panel.appendChild(r); return r; };
    const primary = row('start-row-1');
    const secondary = row('start-row-2');
    const mk = (id, label, fn, big, into) => {
      const b = h.button(id, label, fn, {});
      b.style.cssText = `position:static;margin:0;${FONT}pointer-events:auto;cursor:pointer;border-radius:10px;padding:${big ? '12px 26px' : '8px 14px'};font-size:${big ? 15 : 12}px;letter-spacing:0.08em;border:1px solid rgba(255,255,255,0.22);background:${big ? 'linear-gradient(90deg,#ff7a3d,#ffb347)' : 'rgba(255,255,255,0.08)'};color:${big ? '#1a0d05' : '#fff'};font-weight:${big ? 600 : 500};`;
      into.appendChild(b);
      return b;
    };
    mk('start-fly', 'Fly', () => this.start(ctx, 'fly'), true, primary);
    mk('start-race', guest ? 'Ask host to race' : 'Race', () => this.start(ctx, 'race'), true, primary);
    mk('start-friends', ctx.net.online ? 'Copy invite link' : 'Play with friends', () => this.friends(ctx), false, secondary);
    if (!guest) {
      mk('start-daily', 'Daily seed', () => this.setSeed(ctx, P ? P.seeds.dailySeed() : 'daily'), false, secondary);
      mk('start-random', 'Random seed', () => this.setSeed(ctx, P ? P.seeds.randomSeed() : 'random'), false, secondary);
    }
    const hint = h.text('start-hint', P && P.env.isTouch ? 'Left joystick to fly  ·  Boost and Brake buttons' : 'A / D bank   ·   W / S pitch   ·   Space boost   ·   X brake   ·   P photo mode   ·   Enter to fly', {});
    hint.style.cssText = 'position:static;margin:14px 0 0;font-size:11px;letter-spacing:0.12em;opacity:0.55;text-align:center;';
    panel.appendChild(hint);
    for (const id of ['start-seed-label', 'start-seed', 'start-row-1', 'start-row-2', 'start-hint']) { const el = h.get(id); if (el) el.style.position = 'static'; }
  },
  readSeed(ctx) {
    const s = ctx.state, P = pg(ctx);
    const raw = s.seedEl ? String(s.seedEl.textContent || '') : '';
    return P ? P.seeds.normalizeSeed(raw || this.seedNow(ctx)) : raw;
  },
  setSeed(ctx, seed) {
    const s = ctx.state, P = pg(ctx);
    if (s.seedEl) s.seedEl.textContent = P ? P.seeds.seedTitle(seed) : seed;
    ctx.send('shell:seed', { seed });
  },
  start(ctx, mode) {
    const s = ctx.state, h = hud(ctx), P = pg(ctx);
    if (!s.open) return;
    const seed = this.readSeed(ctx);
    if (P && P.world && seed !== P.world.seed && !(ctx.net.online && !ctx.net.isHost)) ctx.send('shell:seed', { seed });
    s.open = false; s.started = true;
    if (h) h.remove('start');
    ctx.send(mode === 'race' ? 'shell:race' : 'shell:fly', {});
    ctx.audio.music('pad', { volume: 0.32, fade: 2, loop: true });
    if (h) {
      const c = h.text('controls', P && P.env.isTouch ? 'joystick: bank + pitch   ·   BOOST   ·   BRAKE' : 'A / D bank   ·   W / S pitch   ·   Space boost   ·   X brake   ·   P photo   ·   R race   ·   Esc menu', { anchor: 'bottom', y: 8 });
      c.style.cssText += 'font-size:11px;letter-spacing:0.14em;opacity:0.5;text-align:center;';
      ctx.timer(7, () => { const el = h.get('controls'); if (el) { el.style.transition = 'opacity 1.5s'; el.style.opacity = '0'; } });
    }
  },
  friends(ctx) {
    const P = pg(ctx);
    if (!P) return;
    if (ctx.net.online) {
      const url = P.env.urlWith({ seed: this.seedNow(ctx), name: null });
      P.env.copyText(url).then((ok) => this.toast(ctx, ok ? 'Invite link copied' : url));
    } else {
      // Open a fresh room with this seed; the lobby shows the invite link.
      const room = Math.random().toString(36).slice(2, 8).toUpperCase();
      P.env.navigate(P.env.urlWith({ room, seed: this.readSeed(ctx) }));
    }
  },
  toast(ctx, text, seconds = 3.5) {
    const h = hud(ctx), s = ctx.state;
    if (!h) return;
    const el = h.text('toast', text, { anchor: 'top', y: 64 });
    el.style.cssText += `${FONT}font-size:15px;letter-spacing:0.16em;padding:10px 18px;border-radius:999px;background:rgba(14,16,28,0.45);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.14);transition:opacity 0.6s;`;
    el.style.opacity = '1';
    if (s.toastTimer) s.toastTimer.cancel();
    s.toastTimer = ctx.timer(seconds, () => { const t = h.get('toast'); if (t) t.style.opacity = '0'; });
  },
  onMessage(ctx, name, data) {
    const h = hud(ctx);
    if (name === 'discover') this.toast(ctx, `${data.name}   ·   ${data.count} / ${data.total} islands`);
    else if (name === 'photoMode' && h) h.root.style.opacity = data.on ? '0' : '1';
    else if (name === 'raceState' && data.phase === 'finished' && !ctx.state.open) this.toast(ctx, 'Race over  ·  press R to race again', 5);
    else if (name === 'worldSeed' && data.remote) this.toast(ctx, `Host chose ${pg(ctx).seeds.seedTitle(data.seed)}`);
    else if (name === 'collision' && h && (data.peer === ctx.net.localId || data.peer === 'local')) {
      const f = h.text('flash', '', { anchor: 'top-left', x: 0, y: 0 });
      f.style.cssText = 'position:absolute;inset:0;margin:0;background:radial-gradient(circle,rgba(255,255,255,0) 40%,rgba(255,235,210,0.5) 100%);transition:opacity 0.5s;pointer-events:none;';
      f.style.opacity = String(Math.min(1, 0.5 + data.strength));
      ctx.timer(0.08, () => { const el = h.get('flash'); if (el) el.style.opacity = '0'; });
    }
  },
  onUpdate(ctx) {
    const s = ctx.state, h = hud(ctx);
    if (!h) return;
    if (s.open) {
      if (ctx.input.keyboard.pressed('Enter') || ctx.input.keyboard.pressed('NumpadEnter')) this.start(ctx, 'fly');
    } else {
      if (ctx.input.keyboard.pressed('KeyR')) ctx.send('shell:race', {});
      if (ctx.input.keyboard.pressed('Escape')) this.showStart(ctx);
    }
  },
});
