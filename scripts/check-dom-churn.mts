/**
 * **`check:dom-churn` — an idle park does not touch the DOM** (120 fps plan,
 * items 8 and 17; `docs/perf/FRAME-DROPS-2026-11.md`).
 *
 * Counts, never milliseconds, so it means the same on CI's software renderer
 * as on a GPU. With the real player standing at the park spawn on the
 * canonical seed, for {@link SAMPLE_FRAMES} frames:
 *
 * - **DOM mutation records per frame** (a `MutationObserver` over the whole
 *   document: attributes, text, children). A setter called from the frame loop
 *   that writes an unchanged value shows up here as exactly 1.00 a frame.
 * - **Style recalculations and layouts per frame** (Chromium's own counters,
 *   `Performance.getMetrics`). One dirty attribute a frame is one style
 *   recalculation a frame, for a page on which nothing moved.
 * - **`renderer.render` calls per frame** — the sky and the scene, and nothing
 *   else. Item 8 found no post-processing and nothing to win; this is the
 *   line that says so on every run, and goes red the day a full-screen pass
 *   is added without anyone deciding to pay for it.
 *
 * Before `ui/dataFlag.ts`: 3.00 mutation records and 1.00 style recalculation
 * a frame (seed 5, 1000×700, DPR 1, 602 frames). After: see the ceilings.
 *
 * Then, as a note and not an assertion, the same counts **with something
 * selected** (she is stood on the nearest interact zone's stand spot, so the
 * rainbow outline and the action chips are up): the outline's extra draw
 * calls, and whether the chips are written every frame.
 *
 * Run against a dev server (`pnpm run check:served-dom-churn`): it reads
 * `window.game`, which only the dev build exposes.
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_DOM_CHURN_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SEED = Number(process.env.CHECK_DOM_CHURN_SEED ?? CANONICAL_PARK_SEED);
const MEASURE = process.env.MEASURE === '1';
const BOOT_TIMEOUT_MS = 240_000;
/** Frames drawn before sampling: the arrival's own DOM work (prompts, fades) is not the subject. */
const SETTLE_FRAMES = 360;
const SAMPLE_FRAMES = 240;

/**
 * Ceilings, per frame, standing still at the spawn with nothing selected.
 * Measured 0 / 0 / 0 on this commit; the headroom is one stray write in
 * {@link SAMPLE_FRAMES} frames ×12, far below the 1.00 a frame that a single
 * unguarded per-frame setter costs — which is the thing this exists to catch.
 */
const MAX_MUTATIONS_PER_FRAME = 0.05;
/**
 * **Still 1.00 a frame, and this ceiling is that measurement, not a goal.**
 * With the DOM writes gone, what recalculates style every frame is infinite
 * CSS animations ticking on elements nobody can see: `iris-wait-breathe` ×3
 * (the iris's waiting dots) and `boot-breathe` (the boot splash's hint, under
 * `#boot-splash.hidden`). Each fades out before it is hidden, so pausing it
 * needs a "the fade has finished" signal CSS does not have; see
 * {@link MAX_HIDDEN_RUNNING_ANIMATIONS}. Lower this to 0.05 with that fix.
 *
 * 1.25, not 1.05: the count is not exactly frame-locked. It read 249 in 249
 * frames on one run and 257 in 251 (1.02) on another of the same code, and
 * 1.05 left a 3 % margin on a check that had never run on a software
 * renderer. What this ceiling is for is a second recalculation a frame (2.0).
 */
const MAX_STYLE_RECALCS_PER_FRAME = 1.25;
/**
 * Animations in `playState: 'running'` whose target is not painted (an
 * ancestor at `visibility: hidden` or `opacity: 0`), on the idle park.
 * Measured 6 before `lift-glow` was paused under a hidden lift panel, 4 after.
 */
const MAX_HIDDEN_RUNNING_ANIMATIONS = 4;
const MAX_LAYOUTS_PER_FRAME = 0.05;
/** The sky, then the scene (`Game.render`). A third is a new full-screen pass. */
const MAX_RENDER_CALLS_PER_FRAME = 2;

