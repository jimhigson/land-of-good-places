/**
 * **`check:no-midwalk-links` — once the park is on screen, walking anywhere in
 * it makes no shader program, and no frame waits on a link.**
 *
 * ```
 * pnpm run check:served-no-midwalk-links          # starts its own dev server
 * CHECK_NO_MIDWALK_LINKS_URL=http://127.0.0.1:6311 pnpm run check:no-midwalk-links
 * BOOTS=spawn,continue,bus …                      # which boots (default: all three)
 * ENGINE=webkit …                                 # Safari's engine instead of Chromium
 * SWIFTSHADER=1 …                                 # the software rasteriser CI has
 * ```
 *
 * ## The bug it exists for
 *
 * Jim's iPhone, 15 Nov 2026, after a continued save: *"fine at 60 fps for a
 * while, and then suddenly long pauses"* — 247 ms frames within five seconds
 * of walking. three.js makes a material's program the first time it draws it,
 * and the first draw with a program waits for the GPU to finish linking it.
 * On this check's tour of seed 5's park against `main` 44952060, **95
 * programs were made after it was on screen, and 83 first uses waited on a
 * link** (continuing a save before dusk: 97, and 86): the night's light count (dusk falls a minute into a game — a day
 * is 150 s), every caster's shadow-depth program as the sun's shadow camera
 * followed her to it, the fountain statue's faded materials, and seventeen
 * from the warm-up itself, which counted a slice's own lights twice. Each is
 * a few milliseconds on an M4 and a long frame on a phone. The mechanism that
 * now makes all of them behind the cover is `boot/shaderWarmup.ts`.
 *
 * ## What it does
 *
 * For each boot — **`spawn`** (a deep link: no bus, the boot's cover),
 * **`continue`** (a continued save, its clock set just before dusk, through
 * "Keep playing!"), **`bus`** (`/arrive`: the cat-bus ride, the park built
 * and warmed behind it) and **`skip`** (the same ride, its skip pressed the
 * moment it is offered — before the warm-up is done, so the boot's cover
 * finishes it, with her still on the arrival's bus) — in a fresh browser on
 * {@link CANONICAL_PARK_SEED}:
 *
 * 1. waits for the park to be revealed — the boot's cover let go, or the bus
 *    handed over and the arrival done;
 * 2. from then on records **every program made** (`renderer.info.programs`,
 *    each attributed to the draw or `compile()` that made it — object,
 *    material, main pass or shadow) and **every first use of a program**
 *    (three reads a program's uniforms back the first time it draws with it;
 *    that is the moment a frame waits for a link);
 * 3. tours the park: every interactable, the fountain statue from behind
 *    (it fades), and a grid over the whole park, each stood on and walked a
 *    step from, **by day and by night** — the clock pinned at each stop — and
 *    through **dusk** and **dawn** with the clock running, where the park's
 *    lights switch; and opens the keychain shop's view, which glides the park
 *    camera in with no cover and hides the lamp posts from its shot;
 * 4. asserts that nothing was made and nothing first used, and that she
 *    never left the park (a door would be a room's warm-up, behind its own
 *    iris — `gpu:first-entry`'s question, not this one).
 *
 * It counts, never times: a program is a program on SwiftShader as on an
 * iPhone, so this can gate CI. Frame times are `gpu:first-entry`'s and
 * `gpu:frame-time`'s, on a real GPU.
 *
 * **Proven red before trusted green** — see the PR that added it for the
 * transcript against `main` 2f28ee01 and the geometry it was proved against.
 */
import { chromium, webkit, type Browser, type Page } from 'playwright-core';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_NO_MIDWALK_LINKS_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SEED = Number(process.env.CHECK_NO_MIDWALK_LINKS_SEED ?? CANONICAL_PARK_SEED);
const BOOTS = (process.env.BOOTS ?? 'spawn,continue,bus,skip').split(',').filter(Boolean);
const ENGINE = process.env.ENGINE === 'webkit' ? 'webkit' : 'chromium';
/** A cold dev server builds every chunk on first ask; SwiftShader is slow. */
const BOOT_TIMEOUT_MS = 300_000;
/** How long she walks from each stop: long enough for the camera and the sun's shadow camera to follow. */
const STEP_MS = Number(process.env.STEP_MS ?? 600);
/** Grid spacing over the park, metres. */
const GRID_M = 24;
/** Clock positions (0 = midnight): a morning, a night, and the edges dusk and dawn are run across. */
const DAY_CLOCK = 0.42;
const NIGHT_CLOCK = 0.92;
const BEFORE_DUSK = 0.728;
const BEFORE_DAWN = 0.238;
/**
 * Stops walked after the park's lighting has switched at dusk or dawn, so the
 * frames just after the switch — where the new lighting's programs are first
 * drawn — are walked in, not only the frame of it.
 */
