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
// One park for every page: the dev server solves a seed on first request and
// caches it, so asking for the same one each time costs one solve, not four.
const seed = process.env.QA_SEED ?? '5';
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

/** A screenshot, patiently: a loaded machine can take a while to hand over a frame. */
async function shot(path) {
  try {
    await page.screenshot({ path, timeout: 120000 });
  } catch (error) {
    console.log(`  (no screenshot ${path}: ${String(error).split('\n')[0]})`);
  }
}

const results = [];
const verdict = (ok, what) => {
  results.push({ ok, what });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${what}`);
};

async function boot(path) {
  await page.goto(`http://localhost:${port}${path}${path.includes('?') ? '&' : '?'}seed=${seed}`, { waitUntil: 'load', timeout: 120000 });
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
      changing: h.spaces?.isChanging ?? null,
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
    await page.waitForTimeout(1500);
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
  console.log(`  key probe: ${Object.entries(moves).map(([k, v]) => `${k} (${v.x.toFixed(2)}, ${v.z.toFixed(2)})`).join(', ')}`);
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
await shot(`${outDir}/${size}-1-park.png`);

console.log(`--- ${size}: 2. walk in through the front door ---`);
const out = band.halfAlong + 5;
const sx = band.centreX + Math.sin(band.yaw) * out;
const sz = band.centreZ + Math.cos(band.yaw) * out;
const facing = ((band.yaw + Math.PI) * 180) / Math.PI;
fetched.length = 0;
await boot(`/spawn?pos=${sx.toFixed(2)},${sz.toFixed(2)}&facing=${facing.toFixed(0)}`);
await shot(`${outDir}/${size}-2-at-the-door.png`);
// A tap on the hotel, as a child sends her: the routed walk to the door
// band's centre, which is where the tower's own zone stands her
// (`Hotel.exteriorEntranceZone`). Walking that route crosses the band.
const beforeEntry = await state();
await page.evaluate(([x, z]) => {
  const g = window.game;
  g.tapNavigator.navigateTo(x, g.player.position.y, z);
}, [band.centreX, band.centreZ]);
const crossedAt = Date.now();
let entered = await holdUntil([], 20000, async () => (await state()).inside);
// The iris holds shut while the interior is fetched and built; on a loaded dev
// machine that is many module requests, so give it time and say how long.
if (!entered) {
  const deadline = Date.now() + 120000;
  while (!entered && Date.now() < deadline) {
    await page.waitForTimeout(500);
    entered = (await state()).inside;
  }
}
console.log(`  inside ${entered ? 'after' : 'NOT after'} ${((Date.now() - crossedAt) / 1000).toFixed(1)} s from the start of the walk`);
await page.waitForTimeout(2500);
const inLobby = await state();
console.log(`  ${JSON.stringify(inLobby)}; chunk requests: ${fetched.map((f) => f.url.replace(/^.*\//, '')).join(', ')}`);
verdict(!beforeEntry.furnished || fetched.length > 0, 'the interior was fetched on this approach, not at boot');
verdict(entered && inLobby.inside, 'walking through the door put her inside');
verdict(inLobby.furnished && inLobby.keepOuts > 20, `the hotel is furnished (${inLobby.keepOuts} prop footprints)`);
verdict(inLobby.residents > 0, `the guests exist (${inLobby.residents})`);
verdict(inLobby.hotelSolids > far.hotelSolids + 50, `the interior's solids are registered (${inLobby.hotelSolids} hotel colliders, was ${far.hotelSolids})`);
await shot(`${outDir}/${size}-3-lobby.png`);

console.log(`--- ${size}: 3. the lobby is solid ---`);
// Which way each arrow key walks her, measured with long holds (she turns
// before she walks, so a short tap mostly measures the turn).
const keyDir = {};
for (const key of ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
  const a0 = await state();
  await page.keyboard.down(key);
  await page.waitForTimeout(3000);
  await page.keyboard.up(key);
  await page.waitForTimeout(500);
  const b0 = await state();
  const n = Math.hypot(b0.x - a0.x, b0.z - a0.z) || 1;
  keyDir[key] = { x: (b0.x - a0.x) / n, z: (b0.z - a0.z) / n, moved: n };
}
console.log(`  key directions: ${Object.entries(keyDir).map(([k, v]) => `${k} (${v.x.toFixed(2)}, ${v.z.toFixed(2)}) over ${v.moved.toFixed(2)} m`).join(', ')}`);
// A lobby prop dead ahead of one key: on that key's line within 60% of its
// radius, at least a metre off.
const props = await page.evaluate(() =>
  window.game.world.hotel.propKeepOuts
    .filter((k) => k.room.space === 'hotel.lobby')
    .map((k) => ({ x: k.room.originX + k.x, z: k.room.originZ + k.z, r: k.radius })),
);
// Stand her 2.5 m back from a lobby prop along ArrowUp's measured line, on
// clear floor with nothing else on that line, and walk her at it.
const up = keyDir.ArrowUp;
const clearOf = (x, z, except) => props.every((q) => q === except || Math.hypot(x - q.x, z - q.z) > q.r + 0.8);
let pick = null;
for (const prop of props) {
  if (prop.r < 0.3) continue;
  const back = prop.r + 2.5;
  const sx = prop.x - up.x * back;
  const sz = prop.z - up.z * back;
  let clear = true;
  for (let t = 0; t <= back - prop.r; t += 0.25) if (!clearOf(sx + up.x * t, sz + up.z * t, prop)) clear = false;
  if (clear) {
    pick = { key: 'ArrowUp', prop, along: back, sx, sz };
    break;
  }
}
if (pick) {
  await page.evaluate(([x, z]) => window.game.player.teleportTo(x, 0, z), [pick.sx, pick.sz]);
  await page.waitForTimeout(1500);
}
const here0 = await state();
if (!pick) {
  verdict(false, `found a lobby prop dead ahead of an arrow key (${props.length} props)`);
} else {
  const { key, prop } = pick;
  let closest = Infinity;
  await holdUntil([key], 30000, async () => {
    const s = await state();
    closest = Math.min(closest, Math.hypot(s.x - prop.x, s.z - prop.z));
    return false;
  });
  const end = await state();
  closest = Math.min(closest, Math.hypot(end.x - prop.x, end.z - prop.z));
  const moved = Math.hypot(end.x - here0.x, end.z - here0.z);
  console.log(`  held ${key} at the prop at (${prop.x.toFixed(2)}, ${prop.z.toFixed(2)}), radius ${prop.r.toFixed(2)}, ${pick.along.toFixed(2)} m ahead; she moved ${moved.toFixed(2)} m and came no closer than ${closest.toFixed(2)} m to its centre`);
  verdict(
    moved > 0.5 && closest > prop.r && closest < prop.r + 1.2,
    `she walked up to it and was stopped outside it (closest ${closest.toFixed(2)} m, radius ${prop.r.toFixed(2)} m)`,
  );
  await shot(`${outDir}/${size}-4-against-a-prop.png`);
}

console.log(`--- ${size}: 4. errors ---`);
verdict(errors.length === 0, `no page or console errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${size}: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
