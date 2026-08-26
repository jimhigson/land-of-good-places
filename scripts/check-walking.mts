/**
 * **Do the cursor keys still walk the character?**
 *
 * ```
 * npm run dev -- --port 5911 --strictPort   # in one terminal
 * CHECK_WALKING_URL=http://127.0.0.1:5911 npm run check:walking
 * ```
 *
 * Issue #338: Jim, on the deployed site — *"cursor keys for walking also seem
 * to no longer work"*. Walking is GAME_DESIGN.md's CONTROL rule; there is no
 * more basic thing this game does. Nothing in the repo asserted it. Every
 * check we had proved the park was *built* correctly and said nothing about
 * whether a key pressed at it *moves a girl*, which is the same disease
 * CLAUDE.md's "a check can pass without checking anything" section is about,
 * pointed at the controls instead of at the scenery.
 *
 * ## What it actually does
 *
 * Presses a real key — `keydown`/`keyup` through Chromium's own input
 * pipeline, with the real `KeyboardEvent.code` the game binds
 * (`core/input/actions.ts`'s `KEYBOARD_MOVE_BINDINGS`) — at a real running
 * park, and measures `Player.position` before and after in metres. Nothing is
 * stubbed and nothing is inferred: the number it prints is how far a child
 * would have walked.
 *
 * A static read-through cannot see this class of bug, and neither can any of
 * the headless `check:*` scripts, because the failure modes are all *between*
 * the DOM and the player: a listener attached to an element that got replaced,
 * a `preventDefault` upstream, a focus-stealing overlay, a `Player.riding`
 * flag left latched true by an arrival or a locked shop view, `Game.tick`
 * refusing to run `player.update` because something never un-paused. Every one
 * of those reads as correct code and renders a correct-looking park.
 *
 * ## The three places it asks
 *
 * One press proves one path. These three are the paths a regression actually
 * arrives through, and each was a named suspect on #338:
 *
 * 1. **`/spawn`** — the plain controllable park, nothing else going on. The
 *    floor: if this fails, movement is broken outright.
 * 2. **After the keychain rack's locked view** (`/keychain-stall`, then Esc).
 *    That view hands the character to `Player.beginRide()` and takes her back
 *    with `endRide()` (`world/KeychainShop.ts`'s own header). A view that
 *    opens and does not hand back leaves `riding` latched true, and a latched
 *    `riding` is exactly "the keys do nothing" with no other symptom.
 * 3. **A returning save** (`continueGame`) — the shape a real player's browser
 *    is in every day after the first. It is a different branch of `boot()`
 *    from the two above, with `startPlace` restored and the hotel's
 *    `adoptRestoredPlayer` run, and nothing had ever driven a key at it.
 *
 * The cat-bus arrival is deliberately **not** here: sitting through a first
 * boot costs minutes on a software renderer, and what it would prove —
 * `ArrivalSequence.handOver()` really gives the controls back — is already
 * asserted headlessly and cheaply by `check:cat-bus` (`endRides === 1`) plus
 * case 1 above.
 *
 * ## Thresholds
 *
 * Taken from the game (`PLAYER_MAX_SPEED`), never from a number somebody
 * liked the look of, and deliberately loose: this is a check about *zero
 * versus not zero*, not about tuning. A press is expected to cover at least
 * {@link MIN_FRACTION_OF_TOP_SPEED} of what top speed over the same wall-clock
 * hold would give, which leaves room for acceleration, a software renderer's
 * frame rate and a bush in the way, while still going red the instant a key
 * stops doing anything at all.
 *
 * Every direction is pressed, not just one, because a binding table can lose a
 * row: `ArrowDown` in particular is bound **twice** (movement *and* the Rail
 * Race's `duck`), so it is the row most likely to be broken by a change to
 * either.
 *
 * Needs a Chromium install (`channel: 'chromium'`) — same as
 * `check-deep-links.mts`, which this file is shaped after. It reads
 * `window.game`, so it wants the dev server rather than `vite preview`
 * (`main.ts` only publishes that handle under `import.meta.env.DEV`).
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { PLAYER_MAX_SPEED } from '../src/core/constants.ts';
import { KEYBOARD_MOVE_BINDINGS } from '../src/core/input/actions.ts';

const BASE = (process.env.CHECK_WALKING_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SHOT_DIR = process.env.CHECK_WALKING_SHOTS ?? '/tmp/check-walking';

/** How long each key is held, in milliseconds. */
const HOLD_MS = 1200;

