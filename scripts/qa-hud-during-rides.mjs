/**
 * **The half of #404 that only a real browser can answer.**
 *
 * `check:hud-during-rides` drives `ui/Hud.ts` directly, so it proves the HUD
 * does the right thing when it is *told* an attraction has her. It cannot
 * prove that `Game.tick` tells it — that needs a real park, a real ride and a
 * real `Player.riding`. This does, against a running dev server, and takes
 * before/during/after screenshots at a phone and a desktop width so a human
 * can see it rather than read a claim about it.
 *
 * Three rides, chosen because they are the three different ways in:
 * the **ginormous slide** (`Building.requestBoardSlide`, the deep-linked one),
 * the **helter-skelter** (`Building.startRide`, the one you walk into), and
 * the **glass lift** (`liftRide.startBoarding`, the one that is arguably a
 * transition and is deliberately treated as a ride — see `core/attraction.ts`).
 * All three reach `Player.beginRide`, which is the whole point: the check is
 * of the seam, from three unrelated directions.
 *
 * Not in the `build` chain, for the same reason `check:deep-links` and
 * `check:walking` are not: it needs a server to talk to.
 *
 *   npm run dev -- --port 5405 --strictPort     # in one terminal
 *   node scripts/qa-hud-during-rides.mjs http://127.0.0.1:5405 /tmp/hud-404
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:5405').replace(/\/$/, '');
const OUT = process.argv[3] ?? '/tmp/hud-404';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];

/** Walks the real ancestor chain in the real browser. */
const VIS = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return 'missing';
  for (let at = el; at; at = at.parentElement) {
    const s = getComputedStyle(at);
    if (s.display === 'none') return 'hidden(display:none)';
    if (s.visibility === 'hidden') return 'hidden(visibility)';
    if (s.opacity === '0') return 'hidden(opacity)';
  }
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return 'hidden(zero-size)';
  return 'visible';
}`;

async function state(page) {
  return page.evaluate(
    ([visSrc]) => {
      const vis = eval(visSrc);
      const g = window.game;
      return {
        riding: g?.player?.riding ?? null,
        menuButton: vis('.pill--menu'),
        mapPill: vis('.pill--map'),
        drawerOpen: document.querySelector('.hud-menu')?.dataset.open ?? null,
      };
    },
    [VIS],
  );
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await page.evaluate(fn)) return true;
    await wait(200);
  }
  return false;
}

const RIDES = [
  {
    id: 'giant-slide',
    label: 'the ginormous slide',
    board: () => window.game.world.building.requestBoardSlide(false),
  },
  {
    id: 'helter-skelter',
    label: 'the helter-skelter',
    board: () => {
      const b = window.game.world.building;
      b.startRide(b.helterSkelter, false, window.game.player);
      return true;
    },
  },
  {
    id: 'glass-lift',
    label: 'the glass lift',
    board: () => {
      const b = window.game.world.building;
      b.liftPanel.startBoarding(window.game.player, false);
      return true;
    },
  },
];

const results = [];
const browser = await chromium.launch({ channel: 'chromium' });

for (const vp of VIEWPORTS) {
  for (const ride of RIDES) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
    await page.goto(`${BASE}/spawn`, { waitUntil: 'domcontentloaded' });

    const booted = await waitFor(page, () => !!window.game?.player, 120000);
    if (!booted) {
      results.push({ vp: vp.name, ride: ride.id, error: 'never booted' });
      await context.close();
      continue;
    }
    await wait(2500);

    // Open the drawer, so the map pill is on screen in the "before" shot.
    await page.evaluate(() => document.querySelector('.pill--menu').click());
    await wait(400);
    const before = await state(page);
    await page.screenshot({ path: `${OUT}/${vp.name}-${ride.id}-1-before.png` });

    await page.evaluate(ride.board);
    const boarded = await waitFor(page, () => window.game.player.riding === true, 15000);
    await wait(1200);
    const during = await state(page);
    await page.screenshot({ path: `${OUT}/${vp.name}-${ride.id}-2-during.png` });

    // Off again — naturally if the ride ends by itself, otherwise handed back.
    const ended = await waitFor(page, () => window.game.player.riding === false, 45000);
    if (!ended) await page.evaluate(() => window.game.player.endRide());
    await wait(1200);
    // Reopen the drawer for a like-for-like "after" shot.
    await page.evaluate(() => document.querySelector('.pill--menu')?.click());
    await wait(400);
    const after = await state(page);
    await page.screenshot({ path: `${OUT}/${vp.name}-${ride.id}-3-after.png` });

    results.push({ vp: vp.name, ride: ride.id, boarded, endedByItself: ended, before, during, after });
    console.log(`\n${vp.name} · ${ride.label}`);
    console.log(`  before: ${JSON.stringify(before)}`);
    console.log(`  during: ${JSON.stringify(during)} (boarded=${boarded})`);
    console.log(`  after:  ${JSON.stringify(after)} (ride ended by itself=${ended})`);
    await context.close();
  }
}

await browser.close();

let bad = 0;
for (const r of results) {
  if (r.error) { bad++; console.log(`FAIL ${r.vp}/${r.ride}: ${r.error}`); continue; }
  const ok =
    r.before.menuButton === 'visible' &&
    r.before.mapPill === 'visible' &&
    r.during.riding === true &&
    r.during.menuButton.startsWith('hidden') &&
    r.during.mapPill.startsWith('hidden') &&
    r.during.drawerOpen === 'false' &&
    r.after.menuButton === 'visible' &&
    r.after.mapPill === 'visible';
  if (!ok) { bad++; console.log(`FAIL ${r.vp}/${r.ride}`); }
}
console.log(`\n${bad === 0 ? 'ALL PASS' : `${bad} FAILED`} — shots in ${OUT}`);
process.exit(bad === 0 ? 0 : 1);
