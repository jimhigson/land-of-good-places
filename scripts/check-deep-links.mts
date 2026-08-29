/**
 * **`RIDE_DEEP_LINKS` had zero test coverage — #308.**
 *
 * `/keychain-stall` read as correctly wired on a static trace of every hop
 * (`main.ts`'s `RIDE_DEEP_LINKS` → `Game.ts`'s `boardRide` →
 * `KeychainShop.requestOpen`) and still "just started the game normally" for
 * Jim. Nothing short of driving a real browser at a real dev server would
 * have caught that class of bug — a static read-through cannot see a runtime
 * guard tripping, and this repo has already paid for exactly that lesson
 * once (`check-hotel.mts`'s probe 22, this file's own sibling). So this
 * drives the **actual boot paths** a deep link runs under, in a real
 * Chromium, and asserts the one fact the issue's own "Fix" section asks
 * for: **a deep link either does the thing it names, or the check goes red
 * — it never silently no-ops.**
 *
 * Covers both ways a deep link can be reached, because `main.ts` has two
 * separate code paths into `launchGame` and #308's own wiring notes
 * specifically flagged the untested one:
 *
 * 1. **`startFresh`** — a save-less profile, character creation skipped,
 *    straight to the deep link. This is the path every existing manual
 *    check exercised.
 * 2. **`continueGame`** — a *returning* profile (the shape a real player's
 *    browser is in), reached by actually creating a save first (via the same
 *    fast deep-link boot, so the bus is never sat through) and then
 *    reloading at the same URL. Nothing in the codebase had ever exercised
 *    this branch of `boot()` for a ride deep link before.
 *
 * Add a stall id to {@link CHECKS} to cover another deep link; each entry is
 * a URL plus an assertion of what "worked" means for that target, so a
 * future deep link that boards nothing (a typo, a ride renamed on one side
 * of the table, a stall not yet wired into `boardRide`/`MiniGameHost`) fails
 * loud here instead of shipping silent, the same way #308 did.
 *
 * ## Run it
 *
 *   npm run dev -- --port 5911 --strictPort   # in one terminal
 *   CHECK_DEEP_LINKS_URL=http://127.0.0.1:5911 npm run check:deep-links
 *
 * Needs a Chromium install (`channel: 'chromium'`, real GPU — see
 * `check-arrival-starts.mts`'s own doc comment for why headless SwiftShader
 * makes timing-sensitive reads meaningless; this check only reads booleans
 * off `window.game`, never a frame, so it does not need the GPU that
 * strictly — but a working compositor is still what makes the picker's own
 * `data-open` CSS transition resolve at all).
 */
import { chromium, type Page } from 'playwright-core';

const BASE = (process.env.CHECK_DEEP_LINKS_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SHOT_DIR = process.env.CHECK_DEEP_LINKS_SHOTS ?? '/tmp/check-deep-links';

type CheckResult = { ok: boolean; detail: string };

/** One deep link, and what "it actually did the thing" means for it. */
type DeepLinkCheck = {
  /** The path, e.g. `/keychain-stall` — must match a `RIDE_DEEP_LINKS` key in `main.ts`. */
  path: string;
  /** Reads game state and reports whether the deep link's effect actually happened. */
  assert: (page: Page) => Promise<CheckResult>;
};

// `uiOpen`/`.keychain-panel` were the 2D list picker (`ui/KeychainPanel.ts`),
// deleted when the rack itself became the picker (23 August 2026). The rack
// is now *entered* rather than walked up to keyring by keyring
// (`world/KeychainShop.ts`'s own header): `requestOpen` teleports to the
// stand point **and** opens the zoomed view in one motion, so `viewOpen` —
// and the on-screen ✕, `.keychain-view-close[data-show="true"]` — are what
// "the deep link actually did the thing" means now.
const keychainState = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { game?: any }).game;
    return {
      hasGame: !!g,
      viewOpen: g?.world?.keychainShop?.viewOpen ?? null,
      closeShown: document.querySelector('.keychain-view-close')?.getAttribute('data-show') ?? null,
      playerPos: g?.player?.position ? { x: g.player.position.x, z: g.player.position.z } : null,
    };
  });

const CHECKS: DeepLinkCheck[] = [
  {
    path: '/keychain-stall',
    assert: async (page) => {
      const s = await keychainState(page);
      if (!s.hasGame) return { ok: false, detail: 'window.game never appeared' };
      if (s.viewOpen !== true || s.closeShown !== 'true') {
        return {
          ok: false,
          detail: `zoomed view did not open (viewOpen=${s.viewOpen}, close button shown=${s.closeShown})`,
        };
      }
      return { ok: true, detail: `zoomed view open, player at ${JSON.stringify(s.playerPos)}` };
    },
  },
];

async function waitForGame(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { game?: unknown }).game, undefined, {
    timeout: timeoutMs,
  });
}

