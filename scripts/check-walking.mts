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
 * Keys are not the whole of walking, so each case also **taps the park** —
 * `PointerControls` -> `Selection` -> `TapNavigator` -> `setNavigationMove`,
 * the road a phone walks down, which shares only its last step with a key. See
 * {@link tapToMove}.
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
 * One number, {@link MIN_METRES}, taken from the game (`PLAYER_RADIUS`) rather
 * than chosen: a press must move her further than her own body is wide. This is
 * a check about *zero versus not zero*, not about tuning — a stuck character
 * scores exactly 0 — so the bar only has to be honest. **How long** she is
 * given to clear it is the part that needs care, and {@link MAX_HOLD_MS}'s own
 * doc comment explains why it is a deadline rather than a fixed hold.
 *
 * Every direction is pressed, not just one, because a binding table can lose a
 * row: `ArrowDown` in particular is bound **twice** (movement *and* the Rail
 * Race's `duck`), so it is the row most likely to be broken by a change to
 * either. The list of keys pressed is written out in {@link MOVE_KEYS} rather
 * than read off `KEYBOARD_MOVE_BINDINGS`, and then compared against it — see
 * that constant for why a check that reads its own expectations from the thing
 * under test cannot go red.
 *
 * Needs a Chromium install (`channel: 'chromium'`) — same as
 * `check-deep-links.mts`, which this file is shaped after. It reads
 * `window.game`, so it wants the dev server rather than `vite preview`
 * (`main.ts` only publishes that handle under `import.meta.env.DEV`).
 */
import { writeSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { PLAYER_MAX_SPEED, PLAYER_RADIUS } from '../src/core/constants.ts';

import { KEYBOARD_MOVE_BINDINGS } from '../src/core/input/actions.ts';

const BASE = (process.env.CHECK_WALKING_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SHOT_DIR = process.env.CHECK_WALKING_SHOTS ?? '/tmp/check-walking';

/**
 * **How far she must get before a press counts as "she walked".**
 *
 * `PLAYER_RADIUS` — her own half-width, taken from the game rather than
 * chosen. It is the smallest distance that unambiguously means *walked* rather
 * than *settled*: nothing that is not locomotion moves a standing character
 * further than her own body is wide. A stuck character scores exactly 0, so the
 * gap this has to straddle is enormous and the number only has to be honest,
 * not tight.
 */
const MIN_METRES = PLAYER_RADIUS;

/**
 * **How long a key may be held while waiting for that to happen.**
 *
 * Not a fixed hold, and this is the whole reason: distance per second is not a
 * property of the game here, it is a property of the *renderer*. `Loop` clamps
 * `dt` to `MAX_FRAME_DELTA`, so how far she gets is set by how many **frames**
 * elapse, not how many seconds — and a headless park on SwiftShader runs one to
 * two orders of magnitude fewer frames a second than a real one. Measured on
 * this repo's own CI-shaped box: the same 1.2 s hold covered 1.32 m with one
 * browser running and 0.40 m with two. A fixed hold plus a fixed threshold
 * therefore encodes the machine, not the game, and would be flaky — which
 * CLAUDE.md counts as failing.
 *
 * So {@link walkOnce} holds the key and *polls*, releasing the moment she has
 * covered {@link MIN_METRES} and giving up only at this deadline. A fast
 * machine finishes in a fraction of a second; a slow one takes longer and still
 * passes; a broken one waits the full deadline and fails with a real number.
 * For scale, {@link WALKABLE_IN_DEADLINE} is how far top speed would carry her
 * in that time — the headroom this bar is being cleared with.
 */
const MAX_HOLD_MS = 5000;

/** What {@link MAX_HOLD_MS} is worth at top speed, for the message it prints. */
const WALKABLE_IN_DEADLINE = PLAYER_MAX_SPEED * (MAX_HOLD_MS / 1000);

/** How often the poll above looks, in milliseconds. */
const POLL_MS = 150;

/**
 * Ground speed, in m/s, below which she counts as standing still.
 *
 * A hundredth of walking pace: far below anything a frame of real movement
 * produces, far above float dust. See {@link settle}.
 */
const STANDSTILL_SPEED = PLAYER_MAX_SPEED / 100;

/** Longest {@link settle} waits for that standstill. */
const SETTLE_MS = 3000;

/**
 * **The keys a child is told to use, written out here rather than read from
 * the game.**
 *
 * This list is deliberately a *second* statement of the same fact, which is
 * normally the thing CLAUDE.md's "two definitions of one thing" section warns
 * against — and here it is the whole point. A check that takes its expectations
 * from the table it is testing cannot fail: delete `ArrowUp` from
 * `KEYBOARD_MOVE_BINDINGS` and a check built on `Object.keys(...)` would simply
 * stop testing `ArrowUp` and stay green, which is exactly "green can mean
 * incapable of failing".
 *
 * So the two are held apart and then compared ({@link checkBindingsMatch}): the
 * game says what is bound, this says what a player was promised — the HUD's own
 * hint pill, *"WASD or arrows to walk"* — and a disagreement in **either**
 * direction is a foul. A row that vanishes goes red; a ninth movement key
 * added to the game goes red too, which is the prompt to press it here.
 */
const MOVE_KEYS: readonly string[] = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
];

/** Do the game's bindings and {@link MOVE_KEYS} still agree? */
function checkBindingsMatch(): void {
  const bound = Object.keys(KEYBOARD_MOVE_BINDINGS).sort();
  const expected = [...MOVE_KEYS].sort();
  const missing = expected.filter((code) => !bound.includes(code));
  const extra = bound.filter((code) => !expected.includes(code));
  if (missing.length > 0) {
    fouls.push(
      `KEYBOARD_MOVE_BINDINGS no longer binds ${missing.join(', ')} — ` +
        'a key a child is told to walk with is not bound to movement at all ' +
        `(bound now: ${bound.join(', ')})`,
    );
  }
  if (extra.length > 0) {
    fouls.push(
      `KEYBOARD_MOVE_BINDINGS binds ${extra.join(', ')}, which this check does not press — ` +
        "add it to MOVE_KEYS so the new key is actually walked with, don't leave it unchecked",
    );
  }
  say(
    `binding table: ${bound.length} movement keys bound, ${expected.length} expected` +
      `${missing.length + extra.length === 0 ? ' — agree' : ' — DISAGREE'}`,
  );
}

type Place = { readonly x: number; readonly z: number };

type PlayerState = {
  readonly hasGame: boolean;
  readonly place: Place | null;
  readonly riding: boolean | null;
  readonly moveX: number | null;
  readonly moveY: number | null;
  /** `InputSystem.moveAmount` — how hard the merged movement stick is pushed. */
  readonly moveAmount: number | null;
  /** Ground speed in m/s, so a measurement can wait for a real standstill. */
  readonly speed: number | null;
};

const fouls: string[] = [];

/**
 * Printed as it happens, not collected and dumped at the end.
 *
 * Each case here boots a whole park in a software-rendered Chromium, so a run
 * is minutes long; a check that says nothing until it is finished is
 * indistinguishable from a check that has hung, and somebody will kill it.
 *
 * `writeSync`, not `console.log`, and that is the difference between the
 * paragraph above being true and being a wish: Node block-buffers stdout the
 * moment it is not a terminal, so a run whose output is redirected to a file
 * or piped into CI's log shows **nothing at all** until 4 KB has piled up —
 * which for this check is most of the way through. Writing straight to fd 1
 * lands every line the instant it is produced, on a pipe as on a tty.
 */
function say(line: string): void {
  writeSync(1, `${line}\n`);
}

/**
 * Waits until she has actually stopped moving, and reports where that is.
 *
 * Every measurement in this file is a *delta*, so every one of them is wrong if
 * it starts while she is still coasting from the last one. Bounded, so a
 * character genuinely stuck in motion fails the caller rather than hanging it.
 */
async function settle(page: Page): Promise<PlayerState> {
  let state = await readPlayer(page);
  let waitedMs = 0;
  while (waitedMs < SETTLE_MS && (state.speed ?? 0) > STANDSTILL_SPEED) {
    await page.waitForTimeout(POLL_MS);
    waitedMs += POLL_MS;
    state = await readPlayer(page);
  }
  return state;
}

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
      moveAmount: game?.input?.moveAmount ?? null,
      speed: player?.velocity ? Math.hypot(player.velocity.x, player.velocity.z) : null,
    } as PlayerState;
  });
}

