// Where the frame goes, per scene: a CPU profile of an UNMINIFIED build
// (`vite build --minify false`), attributed to Class.method.
//
//   node docs/perf/undrawn-indoors/profile.mjs <base> <distDir> <scene> [secs=8] [throttle=1]
//
// Prints ms per second of wall time (divide by ~120 for ms per frame) for the
// children of `World.update` and of `Game.tick`, inclusive. Class names are
// recovered by reading the bundle upward from each function's line to the
// nearest `class X` — good enough to tell `Hotel.update` from `Train.update`.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import pathMod from 'node:path';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const { SCENES } = await import('./scenes.mjs');

const [base, distDir, scene, secsS = '8', throttleS = '1'] = process.argv.slice(2);
const secs = Number(secsS);
const throttle = Number(throttleS);
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const path = SCENES[scene];
const sep = path.includes('?') ? '&' : '?';
await page.goto(`${base}${path}${sep}perf=1&seed=5`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 240; i++) {
  await sleep(500);
  if (await page.evaluate(() => (window.__perf?.frameCount ?? 0) > 60).catch(() => false)) break;
}
await sleep(10000);
if (throttle !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');
await sleep(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const space = await page.evaluate(() => window.__perf.context().space);
await browser.close();

// ---- attribute
const files = new Map();
function classAt(url, line) {
  const name = url.split('/').pop();
  const file = pathMod.join(distDir, 'assets', name);
  if (!files.has(file)) files.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : null);
  const lines = files.get(file);
  if (!lines) return '?';
  for (let l = line; l >= 0; l--) {
    const text = lines[l] ?? '';
    const m = /^\s*(?:(?:var|let|const) )?(\w+) = class\b|^\s*class (\w+)/.exec(text);
    if (m) return m[1] ?? m[2] ?? '?';
    if (/^\s*function (\w+)/.test(text) && !/^\t\t\t/.test(text)) return '';
  }
  return '?';
}
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = [];
for (let i = 0; i < profile.samples.length; i++) {
  const d = profile.timeDeltas[i + 1] ?? 0;
  self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + d);
}
const label = (n) => {
  const f = n.callFrame;
  const cls = f.url ? classAt(f.url, f.lineNumber) : '';
  return `${cls ? cls + '.' : ''}${f.functionName || '(anon)'}`;
};
const incl = new Map();
function total(n) {
  if (incl.has(n.id)) return incl.get(n.id);
  let t = self.get(n.id) ?? 0;
  for (const c of n.children ?? []) t += total(byId.get(c));
  incl.set(n.id, t);
  return t;
}
const wall = (profile.endTime - profile.startTime) / 1e6; // s
const perSec = (us) => us / 1000 / wall; // ms per s
// Sum the children of every node with a given label, merged by child label.
function childrenOf(match) {
  const out = new Map();
  let parentTotal = 0;
  for (const n of profile.nodes) {
    if (label(n) !== match) continue;
    parentTotal += total(n);
    for (const c of n.children ?? []) {
      const cn = byId.get(c);
      const key = label(cn);
      out.set(key, (out.get(key) ?? 0) + total(cn));
    }
  }
  return { parentTotal, rows: [...out.entries()].sort((a, b) => b[1] - a[1]) };
}
const fmt = (v) => perSec(v).toFixed(1).padStart(7);
console.log(`scene ${scene} (${space}), ${wall.toFixed(1)} s, throttle ${throttle}`);
if (process.env.LABELS) {
  const sums = new Map();
  for (const n of profile.nodes) sums.set(label(n), (sums.get(label(n)) ?? 0) + total(n));
  for (const [k, v] of [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${fmt(v)}  ${k}`);
}
for (const parent of ['Game.tick', 'World.update', 'Building.update', 'Hotel.update', 'HotelInterior.update', 'NpcSystem.update', 'Game.render']) {
  const { parentTotal, rows } = childrenOf(parent);
  if (!parentTotal) continue;
  console.log(`${fmt(parentTotal)} ms/s  ${parent}`);
  for (const [k, v] of rows.slice(0, 18)) if (perSec(v) >= 0.3) console.log(`   ${fmt(v)}  ${k}`);
}
