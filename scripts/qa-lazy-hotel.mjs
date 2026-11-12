/**
 * Scratch browser QA for the lazy hotel interior — not part of the build.
 *
 *   node scripts/qa-lazy-hotel.mjs <port> <outDir> [desktop|phone]
 *
 * Against a **dev** server (it reads `window.game`). Answers, by playing:
 *
 *   1. Out in the park, far from the hotel, is the interior's chunk unfetched
 *      and the hotel unfurnished? (It must be.)
 *   2. Walking up to the tower and through its front door, does she end up in
 *      the lobby, furnished, with the interior fetched only on that approach?
 *   3. Is the furnished lobby solid — does she stop at a prop she walks into?
 *   4. Did any page error happen?
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5791';
const outDir = process.argv[3] ?? 'qa-out';
const size = process.argv[4] ?? 'desktop';
mkdirSync(outDir, { recursive: true });

const CHROME =
  process.env.QA_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/` +
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const save = {
  v: 1,
  at: Date.now(),
  purchases: 0,
  game: {
    parkName: 'QA Park',
    mode: 'sandbox',
    money: 500,
    player: { name: 'Eleri' },
    world: { timeOfDay: 600, dayCount: 0, lightsOn: false },
    inventory: [],
    carriedUid: null,
  },
  flags: { createdCharacter: true, arrivedByBus: true, hotelKey: false, dexPrizeSeen: true },
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context =
  size === 'phone'
    ? await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    : await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
const fetched = [];
page.on('request', (r) => {
  const url = r.url();
  if (/\/src\/world\/hotel\/interior\.ts|hotelInsideGlb|interior-[\w-]+\.js/.test(url)) fetched.push({ url, at: Date.now() });
});
await page.addInitScript((file) => {
  window.localStorage.setItem('lgp:save', JSON.stringify(file));
}, save);

const results = [];
const verdict = (ok, what) => {
  results.push({ ok, what });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${what}`);
};

async function boot(path) {
  await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => !!window.game?.player && !!window.game?.world?.hotel, null, { timeout: 600000 });
  await page.waitForTimeout(3000);
}

const state = () =>
  page.evaluate(() => {
    const g = window.game;
    const h = g.world.hotel;
    const p = g.player.position;
    const c = g.world.collision;
    const owned = (list) => (list ?? []).filter((s) => s.owner === 'hotel').length;
    return {
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      furnished: h.furnished,
      inside: h.playerIsInside,
      keepOuts: h.propKeepOuts.length,
      residents: h.residents.length,
      hotelSolids: owned(c.walls) + owned(c.circles) + owned(c.boxes),
    };
  });

/** Which held keys move her along (dx, dz)? Probed, not assumed: the camera decides. */
async function keysToward(dx, dz) {
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const moves = {};
  for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
    const a = await state();
    await page.keyboard.down(key);
    await page.waitForTimeout(350);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
    const b = await state();
    moves[key] = { x: b.x - a.x, z: b.z - a.z };
  }
  const score = (keys) => {
    const v = keys.reduce((acc, k) => ({ x: acc.x + moves[k].x, z: acc.z + moves[k].z }), { x: 0, z: 0 });
    const n = Math.hypot(v.x, v.z) || 1;
    return (v.x * ux + v.z * uz) / n;
  };
  const keys = Object.keys(moves);
  const options = [...keys.map((k) => [k]), ...keys.flatMap((a, i) => keys.slice(i + 1).map((b) => [a, b]))];
  options.sort((a, b) => score(b) - score(a));
  return options[0];
}

async function holdUntil(keys, ms, done) {
  for (const k of keys) await page.keyboard.down(k);
  const start = Date.now();
  let met = false;
  while (Date.now() - start < ms) {
    await page.waitForTimeout(150);
    if (await done()) {
      met = true;
      break;
    }
  }
  for (const k of keys) await page.keyboard.up(k);
  return met;
}

