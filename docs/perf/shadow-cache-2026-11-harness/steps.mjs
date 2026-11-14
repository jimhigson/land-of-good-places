// Sun steps, seen on screen. The world is frozen; only the sun moves, at its real
// rate (one 120 Hz frame of a 150 s day per drawn frame). Every frame is read back
// and diffed with the one before. usage: node steps.mjs '<path>' <time> <cache 0|1> <frames> <tag>
import fs from 'node:fs';
import { launch, waitForGame, sleep, BASE, OUT, writePng } from './lib.mjs';

const path = process.argv[2] ?? '/spawn?pos=20,-12';
const time = Number(process.argv[3] ?? 0.5);
const cache = process.argv[4] ?? '1';
const frames = Number(process.argv[5] ?? 120);
const tag = process.argv[6] ?? `steps-${cache}`;
const { browser, page, errors } = await launch();
try {
  await page.goto(`${BASE}${path}${path.includes('?') ? '&' : '?'}seed=5&shadowCache=${cache}`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page, 60);
  await page.evaluate((t) => window.game.world.dayNight.setTimeOfDay(t), time);
  await sleep(2000);
  await page.evaluate(() => { window.game.timeScale = 0; });
  await sleep(1500); // everything settles into the cache
  const result = await page.evaluate(async ({ time, frames }) => {
    const game = window.game;
    const dn = game.world.dayNight;
    const renderer = game.engine.renderer;
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const STEP = 1 / 120 / 150; // one 120 Hz frame of the 150 s day
    let k = 0;
    const update = dn.update.bind(dn);
    dn.update = (context) => { dn.time = time + k * STEP; k++; update(context); };
    const light = dn.keyLight;
    let prev = null;
    let cur = new Uint8Array(w * h * 4);
    const rows = [];
    let best = { score: -1 };
    let lastLight = light.matrixWorld.elements.slice();
    const endFrame = game.engine.endFrame.bind(game.engine);
    return await new Promise((resolve) => {
      game.engine.endFrame = () => {
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, cur);
        const m = light.matrixWorld.elements;
        let lightMoved = false;
        for (let i = 0; i < 16; i++) if (m[i] !== lastLight[i]) { lightMoved = true; break; }
        lastLight = m.slice();
        if (prev) {
          let changed8 = 0, changed24 = 0, max = 0, sum = 0;
          for (let i = 0; i < cur.length; i += 4) {
            const d = Math.max(Math.abs(cur[i] - prev[i]), Math.abs(cur[i + 1] - prev[i + 1]), Math.abs(cur[i + 2] - prev[i + 2]));
            if (d > 8) changed8++;
            if (d > 24) changed24++;
            if (d > max) max = d;
            sum += d;
          }
          rows.push({ k, lightMoved, changed8, changed24, max, mean: sum / (w * h) });
          if (changed8 > best.score) best = { score: changed8, k, before: prev.slice(), after: cur.slice() };
        }
        const swap = prev ?? new Uint8Array(w * h * 4);
        prev = cur;
        cur = swap;
        endFrame();
        if (rows.length >= frames) {
          game.engine.endFrame = endFrame;
          dn.update = update;
          const toB64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
          resolve({ w, h, rows, best: best.k === undefined ? null : { k: best.k, before: toB64(best.before), after: toB64(best.after) } });
        }
      };
    });
  }, { time, frames });
  const { w, h, rows } = result;
  const steps = rows.filter((r) => r.lightMoved);
  const quiet = rows.filter((r) => !r.lightMoved);
  const stat = (list, key) => (list.length ? `${Math.min(...list.map((r) => r[key]))}..${Math.max(...list.map((r) => r[key]))}` : '-');
  console.log(`${tag}: ${rows.length} frames, light moved on ${steps.length}`);
  console.log(`  frames where the light moved: changed>8 ${stat(steps, 'changed8')}  changed>24 ${stat(steps, 'changed24')}  max ${stat(steps, 'max')}`);
  console.log(`  frames where it did not:      changed>8 ${stat(quiet, 'changed8')}  changed>24 ${stat(quiet, 'changed24')}  max ${stat(quiet, 'max')}`);
  fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(rows));
  if (result.best) {
    const flip = (b64) => {
      const raw = Buffer.from(b64, 'base64');
      const out = new Uint8Array(raw.length);
      for (let y = 0; y < h; y++) raw.copy(Buffer.from(out.buffer, (h - 1 - y) * w * 4, w * 4), 0, y * w * 4, (y + 1) * w * 4);
      for (let i = 3; i < out.length; i += 4) out[i] = 255;
      return out;
    };
    const before = flip(result.best.before);
    const after = flip(result.best.after);
    writePng(`${OUT}/${tag}-before.png`, w, h, before);
    writePng(`${OUT}/${tag}-after.png`, w, h, after);
    const diff = new Uint8Array(before.length);
    for (let i = 0; i < diff.length; i += 4) {
      const d = Math.max(Math.abs(after[i] - before[i]), Math.abs(after[i + 1] - before[i + 1]), Math.abs(after[i + 2] - before[i + 2]));
      const v = Math.min(255, d * 8);
      diff[i] = v; diff[i + 1] = v; diff[i + 2] = v; diff[i + 3] = 255;
    }
    writePng(`${OUT}/${tag}-diff8x.png`, w, h, diff);
    console.log(`  biggest change at frame ${result.best.k}: ${OUT}/${tag}-{before,after,diff8x}.png`);
  }
  console.log('errors', errors.slice(0, 3));
} finally {
  await browser.close();
}