async function waitForGame(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { game?: unknown }).game, undefined, {
    timeout: timeoutMs,
  });
}

/**
 * Holds one key down until she has walked {@link MIN_METRES}, or until
 * {@link MAX_HOLD_MS} runs out, and reports how far she actually got.
 *
 * `page.keyboard.down(code)` sends a real `keydown` carrying that exact
 * `KeyboardEvent.code`, which is what `InputSystem.onKeyDown` reads — so a
 * binding renamed on one side of the table and not the other fails here rather
 * than shipping.
 *
 * The key is released in a `finally`: a check that leaves an arrow key held
 * down would poison every measurement after it, and the failure it caused
 * would look like a second, unrelated bug.
 */
async function walkOnce(page: Page, code: string): Promise<{ metres: number; detail: string }> {
  // From rest, for the same reason {@link tapToMove} does: a delta measured
  // while she is still coasting from the previous press is that press's.
  const before = await settle(page);
  if (!before.place) {
    return { metres: Number.NaN, detail: 'the player had no position to read at all' };
  }
  const start = before.place;

  let metres = 0;
  let heldMs = 0;
  let during = before;
  await page.keyboard.down(code);
  try {
    while (heldMs < MAX_HOLD_MS) {
      await page.waitForTimeout(POLL_MS);
      heldMs += POLL_MS;
      during = await readPlayer(page);
      if (!during.place) continue;
      metres = Math.hypot(during.place.x - start.x, during.place.z - start.z);
      if (metres >= MIN_METRES) break;
    }
  } finally {
    await page.keyboard.up(code);
  }

  const detail =
    `${metres.toFixed(3)} m after ${heldMs} ms held ` +
    `(from ${start.x.toFixed(2)},${start.z.toFixed(2)} ` +
    `to ${during.place?.x.toFixed(2)},${during.place?.z.toFixed(2)}; ` +
    `stick mid-press ${during.moveX ?? '?'},${during.moveY ?? '?'} ` +
    `amount ${during.moveAmount ?? '?'}; riding=${during.riding})`;
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
    say(`  [${label}] ${code.padEnd(10)} ${ok ? 'OK' : 'FAILED'}: ${detail}`);
    if (!ok) {
      fouls.push(
        `${label}: ${code} moved her ${Number.isFinite(metres) ? `${metres.toFixed(3)} m` : 'nowhere measurable'} ` +
          `in ${MAX_HOLD_MS} ms of being held down, needs at least ${MIN_METRES.toFixed(3)} m ` +
          `(PLAYER_RADIUS — she never left her own footprint) — ${detail}`,
      );
    }
  }

  await tapToMove(page, label);
}

