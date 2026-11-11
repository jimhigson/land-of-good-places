/**
 * Browser QA: **does a tap on an interior's way out take her out?** — not part
 * of the build or the gate; the real-finger half of `check:doorframes` §6,
 * kept for re-running on a preview (QA on #743: a tap in the hotel's or the
 * Reptile House's doorway stranded her under the arch).
 *
 *   node scripts/qa-doorway-tap.mjs <baseUrl> <outDir>
 *
 * Needs a **dev** build (it reads `window.game`, which only a dev build sets)
 * to find where each doorway is on screen; the tap itself is a real touch
 * event on a 390×844 touch screen. For each interior, from its own deep link,
 * it taps the middle of the opening on the wall line, then reports whether
 * she left the room within a few seconds, with a screenshot.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://127.0.0.1:5791').replace(/\/$/, '');
const outDir = process.argv[3] ?? 'qa-out';
mkdirSync(outDir, { recursive: true });

const save = {
  v: 1,
  at: Date.now(),
  purchases: 0,
  game: {
    parkName: 'QA Park',
    mode: 'sandbox',
    money: 500,
    player: { name: 'Eleri' },
    world: { timeOfDay: 600, dayCount: 0, lightsOn: false },
    inventory: [],
    carriedUid: null,
  },
  flags: { createdCharacter: true, arrivedByBus: true, hotelKey: true, dexPrizeSeen: true },
};

const rooms = [
  { name: 'hotel', path: '/hotel', frame: 'hotel' },
  { name: 'reptile', path: '/reptile-house', frame: 'reptileHouse' },
  { name: 'library', path: '/library', frame: 'library' },
  { name: 'castle', path: '/castle?deck=0', frame: 'building' },
];

const browser = await chromium.launch({
  executablePath: process.env.QA_CHROME ?? chromium.executablePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let failed = 0;
for (const room of rooms) {
  for (const where of ['wall line', '0.5 m inside']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    await context.addInitScript((file) => window.localStorage.setItem('lgp:save', JSON.stringify(file)), save);
    const page = await context.newPage();
    await page.goto(`${base}${room.path}`, { waitUntil: 'load' });
    await page.waitForTimeout(Number(process.env.QA_WAIT ?? 20000));
    // The camera may still be gliding in (a room's arrival shot); wait until
    // the doorway's screen point holds still before tapping it.
    const locate = () => page.evaluate(
      ([system, inset]) => {
        const game = window.game;
        const placed = game.world[system].exitDoorFrame;
        const o = placed.frame.opening;
        const x = placed.originX + (o.minX + o.maxX) / 2;
        const z = placed.originZ + o.z - inset;
        const y = placed.originY + o.floorY;
        const v = game.player.position.clone().set(x, y, z).project(game.camera.camera);
        const r = game.renderer?.domElement?.getBoundingClientRect?.() ?? document.querySelector('canvas').getBoundingClientRect();
        return { sx: r.left + ((v.x + 1) / 2) * r.width, sy: r.top + ((1 - v.y) / 2) * r.height, from: [game.player.position.x, game.player.position.z] };
      },
      [room.frame, where === 'wall line' ? 0 : 0.5],
    );
    let target = await locate();
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(500);
      const again = await locate();
      const still = Math.hypot(again.sx - target.sx, again.sy - target.sy) < 1.5;
      target = again;
      if (still) break;
    }
    await page.touchscreen.tap(target.sx, target.sy);
    await page.waitForTimeout(300);
    // Where the finger landed and where the walk was aimed, room-local to the wall line.
    const aimed = await page.evaluate((system) => {
      const game = window.game;
      const placed = game.world[system].exitDoorFrame;
      const wallZ = placed.originZ + placed.frame.opening.z;
      const n = game.tapNavigator;
      const f = (v) => (v ? `${(v.x - placed.originX).toFixed(2)}, ${(v.y - placed.originY).toFixed(2)}, ${(wallZ - v.z).toFixed(2)} in` : 'none');
      return `hit ${f(n.hit)} -> walk to ${f(n.target)}; selected ${game.selection?.selected?.id ?? 'nothing'}`;
    }, room.frame);
    await page.waitForTimeout(20000);
    const after = await page.evaluate(() => [window.game.player.position.x, window.game.player.position.z]);
    const moved = Math.hypot(after[0] - target.from[0], after[1] - target.from[1]);
    const out = moved > 50;
    if (!out) failed += 1;
    const file = `${outDir}/tap-${room.name}-${where.replace(/\W+/g, '-')}.png`;
    await page.screenshot({ path: file });
    console.log(`${out ? 'OUT ' : 'STUCK'} ${room.name.padEnd(8)} tap at the ${where} (${target.sx.toFixed(0)}, ${target.sy.toFixed(0)} px): moved ${moved.toFixed(1)} m; ${aimed}  ${file}`);
    await context.close();
  }
}
await browser.close();
process.exit(failed > 0 ? 1 : 0);
