/**
 * **Every pill in the ☰ menu is on the screen, and a tap on it lands on it —
 * on a phone either way up, and on a desktop.**
 *
 * ```
 * pnpm run check:served-menu-reach                       # serves the game itself
 * CHECK_MENU_REACH_URL=http://127.0.0.1:5948 pnpm run check:menu-reach
 * ```
 *
 * QA on PR #721, 17 October 2026: on a phone held sideways (844×390, 667×375)
 * the menu drawer was one column that did not scroll, and the new 🌅 Next day
 * pill pushed 📖 Cute-o-dex down to y 379–427 of a 390 px screen — an 11 px
 * sliver with no icon — while 🗺️ Map was wholly off it (that half already so on
 * `main`). On a touch screen there is no other way into the Cute-o-dex. Nothing
 * measured it, because nothing had ever opened the menu on a short screen.
 *
 * So this opens it, in a real Chromium against the served game, at each
 * {@link VIEWPORTS} size, and for every pill the drawer shows asks three things
 * (a label — the park's name, the purse — only the first: it is read, not
 * pressed, and lets a tap through to the park):
 *
 * 1. **all of it is on the screen** — its whole box inside the viewport, not a
 *    sliver of it;
 * 2. **nothing covers it** — `elementFromPoint` at its centre is the pill or
 *    something inside it;
 * 3. **a tap there reaches it** — a real tap (a touchscreen tap on the phones,
 *    a mouse click on the desktop) at its centre, caught by a capturing
 *    listener that records which pill the click landed on and stops it there,
 *    so nothing actually opens.
 *
 * And then, the Cute-o-dex opened from it, that **the shut ☰ button is under
 * the book**, as it always was: the open drawer is lifted over the HUD's bottom
 * row, and the first try at that lifted the shut button over every panel too.
 *
 * And so it cannot pass by measuring nothing, the pills every park has —
 * backpack, Next day, help, Cute-o-dex and map — must each be among them.
 * Screenshots of every open drawer go to `CHECK_MENU_REACH_SHOTS`
 * (`/tmp/check-menu-reach` by default).
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_MENU_REACH_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SEED = Number(process.env.CHECK_MENU_REACH_SEED ?? CANONICAL_PARK_SEED);
const SHOT_DIR = process.env.CHECK_MENU_REACH_SHOTS ?? '/tmp/check-menu-reach';
/** A park boots in seconds on a laptop and in minutes on a hosted runner's software renderer. */
const BOOT_TIMEOUT_MS = 240_000;

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly touch: boolean;
  readonly scale: number;
}
/** QA's two sideways phones, an upright one, and a desktop. */
const VIEWPORTS: readonly Viewport[] = [
  { name: 'phone sideways 844x390 (iPhone 14/15)', width: 844, height: 390, touch: true, scale: 3 },
  { name: 'phone sideways 667x375 (iPhone SE)', width: 667, height: 375, touch: true, scale: 2 },
  { name: 'phone upright 390x844', width: 390, height: 844, touch: true, scale: 3 },
  { name: 'desktop 1280x800', width: 1280, height: 800, touch: false, scale: 1 },
];
/** Pills every park's menu carries — the check is vacuous without them. */
const MUST_SHOW = ['pill--backpack', 'pill--next-day', 'pill--help', 'pill--dex', 'pill--map'] as const;

interface Item {
  readonly name: string;
  readonly classes: string;
  /** A button (the park's name and the purse are labels, not things to press). */
  readonly pressable: boolean;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly hitsItself: boolean;
  readonly hit: string;
}

const failures: string[] = [];
const notes: string[] = [];

try {
  const answer = await fetch(BASE);
  if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
} catch (error) {
  console.error(
    `check:menu-reach — nothing is serving ${BASE} (${String(error)}). Run \`pnpm run check:served-menu-reach\`, ` +
      'which serves the game itself, or point CHECK_MENU_REACH_URL at your own dev server.',
  );
  process.exit(1);
}
mkdirSync(SHOT_DIR, { recursive: true });