const AFTER_SWITCH_STOPS = 3;
/**
 * The longest the clock may take to run across dusk or dawn, in real time. It
 * runs on the frame's `dt`, and under a hosted runner's software renderer a
 * frame is slow: walking for a fixed four seconds never reached dusk there
 * (the bus and skip boots saw the park only by day). So the crossing waits
 * on the park's own lighting changing, and this is only the ceiling.
 */
const ACROSS_LIMIT_MS = 90_000;

type Boot = 'spawn' | 'continue' | 'bus' | 'skip';

/**
 * Every how-many-th stop a boot's tour stands on. The deep link tours the
 * whole park by day and by night; the bus and the skip are other ways into
 * the same warm-up, so a third of the stops by day and the dusk crossing is
 * their share — it kept shard 13 inside its cap on a hosted runner.
 */
const STRIDE: Record<Boot, number> = { spawn: 1, continue: 1, bus: 3, skip: 3 };

interface Born {
  readonly t: number;
  readonly phase: string;
  readonly via: string;
  readonly shader: string;
  readonly object: string;
  readonly material: string;
  readonly at: string;
}

interface Result {
  readonly boot: Boot;
  readonly programsAtReveal: number;
  readonly programsAtEnd: number;
  readonly born: readonly Born[];
  readonly firstUses: number;
  readonly firstUseWaits: number;
  readonly stops: number;
  readonly phases: readonly string[];
  readonly leftThePark: readonly string[];
  /** Dusk or dawn crossings whose lighting never changed within {@link ACROSS_LIMIT_MS}. */
  readonly unswitched: readonly string[];
  readonly lightCounts: readonly number[];
  /** Whether the boot's own cover was held (a `boot` hold) — what the `skip` boot exists to exercise. */
  readonly bootCoverHeld: boolean;
  readonly errors: readonly string[];
}

const say = (line: string): void => {
  // stderr: a passing run's coverage note must be audible (CLAUDE.md).
  process.stderr.write(`[no-midwalk-links] ${line}\n`);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Before the page's own scripts: counts every first use of a program (three
 * asks `ACTIVE_UNIFORMS` once per program, building its uniforms; with
 * shader-error checking on, dev builds ask `getProgramInfoLog` first) and
 * whether the link was still running then (`COMPLETION_STATUS_KHR`).
 */
function firstUseProbe(): void {
  const COMPLETION_STATUS_KHR = 0x91b1;
  const ACTIVE_UNIFORMS = 0x8b86;
  const probe = { counting: false, firstUses: 0, waits: 0, parallel: null as boolean | null };
  (window as unknown as { __firstUse: typeof probe }).__firstUse = probe;
  const used = new WeakSet<object>();
  const protos: (WebGL2RenderingContext | WebGLRenderingContext)[] = [];
  if (typeof WebGL2RenderingContext !== 'undefined') protos.push(WebGL2RenderingContext.prototype);
  if (typeof WebGLRenderingContext !== 'undefined') protos.push(WebGLRenderingContext.prototype);
  for (const proto of protos) {
    const getParameter = proto.getProgramParameter;
    const getLog = proto.getProgramInfoLog;
    const getExtension = proto.getExtension;
    const note = (gl: WebGLRenderingContext, program: WebGLProgram): void => {
      if (used.has(program)) return;
      used.add(program);
      if (!probe.counting) return;
      probe.firstUses += 1;
      if (probe.parallel === null) probe.parallel = getExtension.call(gl, 'KHR_parallel_shader_compile') !== null;
      if (!probe.parallel || getParameter.call(gl, program, COMPLETION_STATUS_KHR) === false) probe.waits += 1;
    };
    proto.getProgramParameter = function (this: WebGLRenderingContext, program: WebGLProgram, pname: number) {
      if (pname === ACTIVE_UNIFORMS) note(this, program);
      return getParameter.call(this, program, pname);
    } as typeof proto.getProgramParameter;
    proto.getProgramInfoLog = function (this: WebGLRenderingContext, program: WebGLProgram) {
      note(this, program);
      return getLog.call(this, program);
    } as typeof proto.getProgramInfoLog;
  }
}

