// CPU profile of the park on the production build: inclusive ms/s per function name.
// usage: node profile.mjs <label> '<path>' <secs> '<opts JSON>'   (opts: cache, walk, time)
import fs from 'node:fs';
import { chromium, BASE, OUT, sleep } from './lib.mjs';

const [label, urlPath, secsS, optsS] = process.argv.slice(2);
const secs = Number(secsS ?? 8);
const o = optsS ? JSON.parse(optsS) : {};
const url = `${BASE}${urlPath}${urlPath.includes('?') ? '&' : '?'}seed=5&perf=1&shadowCache=${o.cache ?? 1}`;
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const ready = () => page.waitForFunction(() => { const p = window.__perf; return !!p && p.frameCount > 60 && p.context().space === 'garden'; }, null, { timeout: 240_000, polling: 250 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready();
  if (o.time !== undefined) {
    await page.waitForFunction(() => !!localStorage.getItem('lgp:save'), null, { timeout: 60_000, polling: 250 });
    const save = JSON.parse(await page.evaluate(() => localStorage.getItem('lgp:save')));
    save.game = { ...(save.game ?? {}), world: { ...(save.game?.world ?? {}), timeOfDay: o.time } };
    await context.addInitScript((text) => { try { localStorage.setItem('lgp:save', text); } catch {} }, JSON.stringify(save));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await ready();
  }
  await sleep(6000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  const until = Date.now() + secs * 1000;
  let k = 0;
  while (Date.now() < until) {
    if (o.walk === 'square') { await page.keyboard.down(keys[k % 4]); await sleep(2000); await page.keyboard.up(keys[k % 4]); k++; } else await sleep(500);
  }
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const total = (profile.endTime - profile.startTime) / 1e6; // s
  const inclusive = new Map();
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000; // ms
    let id = profile.samples[i];
    const seen = new Set();
    const leaf = byId.get(id)?.callFrame.functionName || '(anon)';
    self.set(leaf, (self.get(leaf) ?? 0) + dt);
    while (id !== undefined) {
      const cf = byId.get(id).callFrame;
      const name = cf.functionName || '(anon)';
      if (!seen.has(name)) { seen.add(name); inclusive.set(name, (inclusive.get(name) ?? 0) + dt); }
      id = parent.get(id);
    }
  }
  const want = (process.env.FNS ?? 'tick,render,renderSun,survey,visit,classify,changed,snapshot,renderStatic,renderComposite,intersectsObject,inFrustum,renderObject,renderBufferDirect,updateMatrixWorld,setProgram,projectObject,VSMPass,copyTextureToTexture,readMoments,runAudit,update').split(',');
  const rows = want.map((name) => `${name.padEnd(22)} incl ${((inclusive.get(name) ?? 0) / total).toFixed(1).padStart(7)} ms/s   self ${((self.get(name) ?? 0) / total).toFixed(1).padStart(6)} ms/s`);
  console.log(`${label}: ${total.toFixed(1)} s profiled\n${rows.join('\n')}`);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, v]) => `${n || '(anon)'} ${(v / total).toFixed(1)}`);
  console.log(`top self (ms/s): ${top.join(' | ')}`);
  fs.writeFileSync(`${OUT}/profile-${label}.cpuprofile`, JSON.stringify(profile));
} finally {
  await browser.close();
}
