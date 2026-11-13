// node audit.mjs label base path [phone]
// Culling, crowd, camera-depth (LOD honesty), texture inventory, shadow A/B.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(process.env.LGP_ROOT ? `${process.env.LGP_ROOT}/package.json` : new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.PERF_OUT ?? path.join(os.tmpdir(), 'lgp-perf');
fs.mkdirSync(OUT, { recursive: true });
const [label, base, urlPath, phoneS] = process.argv.slice(2);
const phone = phoneS === 'phone';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
const context = await browser.newContext({ ...(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }), serviceWorkers: 'block' });
const page = await context.newPage();
await page.addInitScript({ path: path.join(HERE, 'probe.js') });
await page.goto(base + urlPath, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 120; i++) { await sleep(500); if (await page.evaluate(() => { const f = window.__perf.frames; const l = f[f.length - 2]; return !!l && l.draws > 20; })) break; }
await sleep(6000);
// capture the camera the game renders the world with
await page.evaluate(() => { const r = window.__perf.renderers[0]; const orig = r.render.bind(r); r.render = (sc, cam) => { if (sc.children.length > 20) window.__cam = cam; return orig(sc, cam); }; });
await sleep(300);
const facts = await page.evaluate(() => {
  const P = window.__perf; const cam = window.__cam; const r = P.renderers[0];
  let best = null, n0 = -1; for (const s of P.scenes) { let n = 0; s.traverse(() => n++); if (n > n0) { n0 = n; best = s; } }
  const T = Object.getPrototypeOf(cam.matrixWorld).constructor; // Matrix4
  const V3 = cam.position.constructor;
  const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  // frustum from camera
  const pm = new T().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const planes = []; const e = pm.elements;
  const rows = [[e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]], [e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]], [e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]], [e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]], [e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]], [e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]]];
  for (const [a, b, c, d] of rows) { const l = Math.hypot(a, b, c); planes.push([a / l, b / l, c / l, d / l]); }
  const inFrustum = (x, y, z, rad) => planes.every(([a, b, c, d]) => a * x + b * y + c * z + d >= -rad);
  const camPos = new V3(); cam.getWorldPosition(camPos);
  const tmp = new V3();
  const triOf = (o) => { const g = o.geometry; if (!g) return 0; const c = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0); return (c / 3) * (o.isInstancedMesh ? o.count : 1); };
  let drawn = 0, drawnTris = 0, noCullVis = 0, noCullTris = 0, noCullOff = 0, noCullOffTris = 0;
  const big = []; const dists = []; const byGroup = {};
  let wasteTris = 0, wasteMeshes = 0; // culling passes (sphere) but a tight box test says off-screen
  best.traverse((o) => {
    if (!(o.isMesh || o.isSprite) || !vis(o)) return;
    const tris = o.isMesh ? triOf(o) : 2;
    if (o.isMesh && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const bs = o.isMesh ? (o.isInstancedMesh ? (o.boundingSphere || (o.computeBoundingSphere(), o.boundingSphere)) : o.geometry.boundingSphere) : null;
    let cx, cy, cz, rad = 0;
    if (bs) { tmp.copy(bs.center).applyMatrix4(o.matrixWorld); cx = tmp.x; cy = tmp.y; cz = tmp.z; rad = bs.radius * o.matrixWorld.getMaxScaleOnAxis(); } else { o.getWorldPosition(tmp); cx = tmp.x; cy = tmp.y; cz = tmp.z; }
    const passes = !o.frustumCulled || inFrustum(cx, cy, cz, rad);
    if (!o.frustumCulled) { noCullVis++; noCullTris += tris; if (!inFrustum(cx, cy, cz, rad)) { noCullOff++; noCullOffTris += tris; } }
    if (!passes) return;
    drawn++; drawnTris += tris;
    { let top = o; while (top.parent && top.parent !== best) top = top.parent; const k = top.name || top.type; byGroup[k] = byGroup[k] || { draws: 0, shadowDraws: 0, ktris: 0 }; const nm = Array.isArray(o.material) ? o.material.length : 1; byGroup[k].draws += nm; if (o.castShadow) byGroup[k].shadowDraws += nm; byGroup[k].ktris += tris / 1000; }
    dists.push([Math.hypot(cx - camPos.x, cy - camPos.y, cz - camPos.z), tris]);
    if (rad > 25) big.push({ name: o.name || o.type, parent: o.parent && (o.parent.name || o.parent.type), radius: Math.round(rad), tris: Math.round(tris), instanced: !!o.isInstancedMesh, count: o.isInstancedMesh ? o.count : 1 });
    // per-instance waste for instanced meshes: instances whose own position is off-screen
    if (o.isInstancedMesh && o.count > 1) {
      const m = new T(); const g = o.geometry; const ir = g.boundingSphere.radius; const per = triOf(o) / o.count; let off = 0;
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); tmp.setFromMatrixPosition(m); const s = m.getMaxScaleOnAxis(); if (s === 0) { off++; continue; } if (!inFrustum(tmp.x, tmp.y, tmp.z, ir * s)) off++; }
      wasteTris += off * per; wasteMeshes += off;
    }
  });
  big.sort((a, b) => b.tris - a.tris);
  dists.sort((a, b) => a[0] - b[0]);
  const wq = (q) => { let acc = 0; const tot = dists.reduce((s, d) => s + d[1], 0); for (const [d, t] of dists) { acc += t; if (acc >= q * tot) return Math.round(d); } return null; };
  // crowd: kid proxies (npcs subtree)
  const npcs = best.children.find((c) => c.name === 'npcs');
  let kids = 0, kidsOn = 0; const kidPos = [];
  if (npcs) npcs.traverse((o) => { if (o.name === 'kid' && vis(o)) { kids++; o.getWorldPosition(tmp); if (inFrustum(tmp.x, tmp.y + 0.6, tmp.z, 0.8)) { kidsOn++; kidPos.push(tmp.clone()); } } });
  let crowdTris = 0; if (npcs) npcs.traverse((o) => { if (o.isMesh && vis(o)) crowdTris += triOf(o); });
  // on-screen kid height in device pixels (median)
  const H = r.domElement.height; const px = [];
  for (const p of kidPos) { const a = p.clone().project(cam), b = p.clone().setY(p.y + 1.2).project(cam); px.push(Math.abs(b.y - a.y) / 2 * H); }
  px.sort((a, b) => a - b);
  // textures
  const texs = new Map();
  best.traverse((o) => { if (!o.material) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) for (const k of ['map', 'emissiveMap', 'normalMap', 'alphaMap', 'gradientMap', 'aoMap', 'roughnessMap', 'metalnessMap']) { const t = m[k]; if (t && t.image) texs.set(t, k); } });
  let texBytes = 0; const texList = [];
  for (const [t, k] of texs) { const im = t.image; const w = im.width || (im.data && im.width) || 0, h = im.height || 0; const b = w * h * 4 * (t.generateMipmaps ? 1.333 : 1); texBytes += b; texList.push({ name: t.name || im.src?.split('/').pop()?.slice(0, 40) || im.constructor?.name, slot: k, w, h, MB: Math.round(b / 1048576 * 10) / 10, compressed: !!t.isCompressedTexture }); }
  texList.sort((a, b) => b.MB - a.MB);
  return {
    camera: { type: cam.type, fov: cam.fov, zoom: cam.zoom, near: cam.near, far: cam.far, distToFirst: null },
    drawnMeshes: drawn, drawnKTris: Math.round(drawnTris / 1000), noCullVisible: noCullVis, noCullKTris: Math.round(noCullTris / 1000), noCullOffscreen: noCullOff, noCullOffscreenKTris: Math.round(noCullOffTris / 1000),
    drawsByGroup: Object.entries(byGroup).sort((a, b) => b[1].draws - a[1].draws).slice(0, 12).map(([k, v]) => [k, v.draws, v.shadowDraws, Math.round(v.ktris)]),
    oversized: big.slice(0, 15), oversizedCount: big.length,
    instancesOffscreen: wasteMeshes, instancedOffscreenKTris: Math.round(wasteTris / 1000),
    depthOfDrawnTris: { p10: wq(0.1), p50: wq(0.5), p90: wq(0.9) },
    crowd: { kidsVisibleFlag: kids, kidsInFrustum: kidsOn, crowdKTris: Math.round(crowdTris / 1000), kidPxMedian: Math.round(px[px.length >> 1] || 0), kidPxMin: Math.round(px[0] || 0) },
    textures: { count: texList.length, uncompressedMB: Math.round(texBytes / 1048576), compressed: texList.filter((t) => t.compressed).length, top: texList.slice(0, 12) },
    shadow: (() => { const out = []; best.traverse((o) => { if (o.isLight && o.castShadow && vis(o)) out.push({ type: o.type, map: o.shadow.mapSize.x, radius: o.shadow.radius, blur: o.shadow.blurSamples, cam: o.shadow.camera.isOrthographicCamera ? [o.shadow.camera.left, o.shadow.camera.right, o.shadow.camera.top, o.shadow.camera.bottom, o.shadow.camera.far] : null }); }); let casters = 0, smallCasters = 0, smallTris = 0; best.traverse((o) => { if (o.isMesh && o.castShadow && vis(o)) { casters++; const bs = o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere); const rr = bs.radius * o.matrixWorld.getMaxScaleOnAxis(); if (rr < 0.35) { smallCasters++; smallTris += triOf(o); } } }); return { lights: out, casters, smallCastersUnder35cm: smallCasters, smallCasterKTris: Math.round(smallTris / 1000) }; })(),
  };
});
async function measure(tag, ms = 3000) {
  await page.evaluate(() => { window.__perf.inject.gpuTimer = true; });
  await sleep(300);
  const from = await page.evaluate(() => performance.now()); await sleep(ms);
  return page.evaluate(({ from, tag }) => { const fr = window.__perf.frames.filter((f) => f.ts > from && f.iv > 0); const med = (a) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)] * 100) / 100; }; return { tag, frames: fr.length, cpu: med(fr.map((f) => f.cpu)), gpuMs: med(fr.filter((f) => f.gpuMs !== undefined).map((f) => f.gpuMs)), draws: med(fr.map((f) => f.draws || 0)), ktris: Math.round(med(fr.map((f) => f.tris || 0)) / 1000) }; }, { from, tag });
}
const ab = [];
ab.push(await measure('baseline'));
await page.evaluate(() => { const P = window.__perf; for (const s of P.scenes) s.traverse((o) => { if (o.isLight && o.castShadow) { o.shadow.mapSize.set(1024, 1024); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } }); });
ab.push(await measure('shadow map 1024'));
await page.evaluate(() => { const P = window.__perf; for (const s of P.scenes) s.traverse((o) => { if (o.isLight && o.castShadow) { o.shadow.mapSize.set(2048, 2048); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } } }); });
ab.push(await measure('shadow map 2048 again'));
await page.evaluate(() => { const P = window.__perf; window.__small = []; const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }; for (const s of P.scenes) s.traverse((o) => { if (o.isMesh && o.castShadow && vis(o)) { const bs = o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere); if (bs.radius * o.matrixWorld.getMaxScaleOnAxis() < 0.35) { o.castShadow = false; window.__small.push(o); } } }); });
ab.push(await measure('casters under 35 cm: castShadow off'));
await page.evaluate(() => { for (const o of window.__small) o.castShadow = true; });
await browser.close();
const out = { label, urlPath, phone, facts, ab };
fs.writeFileSync(path.join(OUT, `${label}.audit.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
