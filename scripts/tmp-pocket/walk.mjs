// node walk.mjs <port> <seed> <startX,startZ> <targetX,targetZ> <seconds> <shot.png>
import { chromium } from 'playwright-core';
const [port, seed, start, target, secs, shot] = process.argv.slice(2);
const [tx, tz] = target.split(',').map(Number);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
await page.goto(`http://127.0.0.1:${port}/spawn?pos=${start}&seed=${seed}`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.game?.player, null, { timeout: 180000 });
await page.waitForTimeout(4000);
const read = () => page.evaluate(() => { const p = window.game.player.position; return [p.x, p.z]; });
console.log('seed check', await page.evaluate(() => new URL(location.href).searchParams.get('seed')), 'start', (await read()).map((v) => v.toFixed(2)).join(','));
// Measure each key's world direction.
const dirs = {};
for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
  const a = await read();
  await page.keyboard.down(key); await page.waitForTimeout(350); await page.keyboard.up(key); await page.waitForTimeout(300);
  const b = await read();
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  dirs[key] = [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}
console.log('key dirs', JSON.stringify(Object.fromEntries(Object.entries(dirs).map(([k, v]) => [k, v.map((x) => x.toFixed(2))]))));
const combos = [];
const keys = Object.keys(dirs);
for (let i = 0; i < 4; i++) { combos.push([keys[i]]); for (let j = i + 1; j < 4; j++) { const s = [dirs[keys[i]][0] + dirs[keys[j]][0], dirs[keys[i]][1] + dirs[keys[j]][1]]; if (Math.hypot(...s) > 0.5) combos.push([keys[i], keys[j]]); } }
const comboDir = (c) => { const s = c.reduce((acc, k) => [acc[0] + dirs[k][0], acc[1] + dirs[k][1]], [0, 0]); const d = Math.hypot(...s); return [s[0] / d, s[1] / d]; };
let best = Infinity, bestAt = null, held = [];
const t0 = Date.now();
while (Date.now() - t0 < Number(secs) * 1000) {
  const p = await read();
  const dist = Math.hypot(tx - p[0], tz - p[1]);
  if (dist < best) { best = dist; bestAt = p; }
  if (dist < 0.8) break;
  const want = [(tx - p[0]) / dist, (tz - p[1]) / dist];
  let pick = combos[0], score = -2;
  for (const c of combos) { const d = comboDir(c); const s = d[0] * want[0] + d[1] * want[1]; if (s > score) { score = s; pick = c; } }
  for (const k of held) if (!pick.includes(k)) await page.keyboard.up(k);
  for (const k of pick) if (!held.includes(k)) await page.keyboard.down(k);
  held = pick;
  await page.waitForTimeout(150);
}
for (const k of held) await page.keyboard.up(k);
const end = await read();
console.log(`target ${target}: closest ${best.toFixed(2)} m at (${bestAt.map((v) => v.toFixed(2)).join(', ')}), ended (${end.map((v) => v.toFixed(2)).join(', ')})`);
if (shot) await page.screenshot({ path: shot });
await browser.close();
