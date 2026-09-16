#!/usr/bin/env node
/**
 * Plays every bundled demo in headless Chromium with Playwright: loads
 * `play.html?project=<id>`, drives keyboard/pointer input, saves screenshots
 * and fails on console errors or script diagnostics.
 *
 *   node scripts/verify-demos.mjs [--base http://localhost:5173] [--out ./shots] [--only id,id] [--3d]
 *
 * Playwright is resolved from `PLAYWRIGHT_MODULE`, the local node_modules, or
 * the global install; browsers come from `PLAYWRIGHT_BROWSERS_PATH`.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const BASE = opt('--base', 'http://localhost:5173');
const OUT = resolve(opt('--out', './demo-shots'));
const ONLY = opt('--only', '')?.split(',').filter(Boolean) ?? [];
mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const c of candidates) {
    try { return await import(c); } catch { /* try next */ }
  }
  throw new Error('playwright module not found; set PLAYWRIGHT_MODULE');
}

/** Per-demo input scripts: a list of steps run in order. */
const PLAYS = {
  'starter-2d': [
    { hold: ['KeyD'], ms: 900 }, { press: 'Space' }, { hold: ['KeyD'], ms: 600 }, { shot: 'run' },
    { hold: ['KeyA'], ms: 500 }, { press: 'Space' }, { wait: 400 }, { shot: 'jump' },
    { expect: 'moved', entity: 'Player', axis: 'x', from: -4 },
  ],
  'starter-3d': [
    { wait: 800 }, { shot: 'orbit' }, { drag: { from: [400, 300], to: [520, 320] } }, { wait: 300 }, { shot: 'dragged' },
  ],
  'arena-blasters': [
    { wait: 400 }, { shot: 'start' },
    { hold: ['KeyW'], ms: 700 }, { hold: ['KeyA', 'KeyW'], ms: 500 }, { hold: ['KeyJ'], ms: 600 }, { shot: 'shooting' },
    { hold: ['KeyD', 'KeyW', 'KeyJ'], ms: 1500 }, { shot: 'combat' },
    { expect: 'moved', entity: 'Ship local', axis: 'x' },
    { expect: 'hud', id: 'score' },
  ],
  'sky-hoppers': [
    { wait: 300 }, { shot: 'start' },
    { hold: ['KeyD'], ms: 1200 }, { press: 'Space' }, { hold: ['KeyD'], ms: 700 }, { press: 'Space' }, { hold: ['KeyD'], ms: 900 }, { shot: 'running' },
    { press: 'Space' }, { hold: ['KeyD'], ms: 1200 }, { shot: 'further' },
    { expect: 'moved', entity: 'Hopper local', axis: 'x' },
  ],
  'paddle-rush': [
    { wait: 500 }, { shot: 'start' }, { hold: ['KeyW'], ms: 700 }, { hold: ['KeyS'], ms: 1200 }, { shot: 'rally' }, { wait: 2500 }, { shot: 'later' },
    { expect: 'moved', entity: 'Paddle Left', axis: 'y' },
    { expect: 'hud', id: 'score' },
  ],
  'cube-racers': [
    { wait: 500 }, { shot: 'grid' }, { hold: ['KeyW'], ms: 1500 }, { hold: ['KeyW', 'KeyA'], ms: 800 }, { shot: 'driving' }, { hold: ['KeyW'], ms: 1500 }, { shot: 'lap' },
    { expect: 'moved', entity: 'Kart local', axis: 'z' },
  ],
  'tower-together': [
    { wait: 500 }, { shot: 'start' }, { click: [430, 250] }, { click: [560, 330] }, { wait: 600 }, { shot: 'towers' }, { wait: 4000 }, { shot: 'wave' },
    { expect: 'count', tag: 'tower', min: 1 },
    { expect: 'hud', id: 'gold' },
  ],
};

const errors = [];
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const index = JSON.parse(readFileSync(resolve('public/demos/index.json'), 'utf8'));
const ids = index.demos.map((d) => d.id).filter((id) => ONLY.length === 0 || ONLY.includes(id));

for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
  const url = `${BASE}/play.html?project=${id}`;
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.forge && window.forge.running, null, { timeout: 15000 });
    await page.focus('canvas');
    const steps = PLAYS[id] ?? [{ wait: 1000 }, { shot: 'idle' }];
    const start = await page.evaluate(() => {
      const w = window.forge.world;
      const out = {};
      for (const e of w.entities()) { const t = w.getComponent(e, 'Transform'); if (t) out[w.nameOf(e)] = { x: t.position.x, y: t.position.y, z: t.position.z }; }
      return out;
    });
    for (const s of steps) {
      if (s.wait) await page.waitForTimeout(s.wait);
      if (s.hold) { for (const k of s.hold) await page.keyboard.down(k); await page.waitForTimeout(s.ms); for (const k of s.hold) await page.keyboard.up(k); }
      if (s.press) await page.keyboard.press(s.press);
      if (s.click) { await page.mouse.move(s.click[0], s.click[1]); await page.waitForTimeout(80); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); }
      if (s.drag) { await page.mouse.move(...s.drag.from); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(s.drag.from[0] + (s.drag.to[0] - s.drag.from[0]) * i / 8, s.drag.from[1] + (s.drag.to[1] - s.drag.from[1]) * i / 8); await page.waitForTimeout(30); } await page.mouse.up(); }
      if (s.shot) await page.screenshot({ path: join(OUT, `${id}-${s.shot}.png`) });
      if (s.expect === 'moved') {
        const pos = await page.evaluate((name) => { const w = window.forge.world; const e = w.findByName(name); if (!e) return null; const t = w.getComponent(e, 'Transform'); return { x: t.position.x, y: t.position.y, z: t.position.z }; }, s.entity);
        const before = s.from ?? start[s.entity]?.[s.axis];
        if (!pos) log.push(`expect: entity "${s.entity}" not found`);
        else if (before === undefined || Math.abs(pos[s.axis] - before) < 0.2) log.push(`expect: "${s.entity}" did not move on ${s.axis} (${before} -> ${pos?.[s.axis]})`);
      }
      if (s.expect === 'count') {
        const n = await page.evaluate((tag) => window.forge.world.findByTag(tag).length, s.tag);
        if (n < s.min) log.push(`expect: fewer than ${s.min} entities tagged "${s.tag}" (${n})`);
      }
      if (s.expect === 'hud') {
        const ok = await page.evaluate((hid) => !!window.forge.hud.get(hid), s.id);
        if (!ok) log.push(`expect: HUD element "${s.id}" missing`);
      }
    }
    const stats = await page.evaluate(() => ({ entities: window.forge.world.entityCount, tick: window.forge.clock.tick, fps: Math.round(window.forge.clock.fps), draws: window.forge.renderer?.stats.drawCalls }));
    const bad = log.filter((l) => !/favicon/.test(l));
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${id.padEnd(16)} ${JSON.stringify(stats)} ${(Date.now() - t0) / 1000}s`);
    for (const l of bad) { console.log(`     ${l}`); errors.push(`${id}: ${l}`); }
  } catch (err) {
    console.log(`FAIL ${id}: ${err.message}`);
    for (const l of log) console.log(`     ${l}`);
    errors.push(`${id}: ${err.message}`);
    await page.screenshot({ path: join(OUT, `${id}-error.png`) }).catch(() => {});
  }
  await page.close();
}
await browser.close();
console.log(errors.length ? `\n${errors.length} problem(s)` : `\nAll ${ids.length} demos verified. Screenshots in ${OUT}`);
process.exit(errors.length ? 1 : 0);
