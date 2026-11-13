// Moving things and space changes, audited on consecutive sun frames.
// usage: node scenes2.mjs [rail-race,train,trampoline,library,reptile]
import { launch, waitForGame, sleep, BASE } from './lib.mjs';

/** In the page: audit `n` consecutive sun frames (each answered on the next one drawn). */
async function chain(page, n, label) {
  const rows = await page.evaluate(async (n) => {
    const dn = window.game.world.dayNight;
    const out = [];
    for (let i = 0; i < n; i++) {
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
      const a = await Promise.race([dn.auditShadowCache(), timeout]);
      const p = window.game.player.position;
      out.push(a ? { f: a.frame[0], d: a.differing, m: a.movers, why: dn.shadowStats().lastReason, x: p.x, z: p.z } : null);
    }
    return out;
  }, n);
  const ok = rows.filter(Boolean);
  const bad = ok.filter((r) => r.d > 0);
  console.log(`${label.padEnd(26)} ${bad.length ? 'DIFF' : 'ok  '} ${ok.length}/${n} audited: ${ok.map((r) => `${r.f}${r.d}`).join(' ')}`);
  console.log(`${''.padEnd(31)}movers ${[...new Set(ok.map((r) => r.m))].join(',')}  at ${ok.length ? `${ok[0].x.toFixed(1)},${ok[0].z.toFixed(1)} -> ${ok.at(-1).x.toFixed(1)},${ok.at(-1).z.toFixed(1)}` : '-'}  why: ${[...new Set(ok.map((r) => r.why))].slice(0, 4).join(' | ')}`);
  return bad.length;
}

const SCENES = {
  async 'rail-race'(page) {
    await page.goto(`${BASE}/rail-race?seed=5&shadowCache=1`, { waitUntil: 'domcontentloaded' });
    await waitForGame(page, 60);
    await page.waitForFunction(() => window.game.world.railRace.phase === 'levelSelect', null, { timeout: 60000 });
    await page.evaluate(() => window.game.world.railRace.chooseLevel(1));
    await sleep(3500);
    await page.keyboard.down('KeyW');
    let bad = 0;
    for (let i = 0; i < 4; i++) {
      bad += await chain(page, 10, `rail race racing ${i}`);
      for (let t = 0; t < 4; t++) { await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space'); await sleep(200); }
    }
    await page.keyboard.up('KeyW');
    return bad;
  },
  async train(page) {
    await page.goto(`${BASE}/spawn?pos=0,10&seed=5&shadowCache=1`, { waitUntil: 'domcontentloaded' });
    await waitForGame(page, 60);
    let bad = 0;
    for (let i = 0; i < 3; i++) {
      // Stand her a few metres off the locomotive's side, wherever it has got to.
      const at = await page.evaluate(() => {
        const loco = window.game.world.train.locomotive.root;
        const p = loco.getWorldPosition(loco.position.clone());
        const g = window.game.player;
        g.teleportTo(p.x + 6, p.y + 0.5, p.z + 6, 0);
        return [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), window.game.world.train.runningSpeed.toFixed(2)];
      });
      console.log(`  locomotive at ${at.slice(0, 3).join(',')} speed ${at[3]}`);
      await sleep(600);
      bad += await chain(page, 12, `train passing ${i}`);
      await sleep(2500);
    }
    return bad;
  },
  async trampoline(page) {
    await page.goto(`${BASE}/slide?seed=5&shadowCache=1`, { waitUntil: 'domcontentloaded' });
    await waitForGame(page, 60);
    await sleep(9000); // ride down, then she is back in the park
    const at = await page.evaluate(() => {
      const t = window.game.world.building.trampoline;
      const p = t.group.getWorldPosition(t.group.position.clone());
      window.game.player.teleportTo(p.x + 2.5, p.y + 0.3, p.z + 2.5, 0);
      return [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1)];
    });
    console.log(`  trampoline at ${at.join(',')}`);
    await sleep(800);
    let bad = 0;
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.game.world.building.trampoline.bounce());
      bad += await chain(page, 10, `trampoline bouncing ${i}`);
      await sleep(1200);
    }
    return bad;
  },
  async library(page) {
    await page.goto(`${BASE}/spawn?pos=0,10&seed=5&shadowCache=1`, { waitUntil: 'domcontentloaded' });
    await waitForGame(page, 60);
    await sleep(1000);
    let bad = await chain(page, 4, 'park before');
    await page.evaluate(() => { const l = window.game.world.library; l.changeToRoom(() => l.enterRoom()); });
    await sleep(4000);
    // Out, and audit from the first sun frame on: the iris, then the park.
    const both = page.evaluate(() => { const l = window.game.world.library; l.spaces.changeTo(() => l.standOutside(l.frame.yaw)); });
    bad += await chain(page, 24, 'library -> park, frames 1-24');
    await both;
    bad += await chain(page, 6, 'park after');
    return bad;
  },
  async reptile(page) {
    await page.goto(`${BASE}/reptile-house?seed=5&shadowCache=1`, { waitUntil: 'domcontentloaded' });
    await waitForGame(page, 60);
    await sleep(2500);
    await page.evaluate(() => { const r = window.game.world.reptileHouse; r.spaces.changeTo(() => r.leaveToOutside()); });
    let bad = await chain(page, 24, 'reptile house -> park 1-24');
    await sleep(500);
    bad += await chain(page, 6, 'park after');
    return bad;
  },
};

const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(SCENES);
let total = 0;
for (const name of only) {
  const { browser, page, errors } = await launch();
  try {
    const bad = await SCENES[name](page);
    total += bad;
    console.log(`== ${name}: ${bad} audits differing; page errors ${errors.length}${errors.length ? ` (${errors[0]})` : ''}`);
  } catch (error) {
    console.log(`== ${name}: FAILED ${String(error?.message ?? error).split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}
console.log(`TOTAL differing audits: ${total}`);