const fouls: string[] = [];
const said: string[] = [];

/**
 * Each sub-check gets its own browser process, not just its own context.
 * Two full 3D park instances sharing one Chromium under a software renderer
 * starve each other badly enough to turn a 500ms autosave wait into a flaky
 * 8s timeout — closing the *context* alone left the first park's renderer
 * process still winding down. A fresh process per sub-check costs a few
 * seconds of launch time and buys back determinism.
 */
async function runInFreshBrowser(run: (page: Page) => Promise<void>): Promise<string[]> {
  const pageErrors: string[] = [];
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String((e as Error)?.stack ?? e)));
    await run(page);
  } finally {
    await browser.close().catch(() => {});
  }
  return pageErrors;
}

/**
 * **Is anything actually serving `BASE`?** — asked once, before any deep link.
 *
 * Without this the whole run reports `ERR_CONNECTION_REFUSED` **per deep link**,
 * which reads as "these deep links are broken" and is a genuinely misleading
 * way to say "your dev server is somewhere else". It cost a real half-hour: the
 * author of #388 read it as a failure of the link they had just added, on a run
 * where every link was fine and the server was on another port.
 *
 * CLAUDE.md requires every agent to run its dev server on **its own** port, so
 * reaching this check on the default is the *expected* case for anybody
 * following the rules, not an exotic one. The fix is to say which of the two
 * things went wrong, and how to point it at the right place.
 */
try {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } finally {
    await browser.close().catch(() => {});
  }
} catch (error) {
  console.error(
    `check:deep-links: nothing is serving ${BASE} — so this run tested no deep link at all.\n\n` +
      `  ${String((error as Error)?.message ?? error).split('\n')[0]}\n\n` +
      `This is a reachability failure, not a deep-link failure. Start a dev server on your own\n` +
      `port (CLAUDE.md: never assume a default port is free) and point the check at it:\n\n` +
      `  npm run dev -- --port 5911 --strictPort\n` +
      `  CHECK_DEEP_LINKS_URL=http://127.0.0.1:5911 npm run check:deep-links\n`,
  );
  process.exit(1);
}

for (const check of CHECKS) {
  said.push(`--- ${check.path} ---`);

  // ---- path 1: startFresh (save-less profile) ----
  try {
    const pageErrors = await runInFreshBrowser(async (page) => {
      await page.goto(`${BASE}${check.path}`, { waitUntil: 'domcontentloaded' });
      await waitForGame(page, 30000);
      // Both `boardRide`/`open` and the panel's own `openWith` run synchronously
      // inside the same tick that produces `window.game` — no further wait needed
      // for the *state* (the CSS transition settling visually is a separate,
      // slower concern this check does not depend on).
      const result = await check.assert(page);
      said.push(`  [startFresh] ${result.ok ? 'OK' : 'FAILED'}: ${result.detail}`);
      if (!result.ok) fouls.push(`${check.path} (startFresh): ${result.detail}`);
      await page.screenshot({ path: `${SHOT_DIR}/${check.path.slice(1)}-fresh.png` }).catch(() => {});
    });
    if (pageErrors.length > 0) {
      fouls.push(`${check.path} (startFresh): page errors — ${pageErrors[0]?.split('\n')[0]}`);
    }
  } catch (e) {
    fouls.push(`${check.path} (startFresh): threw — ${String(e).slice(0, 300)}`);
  }

  // ---- path 2: continueGame (returning profile, a save already on disk) ----
  try {
    const pageErrors = await runInFreshBrowser(async (page) => {
      // Create the save fast, through the deep link itself (skips the bus),
      // then close whatever it opened and let the autosave land.
      await page.goto(`${BASE}${check.path}`, { waitUntil: 'domcontentloaded' });
      await waitForGame(page, 30000);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !!localStorage.getItem('lgp:save'), undefined, { timeout: 15000 });

      // Now the actual case under test: reload at the same deep link with a
      // save already present — this is `continueGame`, not `startFresh`.
      await page.goto(`${BASE}${check.path}`, { waitUntil: 'domcontentloaded' });
      await waitForGame(page, 30000);
      const result = await check.assert(page);
      said.push(`  [continueGame] ${result.ok ? 'OK' : 'FAILED'}: ${result.detail}`);
      if (!result.ok) fouls.push(`${check.path} (continueGame): ${result.detail}`);
      await page.screenshot({ path: `${SHOT_DIR}/${check.path.slice(1)}-continue.png` }).catch(() => {});
    });
    if (pageErrors.length > 0) {
      fouls.push(`${check.path} (continueGame): page errors — ${pageErrors[0]?.split('\n')[0]}`);
    }
  } catch (e) {
    fouls.push(`${check.path} (continueGame): threw — ${String(e).slice(0, 300)}`);
  }
}

for (const line of said) console.log(line);
if (fouls.length > 0) {
  console.error('\ncheck:deep-links FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:deep-links passed');