/**
 * The share of `PLAYER_MAX_SPEED × hold` a press must actually cover.
 *
 * Low on purpose. A real hold never reaches the full figure — `Player.update`
 * accelerates into it (`PLAYER_ACCELERATION`), the first frames are slow, and
 * a software-rendered park runs at a fraction of a real one's frame rate — so
 * a tight bound here would be a flake, and CLAUDE.md counts a flake as a
 * failure. What this number has to separate is "she walked" from "she did not
 * move at all", and for that it has enormous headroom in both directions: the
 * measured figure on a working build is ~0.9 of top speed, and a broken one is
 * exactly 0.
 */
const MIN_FRACTION_OF_TOP_SPEED = 0.1;

/** Metres a working press must cover. Derived, never typed in. */
const MIN_METRES = PLAYER_MAX_SPEED * (HOLD_MS / 1000) * MIN_FRACTION_OF_TOP_SPEED;

/** Every movement key the game binds, read off the binding table itself. */
const MOVE_KEYS: readonly string[] = Object.keys(KEYBOARD_MOVE_BINDINGS);

type Place = { readonly x: number; readonly z: number };

type PlayerState = {
  readonly hasGame: boolean;
  readonly place: Place | null;
  readonly riding: boolean | null;
  readonly moveX: number | null;
  readonly moveY: number | null;
  readonly paused: boolean | null;
};

const fouls: string[] = [];
const said: string[] = [];

function readPlayer(page: Page): Promise<PlayerState> {
  return page.evaluate(() => {
    const game = (window as unknown as { game?: any }).game;
    const player = game?.player;
    return {
      hasGame: !!game,
      place: player?.position ? { x: player.position.x, z: player.position.z } : null,
      riding: player?.riding ?? null,
      moveX: game?.input?.moveX ?? null,
      moveY: game?.input?.moveY ?? null,
      paused: game?.paused ?? null,
    } as PlayerState;
  });
}

async function waitForGame(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { game?: unknown }).game, undefined, {
    timeout: timeoutMs,
  });
}

/**
 * Holds one key down for {@link HOLD_MS} and reports how far she got.
 *
 * `page.keyboard.down(code)` sends a real `keydown` with that exact
 * `KeyboardEvent.code`, which is what `InputSystem.onKeyDown` reads — so a
 * binding renamed on one side of the table and not the other fails here rather
 * than shipping.
 */
async function walkOnce(page: Page, code: string): Promise<{ metres: number; detail: string }> {
  const before = await readPlayer(page);
  await page.keyboard.down(code);
  await page.waitForTimeout(HOLD_MS);
  const during = await readPlayer(page);
  await page.keyboard.up(code);
  await page.waitForTimeout(250);
  const after = await readPlayer(page);

  if (!before.place || !after.place) {
    return { metres: Number.NaN, detail: 'the player had no position to read at all' };
  }
  const metres = Math.hypot(after.place.x - before.place.x, after.place.z - before.place.z);
  const detail =
    `${metres.toFixed(3)} m in ${HOLD_MS} ms ` +
    `(from ${before.place.x.toFixed(2)},${before.place.z.toFixed(2)} ` +
    `to ${after.place.x.toFixed(2)},${after.place.z.toFixed(2)}; ` +
    `stick mid-press ${during.moveX ?? '?'},${during.moveY ?? '?'}; ` +
    `riding=${during.riding}; paused=${during.paused})`;
  return { metres, detail };
}

/** Presses every movement key at whatever park is on screen, and judges it. */
async function walkEveryWay(page: Page, label: string): Promise<void> {
  const state = await readPlayer(page);
  if (!state.hasGame) {
    fouls.push(`${label}: window.game never appeared, so nothing could be measured`);
    return;
  }
  if (state.riding === true) {
    fouls.push(
      `${label}: the character is still \`riding\` before a key was even pressed — ` +
        'input, collision and gravity are switched off, so no key can move her ' +
        '(Player.beginRide/endRide: something took control and did not give it back)',
    );
  }

  for (const code of MOVE_KEYS) {
    const { metres, detail } = await walkOnce(page, code);
    const ok = Number.isFinite(metres) && metres >= MIN_METRES;
    said.push(`  [${label}] ${code.padEnd(10)} ${ok ? 'OK' : 'FAILED'}: ${detail}`);
    if (!ok) {
      fouls.push(
        `${label}: ${code} moved her ${Number.isFinite(metres) ? `${metres.toFixed(3)} m` : 'nowhere measurable'}, ` +
          `needs at least ${MIN_METRES.toFixed(3)} m ` +
          `(${MIN_FRACTION_OF_TOP_SPEED} x PLAYER_MAX_SPEED ${PLAYER_MAX_SPEED} m/s x ${HOLD_MS / 1000} s) — ${detail}`,
      );
    }
  }
}