/** In the page, once the park is revealed: from now on, every program made is recorded with what made it. */
function startRecording(): number {
  interface Program {
    readonly cacheKey: string;
    readonly name?: string;
  }
  interface Obj {
    readonly name: string;
    readonly type: string;
    readonly parent: Obj | null;
    readonly isInstancedMesh?: boolean;
    readonly instanceColor?: unknown;
    getWorldPosition(target: { x: number; y: number; z: number }): { x: number; z: number };
  }
  const g = (window as unknown as { game: any }).game;
  const renderer = g.engine.renderer;
  const programs: Program[] = renderer.info.programs;
  const known = new Set<Program>(programs);
  const state = {
    born: [] as Born[],
    phase: 'revealed',
    t0: performance.now(),
    programsAtReveal: programs.length,
    lightCounts: new Set<number>(),
    /** The lights the last frame of the park was drawn with. */
    lastLights: -1,
  };
  (window as unknown as { __noMidwalk: typeof state }).__noMidwalk = state;
  let length = programs.length;
  let tail = programs[programs.length - 1];
  const scan = (via: string, object: Obj | null, material: { name?: string; type: string } | null): void => {
    if (programs.length === length && programs[programs.length - 1] === tail) return;
    length = programs.length;
    tail = programs[programs.length - 1];
    for (const program of programs) {
      if (known.has(program)) continue;
      known.add(program);
      let path = '';
      for (let o: Obj | null = object, i = 0; o && i < 4; o = o.parent, i += 1) path += (path ? '<' : '') + (o.name || o.type);
      const p = g.player.position;
      state.born.push({
        t: Math.round(performance.now() - state.t0),
        phase: state.phase,
        via,
        shader: program.cacheKey.split(',')[0] ?? '?',
        object: path + (object?.isInstancedMesh ? ' [instanced]' : ''),
        material: material ? `${material.name || ''}(${material.type})` : '',
        at: `${p.x.toFixed(0)},${p.z.toFixed(0)} ${g.world.dayNight.formatClock()}`,
      });
    }
  };
  const draw = renderer.renderBufferDirect.bind(renderer);
  renderer.renderBufferDirect = (camera: unknown, scene: { isScene?: boolean } | null, geometry: unknown, material: { name?: string; type: string }, object: Obj, group: unknown) => {
    const out = draw(camera, scene, geometry, material, object, group);
    scan(scene === null ? 'shadow pass' : 'draw', object, material);
    return out;
  };
  const compile = renderer.compile.bind(renderer);
  renderer.compile = (scene: unknown, camera: unknown, target: unknown) => {
    const out = compile(scene, camera, target);
    scan('compile()', null, null);
    return out;
  };
  const render = renderer.render.bind(renderer);
  renderer.render = (scene: { traverseVisible(fn: (o: { isLight?: boolean; layers: { test(l: unknown): boolean } }) => void): void }, camera: { layers: unknown }) => {
    if (scene === g.engine.scene) {
      let lights = 0;
      scene.traverseVisible((o) => {
        if (o.isLight && o.layers.test(camera.layers)) lights += 1;
      });
      state.lightCounts.add(lights);
      state.lastLights = lights;
    }
    return render(scene, camera);
  };
  (window as unknown as { __firstUse: { counting: boolean } }).__firstUse.counting = true;
  return programs.length;
}

/** In the page: where to stand — every interactable, behind the statue, and a grid over the park. */
function stops(gridM: number): [number, number][] {
  const g = (window as unknown as { game: any }).game;
  const out: [number, number][] = [];
  const add = (x: number, z: number, apart: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    // The park only: every room is its own plate hundreds of metres out
    // (the castle's decks at (600, 600)), and its interactables are listed too.
    if (Math.abs(x) > 150 || Math.abs(z) > 150) return;
    if (out.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < apart)) return;
    out.push([x, z]);
  };
  // Behind the statue as the camera sees it — the camera looks from +x,+z —
  // so it fades.
  const c = g.world.fountain.centre;
  add(c.x - 3.5, c.z - 3.5, 1);
  add(c.x - 5, c.z - 1.5, 1);
  // Never on a doorway: a door is a room's iris, which is not this check's.
  const doorLike = /door|entrance|hotel|library|reptile|castle|front|exit/i;
  for (const zone of g.world.interactZones()) {
    const id = String(zone.id ?? zone.label ?? '');
    if (doorLike.test(id)) continue;
    add(zone.x ?? zone.position?.x, zone.z ?? zone.position?.z, 10);
  }
  for (let x = -96; x <= 96; x += gridM) for (let z = -96; z <= 96; z += gridM) add(x, z, gridM / 2);
  return out;
}