console.log(`--- ${size}: 1. far from the hotel ---`);
await boot('/spawn?pos=0,0');
const far = await state();
const band = await page.evaluate(() => window.game.world.hotel.towerDoorBand());
console.log(`  ${JSON.stringify(far)}; door band centre (${band.centreX.toFixed(1)}, ${band.centreZ.toFixed(1)}) yaw ${band.yaw.toFixed(2)}`);
const distance = Math.hypot(far.x - band.centreX, far.z - band.centreZ);
verdict(!far.furnished && fetched.length === 0, `${distance.toFixed(0)} m from the door: hotel unfurnished, interior chunk not fetched (${fetched.length} requests)`);
verdict(far.hotelSolids > 0, `the tower is solid before the interior exists (${far.hotelSolids} hotel colliders)`);
await page.screenshot({ path: `${outDir}/${size}-1-park.png` });

console.log(`--- ${size}: 2. walk in through the front door ---`);
const out = band.halfAlong + 5;
const sx = band.centreX + Math.sin(band.yaw) * out;
const sz = band.centreZ + Math.cos(band.yaw) * out;
const facing = ((band.yaw + Math.PI) * 180) / Math.PI;
fetched.length = 0;
await boot(`/spawn?pos=${sx.toFixed(2)},${sz.toFixed(2)}&facing=${facing.toFixed(0)}`);
await page.screenshot({ path: `${outDir}/${size}-2-at-the-door.png` });
const keys = await keysToward(-Math.sin(band.yaw), -Math.cos(band.yaw));
console.log(`  keys toward the door: ${keys.join('+')}`);
const beforeEntry = await state();
const entered = await holdUntil(keys, 15000, async () => (await state()).inside);
await page.waitForTimeout(2500);
const inLobby = await state();
console.log(`  ${JSON.stringify(inLobby)}; chunk requests: ${fetched.map((f) => f.url.replace(/^.*\//, '')).join(', ')}`);
verdict(!beforeEntry.furnished || fetched.length > 0, 'the interior was fetched on this approach, not at boot');
verdict(entered && inLobby.inside, 'walking through the door put her inside');
verdict(inLobby.furnished && inLobby.keepOuts > 20, `the hotel is furnished (${inLobby.keepOuts} prop footprints)`);
verdict(inLobby.residents > 0, `the guests exist (${inLobby.residents})`);
verdict(inLobby.hotelSolids > far.hotelSolids + 50, `the interior's solids are registered (${inLobby.hotelSolids} hotel colliders, was ${far.hotelSolids})`);
await page.screenshot({ path: `${outDir}/${size}-3-lobby.png` });

console.log(`--- ${size}: 3. the lobby is solid ---`);
// The nearest lobby prop footprint to where she arrived, and a walk straight at it.
const target = await page.evaluate(() => {
  const g = window.game;
  const p = g.player.position;
  let best = null;
  for (const k of g.world.hotel.propKeepOuts) {
    if (k.room.space !== 'hotel.lobby') continue;
    const x = k.room.originX + k.x;
    const z = k.room.originZ + k.z;
    const d = Math.hypot(x - p.x, z - p.z) - k.radius;
    if (k.radius > 0.35 && d > 1.2 && (!best || d < best.d)) best = { x, z, r: k.radius, d };
  }
  return best;
});
if (!target) {
  verdict(false, 'found a lobby prop to walk at');
} else {
  const start = await state();
  const walkKeys = await keysToward(target.x - start.x, target.z - start.z);
  const from = await state();
  let closest = Infinity;
  await holdUntil(walkKeys, 5000, async () => {
    const s = await state();
    closest = Math.min(closest, Math.hypot(s.x - target.x, s.z - target.z));
    return false;
  });
  const end = await state();
  closest = Math.min(closest, Math.hypot(end.x - target.x, end.z - target.z));
  const moved = Math.hypot(end.x - from.x, end.z - from.z);
  console.log(`  prop at (${target.x.toFixed(2)}, ${target.z.toFixed(2)}) radius ${target.r.toFixed(2)}; she moved ${moved.toFixed(2)} m, closest centre distance ${closest.toFixed(2)}`);
  verdict(moved > 0.5 && closest > target.r - 0.05, `she walked at it and stopped outside it (closest ${closest.toFixed(2)} ≥ radius ${target.r.toFixed(2)})`);
  await page.screenshot({ path: `${outDir}/${size}-4-against-a-prop.png` });
}

console.log(`--- ${size}: 4. errors ---`);
verdict(errors.length === 0, `no page or console errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${size}: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
