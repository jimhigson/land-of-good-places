// node drawattr.mjs <base> <path> <label>
// One game.render() at a frozen ?clock= moment, every draw attributed: pass
// (main / shadow), area (scene child), sub-area, and the drawn object's own
// name and material, so what still draws itself can be found. Dev server only.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, urlPath, label] = process.argv.slice(2);
const OUT = process.env.OUT ?? '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  args: ['--mute-audio', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
const url = `${base}${urlPath}${urlPath.includes('?') ? '&' : '?'}perf=1`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 600000 });
const riding = /^\/(rail-race|sky-cruiser|slide|ferris)/.test(urlPath);
const t0 = Date.now();
for (;;) {
  const ok = await page
    .evaluate((riding) => {
      const p = window.__perf;
      if (!p || p.frameCount < 10 || !window.game) return false;
      const c = p.context();
      if (riding && c.riding !== true) return false;
      if (c.clock && !c.clock.stopped) return false;
      return true;
    }, riding)
    .catch(() => false);
  if (ok) break;
  if (Date.now() - t0 > 1800000) throw new Error('never settled');
  await sleep(250);
}
await sleep(1500);
const r = await page.evaluate(() => {
  const game = window.game;
  const renderer = game.engine.renderer;
  const scene = game.engine.scene;
  const BATCH = Symbol.for('lgp.staticBatch');
  const counts = {};
  const objects = new Map();
  const orig = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
    const pass = sc === null ? 'shadow' : 'main';
    const names = [];
    let top = null;
    for (let n = object; n; n = n.parent) {
      names.push(n.name || n.type);
      if (n.parent === scene || (n.parent && n.parent.isScene)) top = n;
    }
    names.reverse();
    const area = names[1] ?? '?';
    const sub = names[2] ?? '';
    const key = `${pass}|${area}`;
    counts[key] = (counts[key] ?? 0) + 1;
    const isBatch = object[BATCH] !== undefined;
    let o = objects.get(object);
    if (!o) {
      const m = Array.isArray(material) ? material : material;
      o = {
        path: names.slice(1, 6).join('/'),
        area,
        sub,
        name: object.name || '',
        type: object.type,
        batch: isBatch,
        mat: `${material.type}${material.transparent ? ' T' : ''}${material.name ? ' ' + material.name : ''}`,
        matUuid: material.uuid,
        tris: geometry.index ? geometry.index.count / 3 : geometry.attributes.position ? geometry.attributes.position.count / 3 : 0,
        instanced: !!object.isInstancedMesh,
        userData: (() => {
          for (let n = object; n && n !== top?.parent; n = n.parent) if (n.userData && Object.keys(n.userData).length) return Object.keys(n.userData).join(',');
          return '';
        })(),
        main: 0,
        shadow: 0,
      };
      objects.set(object, o);
    }
    o[pass] += 1;
    return orig.apply(this, arguments);
  };
  renderer.info.autoReset = false;
  renderer.info.reset();
  try {
    game.render();
  } finally {
    renderer.renderBufferDirect = orig;
  }
  const info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  renderer.info.autoReset = true;
  const perf = window.__perf.summary ? window.__perf.frames().slice(-5) : null;
  return { space: window.__perf.context().space, info, perfFrames: perf, counts, objects: [...objects.values()] };
});
await browser.close();
fs.writeFileSync(`${OUT}/drawattr-${label}.json`, JSON.stringify(r));
const byArea = {};
for (const [k, v] of Object.entries(r.counts)) {
  const [pass, area] = k.split('|');
  byArea[area] ??= { main: 0, shadow: 0 };
  byArea[area][pass] += v;
}
const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
console.log(`${label} ${urlPath} space=${r.space} hooked draws=${total} info.calls=${r.info.calls} tris=${r.info.triangles} probe frames=${JSON.stringify(r.perfFrames?.map((f) => f.draws))} errors=${JSON.stringify(errors.slice(0, 2))}`);
for (const [area, v] of Object.entries(byArea).sort((a, b) => b[1].main + b[1].shadow - (a[1].main + a[1].shadow))) {
  console.log(`  ${area.padEnd(28)} main ${String(v.main).padStart(5)} shadow ${String(v.shadow).padStart(5)}`);
}
