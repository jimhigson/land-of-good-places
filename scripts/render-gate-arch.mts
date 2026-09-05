/**
 * **Takes the entrance arch's review pictures.**
 *
 * ```
 * pnpm run render:gate-arch
 * ```
 *
 * Starts a Vite dev server on its own port, drives `/gate-arch.html?shot=…`
 * through headless Chromium once per named shot, and writes
 * `art/renders/gate-arch-<shot>.png`.
 *
 * ## Why a browser and not Blender
 *
 * Because what needs judging is the **lettering and the ferris-wheel mark**,
 * and both are canvas textures painted by `src/art/models/gateArch.ts`. A
 * Blender render can only show the arch's shape, or else keep a second copy of
 * the painting — and `ASSET_MANIFEST.md` §32 records what that costs: the
 * bridge kit's build script read its constants properly, its render script
 * hand-copied them, and five committed pictures were of a bridge that was not
 * on the branch. A picture of the wrong thing is exactly as convincing as a
 * picture of the right one.
 *
 * So this renderer copies nothing. It loads the shipped `.glb`, the shipped
 * palette and the shipped child, through the same modules the game does.
 *
 * The list of shots lives in `art/samples/gateArch.ts` — one owner — and this
 * script asks the page for it rather than keeping its own.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const outDir = resolve(repo, 'art/renders');

/** A port nobody else on this machine is on. `--strictPort` makes a clash loud. */
const PORT = 5391;

const SHOTS = [
  'walk-up',
  'walk-up-near',
  'iso',
  'three-quarter',
  'logo',
  'under',
  'from-inside',
] as const;

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`dev server never came up on ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const server = spawn(
    'node',
    [resolve(repo, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'],
    { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += String(d)));
  server.stderr.on('data', (d) => (serverLog += String(d)));

  const base = `http://localhost:${PORT}`;
  try {
    await waitForServer(`${base}/gate-arch.html`);

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(String(e)));

    console.log('\nrender:gate-arch');
    for (const shot of SHOTS) {
      await page.goto(`${base}/gate-arch.html?shot=${shot}`, { waitUntil: 'load' });
      // Wait on the page saying it is built, never on a timer: a slow machine
      // photographing a half-built scene is a picture of a bug that isn't there.
      await page.waitForFunction(() => (window as unknown as { gateArchReady?: boolean }).gateArchReady === true, {
        timeout: 30_000,
      });
      // One more frame, so the canvas holds a rendered image rather than the
      // clear colour.
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const png = await page.screenshot({ type: 'png' });
      const file = resolve(outDir, `gate-arch-${shot}.png`);
      await writeFile(file, png);
      console.log(`  ${shot.padEnd(14)} → ${file}`);
    }

    await browser.close();

    if (problems.length > 0) {
      // A render that logged an error is a render of something broken, however
      // good it looks — the arch's own load-time assertions throw here.
      console.error('\n  the page reported errors:');
      for (const p of problems) console.error(`    ${p}`);
      process.exitCode = 1;
      return;
    }
    console.log(`  ${SHOTS.length} shots written\n`);
  } catch (error) {
    console.error(serverLog);
    throw error;
  } finally {
    // By PID, and only the one this script started.
    server.kill('SIGTERM');
  }
}

await main();
