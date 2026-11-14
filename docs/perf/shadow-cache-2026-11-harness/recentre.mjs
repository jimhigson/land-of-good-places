// A re-centre seen on screen: world and camera frozen (timeScale 0), the sun held;
// she is teleported 2.6 m so the light re-centres. Frames before and after are
// read back and diffed. Only her own shadow should differ.
// usage: node recentre.mjs <cache 0|1> <tag>
import { launch, waitForGame, sleep, BASE, OUT, writePng } from './lib.mjs';

const cache = process.argv[2] ?? '1';
const tag = process.argv[3] ?? `recentre-${cache}`;
const { browser, page, errors } = await launch();
try {
  await page.goto(`${BASE}/spawn?pos=20,-12&seed=5&shadowCache=${cache}`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page, 60);
  await page.evaluate(() => window.game.world.dayNight.setTimeOfDay(0.5));
  await sleep(2000);
  await page.evaluate(() => { window.game.timeScale = 0; });
  await sleep(1500);
  const r = await page.evaluate(async () => {
    const game = window.game;
    const gl = game.engine.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const light = game.world.dayNight.keyLight;
    const grab = () => new Promise((resolve) => {
      const endFrame = game.engine.endFrame.bind(game.engine);
      game.engine.endFrame = () => {
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        game.engine.endFrame = endFrame;
        endFrame();
        resolve(px);
      };
    });
    const frames = (n) => new Promise((resolve) => { let k = 0; const f = () => (++k >= n ? resolve() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const before = await grab();
    const lightBefore = light.position.toArray();
    const p = game.player.position;
    game.player.teleportTo(p.x + 2.6, p.y, p.z, game.player.facing ?? 0);
    await frames(3);
    const after = await grab();
    const lightAfter = light.position.toArray();
    let changed8 = 0, changed24 = 0, max = 0;
    for (let i = 0; i < before.length; i += 4) {
      const d = Math.max(Math.abs(after[i] - before[i]), Math.abs(after[i + 1] - before[i + 1]), Math.abs(after[i + 2] - before[i + 2]));
      if (d > 8) changed8++;
      if (d > 24) changed24++;
      if (d > max) max = d;
    }
    const toB64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
    return { w, h, changed8, changed24, max, lightBefore, lightAfter, before: toB64(before), after: toB64(after) };
  });
  const moved = r.lightBefore.map((v, i) => (r.lightAfter[i] - v).toFixed(4));
  console.log(`${tag}: light moved by ${moved.join(',')} m; pixels changed >8: ${r.changed8}, >24: ${r.changed24}, max ${r.max}`);
  const flip = (b64) => {
    const raw = Buffer.from(b64, 'base64');
    const out = new Uint8Array(raw.length);
    for (let y = 0; y < r.h; y++) raw.copy(Buffer.from(out.buffer, (r.h - 1 - y) * r.w * 4, r.w * 4), 0, y * r.w * 4, (y + 1) * r.w * 4);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return out;
  };
  const before = flip(r.before);
  const after = flip(r.after);
  const diff = new Uint8Array(before.length);
  for (let i = 0; i < diff.length; i += 4) {
    const d = Math.max(Math.abs(after[i] - before[i]), Math.abs(after[i + 1] - before[i + 1]), Math.abs(after[i + 2] - before[i + 2]));
    const v = Math.min(255, d * 8);
    diff[i] = v; diff[i + 1] = v; diff[i + 2] = v; diff[i + 3] = 255;
  }
  writePng(`${OUT}/${tag}-before.png`, r.w, r.h, before);
  writePng(`${OUT}/${tag}-after.png`, r.w, r.h, after);
  writePng(`${OUT}/${tag}-diff8x.png`, r.w, r.h, diff);
  console.log(`  ${OUT}/${tag}-{before,after,diff8x}.png`, errors.slice(0, 3));
} finally {
  await browser.close();
}
