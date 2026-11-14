// Control for the audit: blind the cache's survey (it never sees a caster change),
// and the audit must report differing texels. usage: node control.mjs <mode>
// modes: blind (changed() always false), dropMovers (composite draws no movers)
import { launch, waitForGame, sleep, BASE } from './lib.mjs';

const mode = process.argv[2] ?? 'blind';
const { browser, page, errors } = await launch();
try {
  await page.goto(`${BASE}/spawn?pos=0,10&seed=5&shadowCache=1`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page, 120);
  await sleep(1000);
  await page.evaluate((mode) => {
    const cache = window.game.world.dayNight.shadowCache;
    if (mode === 'blind') cache.changed = () => false;
    if (mode === 'staticDropMovers') {
      // The single-pass redraw draws no movers after the tap.
      const orig = cache.renderStatic.bind(cache);
      cache.renderStatic = (...a) => { const saved = cache.movers.slice(); cache.movers.length = 0; try { return orig(...a); } finally { cache.movers.push(...saved); } };
    }
    if (mode === 'dropMovers') {
      const orig = cache.renderComposite.bind(cache);
      cache.renderComposite = (...a) => { cache.movers.length = 0; return orig(...a); };
    }
  }, mode);
  await sleep(1000);
  const forceStatic = process.argv[3] === 'static';
  for (let i = 0; i < 8; i++) {
    const r = await page.evaluate(async (forceStatic) => {
      // 'static': every audited frame is a redraw (the single-pass path).
      if (forceStatic) window.game.world.dayNight.shadowCache.invalidate('forced by the control');
      const a = await window.game.world.dayNight.auditShadowCache();
      return { ...a, reason: window.game.world.dayNight.shadowStats().lastReason };
    }, forceStatic);
    console.log(`${mode} ${String(i).padStart(2)} ${r.frame.padEnd(9)} differing ${String(r.differing).padStart(7)} maxDepthDiff ${r.maxDepthDiff.toExponential(2)} box ${JSON.stringify(r.box)} movers ${r.movers} last=${r.reason}`);
    await sleep(200);
  }
  console.log('errors', errors.slice(0, 5));
} finally {
  await browser.close();
}