async function measure(browser: Browser, viewport: Viewport): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    hasTouch: viewport.touch,
    isMobile: viewport.touch,
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${BASE}/spawn?pos=${ENTRANCE_PLAYER_X.toFixed(2)},${ENTRANCE_PLAYER_Z.toFixed(2)}&seed=${SEED}`);
    await page.waitForSelector('.pill--menu', { state: 'visible', timeout: BOOT_TIMEOUT_MS });
    await page.waitForSelector('#hud-menu-items .pill--map', { state: 'attached', timeout: BOOT_TIMEOUT_MS });
    await page.waitForSelector('#hud-menu-items .pill--dex', { state: 'attached', timeout: BOOT_TIMEOUT_MS });

    // Open it the way she would.
    const button = await page.$('.pill--menu');
    if (!button) throw new Error('no menu button');
    if (viewport.touch) await button.tap();
    else await button.click();
    await page.waitForSelector('.hud-menu[data-open="true"]', { timeout: 10_000 });
    // The drawer's own fade is 120 ms.
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/${viewport.width}x${viewport.height}.png` });

    const items: Item[] = await page.evaluate(() =>
      [...document.querySelectorAll('#hud-menu-items > *')]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return getComputedStyle(element).display !== 'none' && box.width > 0 && box.height > 0;
        })
        .map((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            name: (element.textContent ?? '').replace(/\s+/g, ' ').trim() || element.getAttribute('aria-label') || '?',
            classes: element.className,
            pressable: element instanceof HTMLButtonElement || element.getAttribute('role') === 'button',
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            hitsItself: hit !== null && element.contains(hit),
            hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ').join('.')}` : 'nothing',
          };
        }),
    );
    const screen = { width: viewport.width, height: viewport.height };
    for (const pill of MUST_SHOW) {
      if (!items.some((item) => item.classes.split(' ').includes(pill))) {
        failures.push(`${viewport.name}: the open menu shows no ${pill} — the check cannot vouch for a menu it cannot find`);
      }
    }

    // A tap at each pill's centre: which pill did the click land on? Caught on
    // the way down and stopped, so nothing opens and the menu stays open.
    await page.evaluate(() => {
      const record = window as unknown as { menuReachTapped: string | null; menuReachCatch: (event: Event) => void };
      record.menuReachTapped = null;
      record.menuReachCatch = (event: Event): void => {
        const target = event.target instanceof Element ? event.target.closest('#hud-menu-items > *') : null;
        record.menuReachTapped = target ? target.className : `outside the menu (${event.target instanceof Element ? event.target.tagName : '?'})`;
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener('click', record.menuReachCatch, { capture: true });
    });
    const lines: string[] = [];
    for (const item of items) {
      const where = `${item.name} at x ${item.left.toFixed(0)}–${item.right.toFixed(0)}, y ${item.top.toFixed(0)}–${item.bottom.toFixed(0)}`;
      const onScreen = item.left >= 0 && item.top >= 0 && item.right <= screen.width && item.bottom <= screen.height;
      if (!onScreen) {
        failures.push(`${viewport.name}: ${where} is not all on the ${screen.width}×${screen.height} screen`);
        lines.push(`${item.name} OFF-SCREEN`);
        continue;
      }
      // A label (the park's name, the purse) is read, not pressed: on the
      // screen is all it owes. `pointer-events: none` lets a tap through it
      // to the park, which is the point of it.
      if (!item.pressable) {
        lines.push(`${item.name} (a label, y ${item.top.toFixed(0)}–${item.bottom.toFixed(0)})`);
        continue;
      }
      if (!item.hitsItself) {
        failures.push(`${viewport.name}: ${where} is covered — the middle of it is ${item.hit}`);
        lines.push(`${item.name} COVERED`);
        continue;
      }
      const x = (item.left + item.right) / 2;
      const y = (item.top + item.bottom) / 2;
      await page.evaluate(() => {
        (window as unknown as { menuReachTapped: string | null }).menuReachTapped = null;
      });
      if (viewport.touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      const tapped = await page.evaluate(() => (window as unknown as { menuReachTapped: string | null }).menuReachTapped);
      if (tapped !== item.classes) {
        failures.push(`${viewport.name}: a tap on ${where} landed on ${tapped ?? 'nothing at all'}`);
        lines.push(`${item.name} TAP MISSED`);
        continue;
      }
      lines.push(`${item.name} (y ${item.top.toFixed(0)}–${item.bottom.toFixed(0)})`);
    }
    // 4. Shut, the menu is back under the panels it opens. Lifting the open
    // drawer over the bottom row must not lift the shut button over the
    // Cute-o-dex: a pill drawn across the book's corner, and pressable through it.
    await page.evaluate(() => {
      const record = window as unknown as { menuReachCatch: (event: Event) => void };
      window.removeEventListener('click', record.menuReachCatch, { capture: true });
    });
    const dex = await page.$('#hud-menu-items .pill--dex');
    if (dex) {
      if (viewport.touch) await dex.tap();
      else await dex.click();
      await page.waitForSelector('.cutodex[data-open="true"]', { timeout: 10_000 });
      await page.waitForTimeout(400);
      const underneath = await page.evaluate(() => {
        const button = document.querySelector('.pill--menu');
        if (!button) return 'no menu button';
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit && button.contains(hit) ? 'the menu button is drawn over the open Cute-o-dex' : '';
      });
      if (underneath) failures.push(`${viewport.name}: ${underneath}`);
      lines.push(underneath ? 'shut menu OVER the Cute-o-dex' : 'shut menu under the Cute-o-dex');
    } else {
      failures.push(`${viewport.name}: no Cute-o-dex pill to open`);
    }
    if (errors.length > 0) failures.push(`${viewport.name}: the page threw — ${errors.join(' | ')}`);
    notes.push(`${viewport.name}: ${items.length} pills — ${lines.join(', ')}`);
  } finally {
    await context.close().catch(() => {});
  }
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const viewport of VIEWPORTS) {
    try {
      await measure(browser, viewport);
    } catch (error) {
      failures.push(`${viewport.name}: ${String(error)}`);
    }
  }
} finally {
  await browser.close().catch(() => {});
}

for (const note of notes) console.log(`check:menu-reach — ${note}`);
console.log(`check:menu-reach — screenshots of every open menu in ${SHOT_DIR}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`check:menu-reach FAILED — ${failures.length} problem(s)`);
  process.exit(1);
}
console.log(`check:menu-reach OK — every pill of the open menu on-screen, uncovered and tappable at ${VIEWPORTS.length} sizes`);
