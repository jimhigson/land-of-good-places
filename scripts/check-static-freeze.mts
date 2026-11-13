/**
 * **check:static-freeze — a frozen prop that somebody animates must be caught.**
 *
 * `src/world/staticFreeze.ts` turns `matrixAutoUpdate` off on props placed once
 * (120 fps plan, step 13). The failure that invites is silent: a later change
 * animates a frozen object, its position updates, and the picture does not —
 * nothing throws and no node check can see it, because only the browser's
 * scene is frozen (`world/parkStatics.ts` says why).
 *
 * So this loads the real park, lets it play, and asks `auditFrozen` to
 * recompose every frozen node from its position, quaternion and scale. It
 * fails if any stored matrix no longer matches, if a world-frozen node's
 * ancestor has moved — or if **nothing was frozen at all**, which would
 * otherwise pass by measuring an empty set.
 *
 * It needs a dev server (the page imports the audit as a source module):
 * `pnpm run check:served-static-freeze`, or set `CHECK_STATIC_FREEZE_URL`.
 */
import { chromium } from 'playwright-core';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_STATIC_FREEZE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SEED = Number(process.env.CHECK_STATIC_FREEZE_SEED ?? CANONICAL_PARK_SEED);
/** Seconds of play before the audit: long enough for every per-frame animator to have run. */
const PLAY_SECONDS = Number(process.env.CHECK_STATIC_FREEZE_SECONDS ?? 6);
/**
 * Fewest frozen nodes the park may have. Measured 13 Nov 2026 on seed 5:
 * see the run's own printed count. A floor, so that a refactor which stops
 * calling `freezeParkStatics` fails here instead of auditing nothing.
 */
const MIN_FROZEN = 300;

const say = (line: string): void => void process.stderr.write(`check:static-freeze: ${line}\n`);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface PageAudit {
  sceneObjects: number;
  autoUpdateOn: number;
  checked: number;
  worldChecked: number;
  drifted: { path: string; kind: string; delta: number }[];
}

const args = ['--mute-audio', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  const seeds: number[] = [];
  page.on('console', (message) => {
    const said = /park seed (\d+)/.exec(message.text());
    if (said) seeds.push(Number(said[1]));
  });
  // three.js announces every Scene it constructs on this hook; it is the
  // official devtools channel, so no game code has to expose its scene.
  await page.addInitScript(() => {
    const scenes: unknown[] = [];
    const hook = new EventTarget();
    hook.addEventListener('observe', (event) => {
      const detail = (event as CustomEvent<{ isScene?: boolean }>).detail;
      if (detail?.isScene) scenes.push(detail);
    });
    Object.assign(window, { __THREE_DEVTOOLS__: hook, __checkScenes: scenes });
  });
  await page.goto(`${BASE}/spawn?seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // The park is up once its scene holds thousands of objects.
  const deadline = Date.now() + 180_000;
  for (;;) {
    const size = await page.evaluate(() => {
      const scenes = (window as unknown as { __checkScenes: { traverse(visit: () => void): void }[] }).__checkScenes;
      let most = 0;
      for (const scene of scenes) {
        let n = 0;
        scene.traverse(() => n++);
        most = Math.max(most, n);
      }
      return most;
    });
    if (size > 2000) break;
    if (Date.now() > deadline) throw new Error(`the park never appeared at ${BASE}/spawn?seed=${SEED} (largest scene: ${size} objects)`);
    await sleep(500);
  }
  await sleep(PLAY_SECONDS * 1000);
  const audit: PageAudit = await page.evaluate(async () => {
    type Node = { traverse(visit: (node: { matrixAutoUpdate: boolean }) => void): void };
    const scenes = (window as unknown as { __checkScenes: Node[] }).__checkScenes;
    let park: Node | undefined;
    let most = -1;
    for (const scene of scenes) {
      let n = 0;
      scene.traverse(() => n++);
      if (n > most) {
        most = n;
        park = scene;
      }
    }
    if (!park) throw new Error('no scene was observed');
    let autoUpdateOn = 0;
    park.traverse((node) => {
      if (node.matrixAutoUpdate) autoUpdateOn++;
    });
    // The same module instance the game froze with, so the same marker.
    const source = '/src/world/staticFreeze.ts';
    const { auditFrozen } = (await import(/* @vite-ignore */ source)) as {
      auditFrozen(scene: unknown): { checked: number; worldChecked: number; drifted: { path: string; kind: string; delta: number }[] };
    };
    const result = auditFrozen(park);
    return { sceneObjects: most, autoUpdateOn, checked: result.checked, worldChecked: result.worldChecked, drifted: result.drifted };
  });

  if (seeds.length === 0 || seeds.some((seed) => seed !== SEED)) {
    say(`FAIL: asked for park seed ${SEED}, the page reported [${seeds.join(', ')}]`);
    failed = true;
  }
  say(
    `park seed ${SEED}, after ${PLAY_SECONDS} s of play: ${audit.checked} frozen nodes recomposed ` +
      `(${audit.worldChecked} of them world-frozen) of ${audit.sceneObjects} scene objects; ` +
      `${audit.autoUpdateOn} still have matrixAutoUpdate on. Covers the park spawn only — no ride, no interior.`,
  );
  if (!(audit.checked >= MIN_FROZEN)) {
    say(`FAIL: only ${audit.checked} frozen nodes were found, fewer than the floor of ${MIN_FROZEN} — nothing is being frozen, so nothing was audited`);
    failed = true;
  }
  if (audit.drifted.length > 0) {
    say(`FAIL: ${audit.drifted.length} frozen node(s) no longer match their stored matrix — something moves them, and they are not being redrawn where it puts them:`);
    for (const drift of audit.drifted.slice(0, 12)) say(`  ${drift.kind} drift ${drift.delta.toFixed(5)}  ${drift.path}`);
    if (audit.drifted.length > 12) say(`  …and ${audit.drifted.length - 12} more`);
    failed = true;
  }
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;
else say('ok');
