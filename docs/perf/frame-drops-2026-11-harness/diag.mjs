// node diag.mjs label base path [phone]
// Scene diagnostics + live A/B toggles measured with gl.finish() GPU drain and in-rAF CPU.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const [label, base, urlPath, phoneS] = process.argv.slice(2);
const phone = phoneS === 'phone';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--enable-precise-memory-info'] });
const context = await browser.newContext({ ...(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), serviceWorkers: 'block' });
const page = await context.newPage();
await page.addInitScript({ path: path.join(HERE, 'probe.js') });
await page.goto(base + urlPath, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => { const f = window.__perf.frames; const l = f[f.length - 2]; return !!l && l.draws > 20; })) break; }
await sleep(8000);
const facts = await page.evaluate(async () => {
  const P = window.__perf; const r = P.renderers[0];
  let best = null, n0 = -1; for (const s of P.scenes) { let n = 0; s.traverse(() => n++); if (n > n0) { n0 = n; best = s; } }
  const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  // materials whose program state flips between users
  const users = new Map();
  best.traverse((o) => {
    if (!o.isMesh || !vis(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const g = o.geometry;
    const tuple = [o.isInstancedMesh ? 1 : 0, o.isInstancedMesh && o.instanceColor ? 1 : 0, o.receiveShadow ? 1 : 0, o.isSkinnedMesh ? 1 : 0, g && g.morphAttributes && Object.keys(g.morphAttributes).length ? 1 : 0, g && g.attributes.color ? 1 : 0, g && g.attributes.uv ? 1 : 0, g && g.attributes.normal ? 1 : 0].join('');
    for (const m of mats) { if (!users.has(m)) users.set(m, new Map()); const t = users.get(m); t.set(tuple, (t.get(tuple) || 0) + 1); }
  });
  const flips = []; for (const [m, t] of users) if (t.size > 1) flips.push({ name: m.name || m.type, tuples: Object.fromEntries(t) });
  // material.version churn over one second
  const v0 = new Map(); for (const m of users.keys()) v0.set(m, m.version);
  await new Promise((res) => setTimeout(res, 1000));
  const owner = new Map(); best.traverse((o) => { if (!o.isMesh) return; const mats = Array.isArray(o.material) ? o.material : [o.material]; const pth = []; for (let p = o; p && pth.length < 5; p = p.parent) pth.push(p.name || p.type); for (const m of mats) if (!owner.has(m)) owner.set(m, pth.join('<')); });
  const churn = []; for (const [m, v] of v0) if (m.version - v > 20) churn.push({ name: m.name || m.type, perSec: m.version - v, owner: owner.get(m) });
  const matTypes = {}; for (const m of users.keys()) matTypes[m.type] = (matTypes[m.type] || 0) + 1;
  const lights = {}; best.traverse((o) => { if (o.isLight && vis(o)) lights[o.type] = (lights[o.type] || 0) + 1; });
  // where do visible triangles come from (by top-level child name)
  const byTop = {};
  for (const top of best.children) { let t = 0, m = 0; top.traverse((o) => { if (o.isMesh && vis(o) && o.geometry) { const g = o.geometry; const c = g.index ? g.index.count : g.attributes.position.count; t += c / 3 * (o.isInstancedMesh ? o.count : 1); m++; } }); if (m) byTop[`${top.name || top.type}#${top.id}`] = { meshes: m, ktris: Math.round(t / 1000) }; }
  const topTris = Object.entries(byTop).sort((a, b) => b[1].ktris - a[1].ktris).slice(0, 15);
  return { matTypes, lights, flipCount: flips.length, flips: flips.slice(0, 15), churn: churn.slice(0, 20), topTris, pixelRatio: r.getPixelRatio(), size: [r.domElement.width, r.domElement.height] };
});
async function measure(tag, ms = 3000) {
  await page.evaluate(() => { window.__perf.inject.gpuTimer = true; });
  await sleep(300);
  const from = await page.evaluate(() => performance.now());
  await sleep(ms);
  return page.evaluate(({ from, tag }) => {
    const fr = window.__perf.frames.filter((f) => f.ts > from && f.iv > 0);
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)] * 100) / 100; };
    return { tag, frames: fr.length, cpu: med(fr.map((f) => f.cpu)), gpuMs: med(fr.filter((f) => f.gpuMs !== undefined).map((f) => f.gpuMs)), gpuSamples: fr.filter((f) => f.gpuMs !== undefined).length, gpuP90: (() => { const a = fr.filter((f) => f.gpuMs !== undefined).map((f) => f.gpuMs).sort((x, y) => x - y); return Math.round(a[Math.floor(a.length * 0.9)] * 100) / 100; })(), draws: med(fr.map((f) => f.draws || 0)), ktris: Math.round(med(fr.map((f) => f.tris || 0)) / 1000) };
  }, { from, tag });
}
const ab = [];
ab.push(await measure('baseline'));
await page.evaluate(() => { const r = window.__perf.renderers[0]; window.__prPR = r.getPixelRatio(); r.setPixelRatio(1); r.setSize(r.domElement.clientWidth, r.domElement.clientHeight, false); });
ab.push(await measure('pixelRatio=1'));
await page.evaluate(() => { const r = window.__perf.renderers[0]; r.setPixelRatio(window.__prPR); r.setSize(r.domElement.clientWidth, r.domElement.clientHeight, false); });
ab.push(await measure('baseline again'));
await page.evaluate(() => { const r = window.__perf.renderers[0]; r.shadowMap.autoUpdate = false; });
ab.push(await measure('shadow map frozen (autoUpdate=false)'));
await page.evaluate(() => { const r = window.__perf.renderers[0]; r.shadowMap.autoUpdate = true; });
await page.evaluate(() => { const P = window.__perf; window.__hidden = []; for (const s of P.scenes) s.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.transparent && o.visible) { o.visible = false; window.__hidden.push(o); } }); });
ab.push(await measure('transparent meshes hidden'));
await page.evaluate(() => { for (const o of window.__hidden) o.visible = true; });
await page.evaluate(() => { const P = window.__perf; window.__mau = []; for (const s of P.scenes) { s.traverse((o) => { if (o.matrixAutoUpdate && !o.isCamera) { o.updateMatrix(); } }); } });
ab.push(await measure('control: baseline 3'));
await page.evaluate(() => { const r = window.__perf.renderers[0]; const orig = r.render.bind(r); window.__origRender = orig; r.render = (sc, cam) => { orig(sc, cam); if (sc.children.length > 20) orig(sc, cam); }; });
ab.push(await measure('CONTROL: main scene drawn twice'));
await page.evaluate(() => { const r = window.__perf.renderers[0]; r.render = window.__origRender; });
// light-count change: show one hidden point light, count program links and the worst frame
const lightFlip = await page.evaluate(async () => {
  const P = window.__perf; let target = null;
  for (const s of P.scenes) s.traverse((o) => { if (!target && o.isPointLight && !o.visible && (!o.parent || (() => { for (let p = o.parent; p; p = p.parent) if (!p.visible) return false; return true; })())) target = o; });
  if (!target) return { note: 'no hidden point light' };
  const from = performance.now(); target.visible = true;
  await new Promise((r) => setTimeout(r, 1500));
  const fr = P.frames.filter((f) => f.ts > from);
  return { links: fr.reduce((s, f) => s + (f.links || 0), 0), worstIv: Math.max(...fr.map((f) => f.iv)), worstCpu: Math.max(...fr.map((f) => f.cpu)), glBlock: fr.reduce((s, f) => s + (f.glBlockMs || 0), 0) };
});

await browser.close();
const out = { label, urlPath, phone, facts, ab, lightFlip };
fs.writeFileSync(path.join(process.env.PERF_OUT ?? path.join((await import('node:os')).tmpdir(), 'lgp-perf'), `${label}.diag.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
