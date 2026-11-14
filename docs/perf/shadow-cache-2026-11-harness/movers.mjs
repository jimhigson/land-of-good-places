// Who are the per-frame movers when she stands still? Prints each mover's ancestry.
import { launch, waitForGame, sleep, BASE } from './lib.mjs';

const path = process.argv[2] ?? '/spawn?pos=0,10';
const { browser, page, errors } = await launch();
try {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}seed=5&shadowCache=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForGame(page, 240);
  await sleep(2000);
  const result = await page.evaluate(() => {
    const cache = window.game.world.dayNight.shadowCache;
    const chain = (o) => {
      const names = [];
      for (let p = o; p; p = p.parent) names.push(p.name || p.type);
      return names.reverse().slice(1).join(' > ');
    };
    const groups = {};
    for (const m of cache.movers) {
      // group by the first two named ancestors
      const c = chain(m);
      const key = c.split(' > ').slice(0, 3).join(' > ');
      (groups[key] ??= []).push(`${m.name || m.type}${m.isInstancedMesh ? `[inst ${m.count}]` : ''}`);
    }
    return { count: cache.movers.length, groups };
  });
  console.log(`movers: ${result.count}`);
  for (const [k, v] of Object.entries(result.groups).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(v.length).padStart(4)}  ${k}   e.g. ${v.slice(0, 4).join(', ')}`);
  }
  console.log('errors', errors.slice(0, 5));
} finally {
  await browser.close();
}
