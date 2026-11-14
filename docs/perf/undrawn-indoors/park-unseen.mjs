// The pixel proof that nothing of the park is seen from inside any room — the
// condition for taking it out of the scene graph there (World.parkRoots).
//
//   node docs/perf/undrawn-indoors/park-unseen.mjs <base> <outDir>
//
// Needs a build that exposes `window.game` (a dev server does). In each room,
// three screenshots a few frames apart: A and B with the park's groups as they
// are, C with every one of them hidden. diff(A,B) is what the room's own
// animation changes on its own; diff(B,C) is that plus whatever the park
// contributed. If the park is unseen, the two are the same size.
//
// Works on either side of the change: before it, the park's groups hang off
// the scene and are hidden by `visible`; after it, each is a `garden` root of
// `DrawnSpaces`, already out of the graph indoors — hiding the groups then
// changes nothing, which is the point.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOMS = { hotel: '/hotel', library: '/library', reptile: '/reptile-house', mall: '/castle?deck=0', hall: '/castle?deck=1', roof: '/castle?deck=2' };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
try {
  for (const [name, path] of Object.entries(ROOMS)) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    const sep = path.includes('?') ? '&' : '?';
    await page.goto(`${base}${path}${sep}seed=5`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 240; i++) {
      await sleep(500);
      if (await page.evaluate(() => Boolean(window.game?.world)).catch(() => false)) break;
    }
    await sleep(9000);
    const frames = (n) => page.evaluate((k) => new Promise((done) => { let left = k; const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); }), n);
    const setPark = (shown) => page.evaluate((s) => { const w = window.game.world; for (const g of w.parkGroups) if (g !== w.npcs.group) g.visible = s; }, shown);
    const shot = async (tag) => { const png = await page.screenshot(); fs.writeFileSync(`${outDir}/${name}-${tag}.png`, png); return png.toString('base64'); };
    await setPark(true);
    await frames(3);
    const a = await shot('A');
    await frames(3);
    const b = await shot('B');
    await setPark(false);
    await frames(3);
    const c = await shot('C-park-hidden');
    await setPark(true);
    const result = await page.evaluate(async ([pa, pb, pc]) => {
      const decode = async (b64) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [A, B, C] = await Promise.all([decode(pa), decode(pb), decode(pc)]);
      const diff = (x, y) => { let n = 0; for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) > 8 || Math.abs(x[i + 1] - y[i + 1]) > 8 || Math.abs(x[i + 2] - y[i + 2]) > 8) n++; return n; };
      return { pixels: A.length / 4, noise: diff(A, B), parkToggle: diff(B, C) };
    }, [a, b, c]);
    const space = await page.evaluate(() => { const p = window.game.player.position; return `${p.x.toFixed(1)},${p.z.toFixed(1)}`; });
    console.log(JSON.stringify({ room: name, at: space, ...result }));
    await context.close();
  }
} finally {
  await browser.close();
}