/**
 * The park is on screen: the boot's cover has let go — or, after the bus, the
 * game has been handed the screen (`window.game` is set the moment it is),
 * when the park is drawn under the arrival with no cover at all.
 */
async function revealed(page: Page, boot: Boot): Promise<void> {
  await page.waitForFunction(
    (bus) => {
      const g = (window as unknown as { game?: any }).game;
      if (!g?.player || !g.revealHold || g.revealHold.holding) return false;
      return bus || g.revealHold.holds.length > 0;
    },
    boot === 'bus' || boot === 'skip',
    { timeout: BOOT_TIMEOUT_MS, polling: 50 },
  );
}

/** The bus has pulled up and let her off: she can be stood somewhere. */
async function arrived(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { game: any }).game;
      const arrival = g.world.entrance.arrival;
      return (arrival === null || arrival.finished === true) && !g.player.riding;
    },
    null,
    { timeout: BOOT_TIMEOUT_MS, polling: 250 },
  );
}

async function walkAStep(page: Page, i: number): Promise<void> {
  const keys = ['w', 'd', 's', 'a'];
  const key = keys[i % keys.length]!;
  await page.keyboard.down(key);
  await sleep(STEP_MS);
  await page.keyboard.up(key);
}

async function tour(page: Page, phases: readonly string[], stride: number): Promise<{ stops: number; left: string[]; unswitched: string[] }> {
  const where = await page.evaluate(stops, GRID_M);
  const unswitched: string[] = [];
  const left: string[] = [];
  let visited = 0;
  const setPhase = (phase: string): Promise<void> => page.evaluate((p) => {
    (window as unknown as { __noMidwalk: { phase: string } }).__noMidwalk.phase = p;
  }, phase);
  const clock = (t: number): Promise<void> => page.evaluate((time) => (window as unknown as { game: any }).game.world.dayNight.setTimeOfDay(time), t);
  const standAt = async (x: number, z: number, i: number): Promise<void> => {
    await page.evaluate(([px, pz]) => (window as unknown as { game: any }).game.enterDebugSpawn(px, pz), [x, z] as const);
    await walkAStep(page, i);
    const inPark = await page.evaluate(() => (window as unknown as { game: any }).game.world.parkDrawn === true);
    if (!inPark) left.push(`(${x.toFixed(0)}, ${z.toFixed(0)})`);
    visited += 1;
  };
  for (const phase of phases) {
    await setPhase(phase);
    if (phase === 'day' || phase === 'night') {
      for (let i = 0; i < where.length; i += stride) {
        await clock(phase === 'day' ? DAY_CLOCK : NIGHT_CLOCK);
        const [x, z] = where[i]!;
        await standAt(x, z, i);
      }
      // The keychain shop's view hides the lamp posts from its shot; at night
      // it once took their lights out of the park with them (`LampPosts.
      // setHiddenBehindView`). Its view glides in with no cover, so open it.
      await clock(phase === 'day' ? DAY_CLOCK : NIGHT_CLOCK);
      const opened = await page.evaluate(() => (window as unknown as { game: any }).game.world.keychainShop.requestOpen() === true);
      if (opened) {
        await sleep(1500);
        await page.evaluate(() => (window as unknown as { game: any }).game.world.keychainShop.closeView());
        await sleep(300);
        visited += 1;
      }
    } else {
      // Across the switch with the clock running, walking from stop to stop
      // until the park's lighting has changed — the lights the frame is drawn
      // with, as `startRecording` counts them — and a few stops after.
      await clock(phase === 'dusk' ? BEFORE_DUSK : BEFORE_DAWN);
      const before = await page.evaluate(() => (window as unknown as { __noMidwalk: { lastLights: number } }).__noMidwalk.lastLights);
      const started = Date.now();
      let after = -1;
      for (let i = 0; after < AFTER_SWITCH_STOPS; i += 1) {
        const [x, z] = where[(i * 7) % where.length]!;
        await standAt(x, z, i);
        if (after >= 0) after += 1;
        else if ((await page.evaluate(() => (window as unknown as { __noMidwalk: { lastLights: number } }).__noMidwalk.lastLights)) !== before) after = 0;
        if (after < 0 && Date.now() - started > ACROSS_LIMIT_MS) {
          unswitched.push(phase);
          break;
        }
      }
    }
  }
  return { stops: visited, left, unswitched };
}

