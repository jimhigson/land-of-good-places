/**
 * **Look at the entrance bridge from a child's eye** — #414.
 *
 *   node scripts/qa-bridge-paths-414.mjs <port> <outDir> [x,z ...]
 *
 * Spawns the real player at each point via `/spawn?pos=x,z`, waits for the
 * park, and photographs it. Needs a `vite` dev server (not `preview`):
 * `window.game` only exists under `import.meta.env.DEV`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5417';
const outDir = process.argv[3] ?? 'qa-out-414';
const spots = process.argv.slice(4);
if (spots.length === 0) throw new Error('give me some x,z spots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

for (const spot of spots) {
  const [x, z] = spot.split(',');
  await page.goto(`http://localhost:${port}/spawn?pos=${x},${z}`, {
    waitUntil: 'load',
    timeout: 120000,
  });
  await page.waitForSelector('.pill--map', { state: 'attached', timeout: 180000 });
  await page.waitForTimeout(3500);

  const info = await page.evaluate(() => {
    const game = window.game;
    if (!game) return { error: 'window.game missing — is this a DEV build?' };
    const p = game.player?.position ?? game.world?.player?.position;
    const bridges = game.world?.train?.bridges ?? [];
    return {
      at: p ? [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.z.toFixed(2))] : null,
      bridges: bridges.length,
    };
  });
  const name = `${outDir}/at_${spot.replace(/[^-\d.,]/g, '').replace(',', '_')}.png`;
  await page.screenshot({ path: name });
  console.log(`  ${spot} -> ${name}  ${JSON.stringify(info)}`);
}

if (errors.length) console.log(`  page errors: ${JSON.stringify(errors.slice(0, 4))}`);
await browser.close();
