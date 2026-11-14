// Audit the cache in many scenes. usage: node scenes.mjs [name,name,...]
import fs from 'node:fs';
import { launch, waitForGame, sleep, BASE, OUT } from './lib.mjs';

const SCENES = {
  'park-morning': { path: '/spawn?pos=0,10', audits: 10 },
  'park-noon': { path: '/spawn?pos=0,10', time: 0.5, audits: 10 },
  'park-sunset': { path: '/spawn?pos=0,10', time: 0.735, audits: 10 },
  'park-dusk': { path: '/spawn?pos=0,10', time: 0.77, audits: 6 },
  'park-walking': { path: '/spawn?pos=0,10', walk: true, audits: 16 },
  'rail-race': { path: '/rail-race', settle: 6000, audits: 16 },
  ferris: { path: '/ferris', settle: 3000, audits: 16 },
  'sky-cruiser': { path: '/sky-cruiser', settle: 3000, audits: 16 },
  slide: { path: '/slide', settle: 2000, audits: 12 },
  'cat-bus': { path: '/arrive', settle: 500, audits: 16, gap: 400 },
  hotel: { path: '/hotel', audits: 6 },
  library: { path: '/library', audits: 6 },
  'reptile-house': { path: '/reptile-house', audits: 6 },
  'castle-0': { path: '/castle?deck=0', audits: 6 },
};

const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(SCENES);
const summary = [];
for (const name of only) {
  const scene = SCENES[name];
  if (!scene) throw new Error(`no scene ${name}`);
  const { browser, page, errors } = await launch();
  const rows = [];
  try {
    const url = `${BASE}${scene.path}${scene.path.includes('?') ? '&' : '?'}seed=5&shadowCache=1`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForGame(page, 60);
    if (scene.time !== undefined) await page.evaluate((t) => window.game.world.dayNight.setTimeOfDay(t), scene.time);
    await sleep(scene.settle ?? 1500);
    const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
    let k = 0;
    for (let i = 0; i < scene.audits; i++) {
      if (scene.walk && i % 4 === 0) {
        await page.keyboard.up(keys[(k + 3) % 4]);
        await page.keyboard.down(keys[k++ % 4]);
      }
      const r = await page.evaluate(async () => {
        const dn = window.game.world.dayNight;
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
        const a = await Promise.race([dn.auditShadowCache(), timeout]);
        const s = dn.shadowStats();
        const p = window.game.player.position;
        return {
          audit: a,
          reason: s.lastReason,
          t: dn.timeOfDay,
          riding: window.game.player.riding ?? null,
          pos: [Number(p.x.toFixed(1)), Number(p.y.toFixed(1)), Number(p.z.toFixed(1))],
        };
      });
      rows.push(r);
      const a = r.audit;
      console.log(
        `${name.padEnd(14)} ${String(i).padStart(2)} ` +
          (a
            ? `${a.frame.padEnd(9)} differing ${String(a.differing).padStart(7)} drawn ${String(a.drawnTexels).padStart(7)} max ${a.maxDepthDiff.toExponential(1)} box ${JSON.stringify(a.box)} movers ${a.movers} static ${a.staticMeshes}`
            : 'no sun frame in 3 s (sun not drawn here)') +
          ` t=${r.t.toFixed(3)} at ${r.pos} riding=${r.riding} last=${r.reason}`,
      );
      await sleep(scene.gap ?? 150 + Math.random() * 300);
    }
    for (const key of keys) await page.keyboard.up(key);
  } catch (error) {
    console.log(`${name}: FAILED ${String(error?.message ?? error).split('\n')[0]}`);
  } finally {
    await browser.close();
  }
  const audited = rows.filter((r) => r.audit);
  const bad = audited.filter((r) => r.audit.differing > 0);
  const kinds = audited.reduce((m, r) => ((m[r.audit.frame] = (m[r.audit.frame] ?? 0) + 1), m), {});
  const line = `${name}: ${audited.length}/${rows.length} audited, ${bad.length} differing; frames ${JSON.stringify(kinds)}; page errors ${errors.length}${errors.length ? ` (${errors[0]})` : ''}`;
  summary.push(line);
  console.log(`== ${line}`);
}
console.log('\nSUMMARY\n' + summary.join('\n'));
fs.appendFileSync(`${OUT}/scenes-summary.txt`, `${new Date().toISOString()}\n${summary.join('\n')}\n`);