/**
 * A browser process per case, not just a context — same reasoning as
 * `check-deep-links.mts`: two full 3D parks in one Chromium starve each other
 * badly enough under a software renderer to turn a wait into a flake.
 */
async function inFreshBrowser(run: (page: Page) => Promise<void>): Promise<string[]> {
  const pageErrors: string[] = [];
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    const context = await browser.newContext({ viewport: { width: 900, height: 650 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String((error as Error)?.stack ?? error)));
    await run(page);
  } finally {
    await browser?.close().catch(() => {});
  }
  return pageErrors;
}

async function runCase(label: string, run: (page: Page) => Promise<void>): Promise<void> {
  said.push(`--- ${label} ---`);
  try {
    const pageErrors = await inFreshBrowser(async (page) => {
      await run(page);
      await page
        .screenshot({ path: `${SHOT_DIR}/${label.replace(/[^a-z0-9]+/gi, '-')}.png` })
        .catch(() => {});
    });
    if (pageErrors.length > 0) {
      fouls.push(`${label}: page errors — ${pageErrors[0]?.split('\n')[0]}`);
    }
  } catch (error) {
    fouls.push(`${label}: threw — ${String(error).slice(0, 300)}`);
  }
}

// --- 1. the plain controllable park -------------------------------------
await runCase('spawn', async (page) => {
  await page.goto(`${BASE}/spawn?pos=0,0`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page, 240000);
  // A beat for the first frames to settle before the stopwatch starts.
  await page.waitForTimeout(2000);
  await walkEveryWay(page, 'spawn');
});

// --- 2. after the keychain rack's locked view has handed her back --------
//
// `/keychain-stall` opens the zoomed picker, which calls `Player.beginRide()`.
// Escape closes it, which must call `endRide()`. If it does not, `riding`
// stays latched and every key below is dead — see this file's own header.
await runCase('after keychain view', async (page) => {
  await page.goto(`${BASE}/keychain-stall`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page, 240000);
  await page.waitForTimeout(2000);
  const opened = await page.evaluate(
    () => (window as unknown as { game?: any }).game?.world?.keychainShop?.viewOpen ?? null,
  );
  if (opened !== true) {
    fouls.push(
      `after keychain view: the deep link never opened the zoomed view (viewOpen=${opened}), ` +
        'so the hand-back this case exists to test was never exercised',
    );
    return;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await walkEveryWay(page, 'after keychain view');
});

// --- 3. a returning save, through the welcome-back prompt ----------------
await runCase('returning save', async (page) => {
  // Make a save fast, through `/spawn` (no character creator, no cat bus),
  // then mark it as one that has already seen the arrival — which is what a
  // real returning player's save says, and what makes the reload below take
  // `continueGame`'s branch rather than replaying the bus.
  await page.goto(`${BASE}/spawn?pos=6,10`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page, 240000);
  await page.waitForFunction(() => !!localStorage.getItem('lgp:save'), undefined, {
    timeout: 60000,
  });
  await page.evaluate(() => {
    const raw = localStorage.getItem('lgp:save');
    if (!raw) return;
    const save = JSON.parse(raw) as { flags?: Record<string, unknown> };
    save.flags = { ...(save.flags ?? {}), arrivedByBus: true, createdCharacter: true };
    localStorage.setItem('lgp:save', JSON.stringify(save));
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button.welcome-keep', { timeout: 120000 });
  await page.click('button.welcome-keep');
  await waitForGame(page, 300000);
  await page.waitForTimeout(3000);
  await walkEveryWay(page, 'returning save');
});

for (const line of said) console.log(line);
if (fouls.length > 0) {
  console.error('\ncheck:walking FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log(
  `\ncheck:walking passed — ${MOVE_KEYS.length} keys x 3 boot paths, ` +
    `each covering at least ${MIN_METRES.toFixed(3)} m`,
);