async function openBrowser(): Promise<Browser> {
  if (ENGINE === 'webkit') return webkit.launch({ headless: true });
  const args = ['--mute-audio', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
  return chromium.launch({ channel: 'chromium', headless: true, args });
}

async function runBoot(boot: Boot): Promise<Result> {
  const browser = await openBrowser();
  const errors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String((error as Error)?.message ?? error)));
    await page.addInitScript(firstUseProbe);
    const seed = `seed=${SEED}`;
    if (boot === 'continue') {
      // A save to continue: a park played for a moment, its clock then set a
      // few park minutes before dusk — so the lights come on as she walks,
      // which is Jim's report exactly.
      await page.goto(`${BASE}/spawn?pos=0,0&${seed}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await revealed(page, 'spawn');
      await page.waitForFunction(() => localStorage.getItem('lgp:save') !== null, null, { timeout: 60_000 });
      await page.evaluate((t) => {
        const save = JSON.parse(localStorage.getItem('lgp:save') ?? '{}');
        // The park clock lives under `game.world` (`state/save.ts`'s `readWorld`).
        save.game = { ...save.game, world: { ...save.game?.world, timeOfDay: t, lightsOn: false } };
        // A returning player's save: she has come by bus before, so "Keep
        // playing!" goes straight to the park. A deep link never sets this,
        // and without it the continue plays the bus ride — the `bus` boot.
        save.flags = { ...save.flags, arrivedByBus: true };
        localStorage.setItem('lgp:save', JSON.stringify(save));
      }, BEFORE_DUSK);
      // No autosave between the edit and the reload: the next is 5 s away.
      await page.goto(`${BASE}/?${seed}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.locator('.welcome-keep').click({ timeout: BOOT_TIMEOUT_MS });
    } else if (boot === 'bus') {
      await page.goto(`${BASE}/arrive?${seed}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } else if (boot === 'skip') {
      // The bus ride, skipped the moment it may be: the park is built but its
      // warm-up has not begun, so the boot's cover must do all of it — with
      // her still on the arrival's cat bus. Pressed from inside the page, the
      // instant the button is offered: on a phone the warm-up behind the bus
      // takes seconds and a child's press lands in the middle of it, but on a
      // desktop it is done before a press from out here arrives, and the boot
      // would quietly be the bus boot again.
      await page.addInitScript(() => {
        new MutationObserver((records, observer) => {
          for (const record of records) {
            const root = record.target as Element;
            if (root.classList?.contains('journey-skip--ready')) {
              observer.disconnect();
              root.querySelector<HTMLButtonElement>('.journey-skip__button')?.click();
              return;
            }
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
      });
      await page.goto(`${BASE}/arrive?${seed}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } else {
      await page.goto(`${BASE}/spawn?${seed}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
    await revealed(page, boot);
    const programsAtReveal = await page.evaluate(startRecording);
    // A continued save opens "what's new" when there is any, and it pauses the
    // park behind it: nothing would walk and no clock would run.
    await page.evaluate(() => (window as unknown as { game: any }).game.whatsNew?.close?.());
    // The arrival plays in the park, on screen: recorded, then toured after.
    if (boot === 'bus' || boot === 'skip') await arrived(page);
    // The continued save's clock is set before dusk: walk through it first.
    const phases = boot === 'continue' ? ['dusk', 'night', 'dawn'] : boot === 'bus' || boot === 'skip' ? ['day', 'dusk'] : ['day', 'dusk', 'night', 'dawn'];
    const { stops: visited, left, unswitched } = await tour(page, phases, STRIDE[boot]);
    await sleep(500);
    const end = await page.evaluate(() => {
      const w = window as unknown as {
        __noMidwalk: { born: Born[]; lightCounts: Set<number> };
        __firstUse: { firstUses: number; waits: number };
        game: any;
      };
      return {
        born: w.__noMidwalk.born,
        lightCounts: [...w.__noMidwalk.lightCounts].sort((a, b) => a - b),
        firstUses: w.__firstUse.firstUses,
        waits: w.__firstUse.waits,
        programs: w.game.engine.renderer.info.programs.length as number,
        bootCoverHeld: (w.game.revealHold.holds as { why: string }[]).some((h) => h.why.split('+').includes('boot')),
      };
    });
    return {
      boot,
      programsAtReveal,
      programsAtEnd: end.programs,
      born: end.born,
      firstUses: end.firstUses,
      firstUseWaits: end.waits,
      stops: visited,
      phases,
      leftThePark: left,
      unswitched,
      lightCounts: end.lightCounts,
      bootCoverHeld: end.bootCoverHeld,
      errors,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

try {
  const response = await fetch(`${BASE}/`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  throw new Error(
    `check:no-midwalk-links: nothing is serving ${BASE} (${String(error)}). ` +
      'Run `pnpm run check:served-no-midwalk-links`, or point CHECK_NO_MIDWALK_LINKS_URL at your own dev server.',
  );
}

const failures: string[] = [];
for (const boot of BOOTS as Boot[]) {
  const started = Date.now();
  let result: Result;
  try {
    result = await runBoot(boot);
  } catch (error) {
    failures.push(`${boot}: ${String((error as Error)?.message ?? error).split('\n')[0]}`);
    say(`${boot}: FAILED to run (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    continue;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  say(
    `${boot.padEnd(8)} programs ${result.programsAtReveal} at reveal -> ${result.programsAtEnd} after ${result.stops} stops ` +
      `(${result.phases.join(', ')}); made after reveal: ${result.born.length}; first uses after reveal: ${result.firstUses} ` +
      `(${result.firstUseWaits} waited on a link); light counts seen: ${result.lightCounts.join('/')}; ${secs} s`,
  );
  for (const b of result.born.slice(0, 40)) {
    say(`  + ${String(b.t).padStart(6)} ms ${b.phase.padEnd(7)} ${b.via.padEnd(11)} ${b.shader.padEnd(9)} ${b.object} ${b.material} @ ${b.at}`);
  }
  if (result.born.length > 40) say(`  … and ${result.born.length - 40} more`);
  if (boot === 'skip') {
    // Said on every run: if the warm-up beat the skip, this boot was the bus
    // boot again and the cover it exists to test never went up.
    say(
      result.bootCoverHeld
        ? 'skip: the skip landed before the warm-up was done, and the boot\'s cover held for the rest — the path this boot exists for'
        : 'skip: the warm-up was already done when the skip landed, so no boot cover was held — this run covered only the bus path',
    );
  }
  if (result.errors.length > 0) failures.push(`${boot}: page errors: ${result.errors.slice(0, 3).join(' | ')}`);
  if (result.stops < 10) failures.push(`${boot}: only ${result.stops} stops visited — the tour covers nothing, so a pass would say nothing`);
  if (result.lightCounts.length < 2 && result.phases.some((p) => p === 'dusk' || p === 'night')) {
    failures.push(`${boot}: the park was only ever drawn under ${result.lightCounts.join('/')} lights — the clock never reached the park's other lighting, so its programs went untested`);
  }
  if (boot === 'skip' && !result.bootCoverHeld) {
    failures.push('skip: no boot cover was held — the skip landed after the warm-up was done, so the path this boot exists for went untested');
  }
  if (result.unswitched.length > 0) {
    failures.push(`${boot}: the park's lighting never changed across ${result.unswitched.join(' and ')} within ${ACROSS_LIMIT_MS / 1000} s — that lighting's programs went untested`);
  }
  if (result.leftThePark.length > 0) {
    failures.push(`${boot}: she left the park at ${result.leftThePark.slice(0, 4).join(', ')} — a stop is inside a room; move it, the room is gpu:first-entry's`);
  }
  if (result.born.length > 0) {
    const first = result.born[0]!;
    failures.push(
      `${boot}: ${result.born.length} shader program(s) made after the park was on screen — the first by the ${first.via} of ` +
        `${first.object} ${first.material} at ${first.at} (${first.phase}). Each is a link a phone waits for mid-walk; ` +
        'the park\'s warm-up (boot/shaderWarmup.ts) must make it behind the cover.',
    );
  }
  if (result.firstUses > 0) {
    failures.push(`${boot}: ${result.firstUses} program(s) first used after the park was on screen (${result.firstUseWaits} waited on a link)`);
  }
}

say(`boots: ${BOOTS.join(', ')} on park seed ${SEED}, ${ENGINE}${process.env.SWIFTSHADER === '1' ? ' (SwiftShader)' : ''}; programs counted, not timed — frame time is gpu:first-entry's`);
if (failures.length > 0) {
  process.stderr.write(`\ncheck:no-midwalk-links FAILED — ${failures.length} clause(s):\n  - ${failures.join('\n  - ')}\n`);
  process.exitCode = 1;
} else {
  say('no program made and none first used after the park was on screen, by day, by night, across dusk and dawn. ✓');
}