/**
 * The touch half of the same question: a tap on the park walks her there.
 *
 * There is no on-screen thumbstick — `ui/ScreenControls.ts` is the hop button
 * and nothing else, deliberately (its own header: *"a thumbstick would cover a
 * quarter of a phone screen"*). Walking on a touch screen **is** tap-to-move,
 * so this is the on-screen movement control, and it goes down a completely
 * different road from a key: `PointerControls` → `Selection.handleTap` →
 * `TapNavigator.navigateTo` → `InputSystem.setNavigationMove`, which pushes
 * the same stick a key does but from the other end. A fix aimed only at the
 * keyboard would leave this dead, so it is asked here rather than assumed.
 *
 * A real `mouse.click` on the canvas, not a synthesised event: the pointer
 * pipeline's own filtering (the tap-versus-drag threshold, the UI-element
 * guard) is part of what is under test.
 */
async function tapToMove(page: Page, label: string): Promise<void> {
  // **Standstill first, or this measures the last key press.** She has just
  // been walked eight times; `PLAYER_DECELERATION` needs frames, not
  // milliseconds, to bring her to rest, and at a software renderer's frame rate
  // the fixed settle after a key release can be two frames. Coasting 0.62 m
  // into the poll below would score a pass with the tap doing nothing at all —
  // a check green because it cannot fail.
  const before = await settle(page);
  const viewport = page.viewportSize();
  if (!before.place || !viewport) {
    fouls.push(`${label}: tap-to-move could not be measured (no position or no viewport)`);
    return;
  }
  if ((before.speed ?? 0) > STANDSTILL_SPEED) {
    fouls.push(
      `${label}: could not get her to a standstill before the tap ` +
        `(still ${before.speed?.toFixed(3)} m/s after ${SETTLE_MS} ms), so the tap could not be measured`,
    );
    return;
  }
  // Well below the horizon and off to one side, so the ray lands on open
  // ground a few metres away rather than on the sky or under her own feet.
  await page.mouse.click(viewport.width * 0.32, viewport.height * 0.72);

  // Polled to the same deadline, and for the same reason, as a key hold: how
  // far she gets is set by frames, not seconds. Unlike a key there is nothing
  // to release — the walk ends itself on arrival.
  const start = before.place;
  let metres = 0;
  let waitedMs = 0;
  let after = before;
  while (waitedMs < MAX_HOLD_MS) {
    await page.waitForTimeout(POLL_MS);
    waitedMs += POLL_MS;
    after = await readPlayer(page);
    if (!after.place) continue;
    metres = Math.hypot(after.place.x - start.x, after.place.z - start.z);
    if (metres >= MIN_METRES) break;
  }

  const ok = metres >= MIN_METRES;
  const detail =
    `${metres.toFixed(3)} m after ${waitedMs} ms ` +
    `(${start.x.toFixed(2)},${start.z.toFixed(2)} -> ` +
    `${after.place?.x.toFixed(2)},${after.place?.z.toFixed(2)})`;
  say(`  [${label}] ${'tap-to-move'.padEnd(10)} ${ok ? 'OK' : 'FAILED'}: ${detail}`);
  if (!ok) {
    fouls.push(
      `${label}: a tap on the park moved her ${metres.toFixed(3)} m in ${MAX_HOLD_MS} ms, ` +
        `needs at least ${MIN_METRES.toFixed(3)} m — touch walking (PointerControls -> Selection -> ` +
        `TapNavigator -> InputSystem.setNavigationMove) is dead — ${detail}`,
    );
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
  say(`--- ${label} ---`);
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

checkBindingsMatch();

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
  // She is left standing at the view's own composed stand point, which sits a
  // full `REACH` from the cart by construction — so every one of the eight
  // directions below has more than {@link MIN_METRES} of room before anything
  // solid, whichever way the seed put the stall.
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

if (fouls.length > 0) {
  console.error('\ncheck:walking FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log(
  `\ncheck:walking passed — ${MOVE_KEYS.length} keys plus a tap, x 3 boot paths, ` +
    `each covering at least ${MIN_METRES.toFixed(2)} m (PLAYER_RADIUS) inside ` +
    `${MAX_HOLD_MS} ms, which is ${WALKABLE_IN_DEADLINE.toFixed(0)} m of walking at top speed`,
);