const say = (line: string): void => {
  // stderr: a passing run's coverage note must be audible (CLAUDE.md).
  process.stderr.write(`[dom-churn] ${line}\n`);
};

interface Sample {
  readonly frames: number;
  readonly mutations: number;
  readonly top: readonly (readonly [string, number])[];
  readonly renders: number;
  readonly targetBinds: number;
  readonly draws: number;
  readonly styleRecalcs: number;
  readonly layouts: number;
  readonly selected: string | null;
  readonly at: readonly [number, number];
  /** Names of running animations on targets that are not painted. */
  readonly hiddenAnimations: readonly string[];
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { game?: { player?: unknown; engine?: unknown } }).game;
      return Boolean(g && g.player && g.engine);
    },
    undefined,
    { timeout: BOOT_TIMEOUT_MS, polling: 250 },
  );
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const counts = new Map<string, number>();
    const describe = (n: Node): string => {
      const e = (n.nodeType === 1 ? n : n.parentElement) as Element | null;
      if (!e) return '(detached)';
      const cls = typeof e.className === 'string' && e.className ? `.${e.className.split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${cls}`;
    };
    new MutationObserver((records) => {
      for (const r of records) {
        const key = `${r.type}${r.attributeName ? `[${r.attributeName}]` : ''} ${describe(r.target)}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }).observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
    w['__domCounts'] = counts;

    const game = w['game'] as {
      engine: {
        renderer: {
          render: (...a: unknown[]) => void;
          setRenderTarget: (...a: unknown[]) => void;
          info: { render: { calls: number } };
        };
      };
    };
    const renderer = game.engine.renderer;
    const tally = { frames: 0, renders: 0, targets: 0, draws: 0, drawsThisFrame: 0 };
    const render = renderer.render.bind(renderer);
    renderer.render = (...a: unknown[]) => {
      tally.renders++;
      render(...a);
      // `info.render.calls` resets at each render call, so sum them per frame.
      tally.drawsThisFrame += renderer.info.render.calls;
    };
    const setTarget = renderer.setRenderTarget.bind(renderer);
    renderer.setRenderTarget = (...a: unknown[]) => {
      if (a[0]) tally.targets++;
      setTarget(...a);
    };
    const onFrame = (): void => {
      tally.frames++;
      tally.draws = Math.max(tally.draws, tally.drawsThisFrame);
      tally.drawsThisFrame = 0;
      requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    w['__tally'] = tally;
  });
}

async function frames(page: Page, n: number): Promise<void> {
  const from = await page.evaluate(() => (window as unknown as { __tally: { frames: number } }).__tally.frames);
  await page.waitForFunction(
    (until) => (window as unknown as { __tally: { frames: number } }).__tally.frames >= until,
    from + n,
    { timeout: BOOT_TIMEOUT_MS, polling: 100 },
  );
}

async function sample(context: BrowserContext, page: Page): Promise<Sample> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async (): Promise<Record<string, number>> => {
    const { metrics: list } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(list.map((m) => [m.name, m.value]));
  };
  await frames(page, SETTLE_FRAMES);
  await page.evaluate(() => {
    const w = window as unknown as {
      __domCounts: Map<string, number>;
      __tally: { frames: number; renders: number; targets: number; draws: number };
    };
    w.__domCounts.clear();
    w.__tally.frames = 0;
    w.__tally.renders = 0;
    w.__tally.targets = 0;
    w.__tally.draws = 0;
  });
  const before = await metrics();
  await frames(page, SAMPLE_FRAMES);
  // Read the page's own tally first: the frame count and the DOM counts are
  // then of the same instant, and the browser counters trail by one round trip.
  const got = await page.evaluate(() => {
    const w = window as unknown as {
      __domCounts: Map<string, number>;
      __tally: { frames: number; renders: number; targets: number; draws: number };
      game: { selection?: { selected: { id?: string } | null }; player: { position: { x: number; z: number } } };
    };
    const selected = w.game.selection?.selected ?? null;
    const painted = (element: Element | null): boolean => {
      for (let e = element; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      }
      return element !== null;
    };
    const hiddenAnimations = document
      .getAnimations()
      .filter((a) => a.playState === 'running' && !painted((a.effect as KeyframeEffect | null)?.target ?? null))
      .map((a) => String((a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id));
    return {
      hiddenAnimations,
      tally: { ...w.__tally },
      dom: [...w.__domCounts.entries()].sort((a, b) => b[1] - a[1]),
      selected: selected ? String(selected.id ?? 'something') : null,
      at: [w.game.player.position.x, w.game.player.position.z] as [number, number],
    };
  });
  const after = await metrics();
  await cdp.detach();
  return {
    frames: got.tally.frames,
    mutations: got.dom.reduce((sum, [, n]) => sum + n, 0),
    top: got.dom.slice(0, 8),
    renders: got.tally.renders,
    targetBinds: got.tally.targets,
    draws: got.tally.draws,
    styleRecalcs: (after['RecalcStyleCount'] ?? NaN) - (before['RecalcStyleCount'] ?? NaN),
    layouts: (after['LayoutCount'] ?? NaN) - (before['LayoutCount'] ?? NaN),
    selected: got.selected,
    at: got.at,
    hiddenAnimations: got.hiddenAnimations,
  };
}

const per = (n: number, s: Sample): string => (n / s.frames).toFixed(2);

function report(label: string, s: Sample): void {
  say(
    `${label}: at ${s.at.map((v) => v.toFixed(1)).join(', ')}, selected ${s.selected ?? 'nothing'}, ${s.frames} frames — ` +
      `DOM mutations ${s.mutations} (${per(s.mutations, s)}/frame), style recalcs ${s.styleRecalcs} (${per(s.styleRecalcs, s)}/frame), ` +
      `layouts ${s.layouts} (${per(s.layouts, s)}/frame), renderer.render ${per(s.renders, s)}/frame, ` +
      `render-target binds ${per(s.targetBinds, s)}/frame, draw calls ${s.draws} (busiest frame)`,
  );
  for (const [key, n] of s.top) say(`    ${String(n).padStart(5)}  ${(n / s.frames).toFixed(2)}/frame  ${key}`);
  say(`    running animations on unpainted elements: ${s.hiddenAnimations.length}${s.hiddenAnimations.length ? ` (${s.hiddenAnimations.join(', ')})` : ''}`);
}

try {
  const response = await fetch(`${BASE}/`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  throw new Error(
    `check:dom-churn: nothing is serving ${BASE} (${String(error)}). ` +
      'Run `pnpm run check:served-dom-churn`, or point CHECK_DOM_CHURN_URL at your own dev server.',
  );
}

const failures: string[] = [];
const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  const seeds: number[] = [];
  page.on('pageerror', (e) => errors.push(String((e as Error)?.message ?? e)));
  page.on('console', (message) => {
    const said = /park seed (\d+)/.exec(message.text());
    if (said) seeds.push(Number(said[1]));
  });

  // 1. The assertion: the spawn, nothing selected.
  await page.goto(`${BASE}/spawn?seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await ready(page);
  const idle = await sample(context, page);
  report('idle', idle);

  if (seeds.length === 0) failures.push(`the page never reported its park seed, so the pin to ${SEED} is unproven`);
  else if (seeds.some((s) => s !== SEED)) failures.push(`asked for park seed ${SEED}, the page built ${seeds.join(', ')}`);

  if (!MEASURE) {
    // A probe that counted no frames, or whose browser counters are missing,
    // has measured nothing: say that, rather than pass on 0 <= ceiling.
    if (!(idle.frames >= SAMPLE_FRAMES)) failures.push(`sampled ${idle.frames} frames, wanted ${SAMPLE_FRAMES} — nothing is measured`);
    if (!(idle.renders >= idle.frames)) failures.push(`counted ${idle.renders} render calls in ${idle.frames} frames — the renderer hook is not counting`);
    if (!Number.isFinite(idle.styleRecalcs) || !Number.isFinite(idle.layouts)) {
      failures.push(`Chromium reported no style/layout counters (${idle.styleRecalcs}, ${idle.layouts}) — nothing is measured`);
    }
    if (idle.selected !== null) failures.push(`something is selected at the spawn (${idle.selected}); the idle sample must have nothing selected — move it`);
    const check = (what: string, count: number, ceiling: number): void => {
      const rate = count / idle.frames;
      if (rate > ceiling) {
        failures.push(
          `${what}: ${count} in ${idle.frames} frames = ${rate.toFixed(2)} a frame, ceiling ${ceiling} — ` +
            `standing still at the spawn. Busiest: ${idle.top.slice(0, 4).map(([k, n]) => `${n}× ${k}`).join('; ') || '(no DOM mutation recorded)'}`,
        );
      }
    };
    check('DOM mutation records', idle.mutations, MAX_MUTATIONS_PER_FRAME);
    check('style recalculations', idle.styleRecalcs, MAX_STYLE_RECALCS_PER_FRAME);
    check('layouts', idle.layouts, MAX_LAYOUTS_PER_FRAME);
    check('renderer.render calls', idle.renders, MAX_RENDER_CALLS_PER_FRAME);
    if (idle.hiddenAnimations.length > MAX_HIDDEN_RUNNING_ANIMATIONS) {
      failures.push(
        `${idle.hiddenAnimations.length} CSS animations are running on elements nobody can see, ceiling ${MAX_HIDDEN_RUNNING_ANIMATIONS}: ` +
          `${idle.hiddenAnimations.join(', ')} — each one is a style recalculation every frame; pause it while its panel is hidden`,
      );
    }
  }

  // 2. A note, not an assertion: the same counts with the rainbow outline up.
  const stand = await page.evaluate(() => {
    const g = (window as unknown as {
      game: {
        world: { interactZones(): { id: string; standX: number; standZ: number }[] };
        player: { position: { x: number; z: number } };
      };
    }).game;
    const { x, z } = g.player.position;
    const zones = g.world.interactZones().filter((zone) => Number.isFinite(zone.standX) && Number.isFinite(zone.standZ));
    zones.sort((a, b) => Math.hypot(a.standX - x, a.standZ - z) - Math.hypot(b.standX - x, b.standZ - z));
    const nearest = zones[0];
    return nearest ? { id: nearest.id, x: nearest.standX, z: nearest.standZ } : null;
  });
  if (!stand) {
    say('selected: NOT MEASURED — the park reported no interact zone to stand at');
  } else {
    await page.goto(`${BASE}/spawn?pos=${stand.x.toFixed(2)},${stand.z.toFixed(2)}&seed=${SEED}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await ready(page);
    const selected = await sample(context, page);
    report(`selected (stood at ${stand.id}'s stand spot)`, selected);
    if (selected.selected === null) {
      say('selected: NOT MEASURED — nothing was selected there, so the outline counts above are of an unselected park');
    } else if (!MEASURE && selected.renders / selected.frames > MAX_RENDER_CALLS_PER_FRAME) {
      failures.push(
        `renderer.render ${per(selected.renders, selected)} a frame with ${selected.selected} selected, ceiling ${MAX_RENDER_CALLS_PER_FRAME} — ` +
          'the rainbow outline is a shell in the scene (one draw call), never a pass of its own',
      );
    }
  }
  if (errors.length > 0) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close().catch(() => {});
}

say(
  `style recalculation is still allowed up to ${MAX_STYLE_RECALCS_PER_FRAME} a frame: ` +
    'animations ticking on hidden elements (the iris dots, the boot hint) are NOT fixed, only counted',
);
say(`asserted on the idle spawn only (park seed ${SEED}, ${SAMPLE_FRAMES} frames); the selected sample is asserted for render calls alone, and other spaces and mini-games are not covered`);
if (MEASURE) {
  say('MEASURE=1: counts printed, nothing asserted');
} else if (failures.length > 0) {
  console.error(`\ncheck:dom-churn FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exitCode = 1;
} else {
  console.log('check:dom-churn: an idle park writes nothing to the DOM and draws in two render calls.');
}
