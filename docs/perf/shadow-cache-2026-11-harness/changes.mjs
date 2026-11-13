// A static caster that changes once: every kind of change, each audited on the
// frames after it. usage: node changes.mjs [kind,kind,...]
import { launch, waitForGame, sleep, BASE } from './lib.mjs';

const KINDS = [
  'move', 'hide', 'show', 'remove', 'readd', 'addNew', 'swapMaterial', 'drawRange', 'instanceMove', 'instanceCount',
  'castOff', 'bothOff', 'bothOn', 'materialHidden', 'sideFlip', 'positionAttrSwap', 'indexSwap', 'layerOut', 'layerIn',
  'libraryOutAndIn',
];
const only = process.argv[2] ? process.argv[2].split(',') : KINDS;
const { browser, page, errors } = await launch();
try {
  await page.goto(`${BASE}/spawn?pos=0,10&seed=5&shadowCache=1`, { waitUntil: 'domcontentloaded' });
  await waitForGame(page, 120);
  // Noon: the fewest sun steps, so a change is the only reason to redraw.
  await page.evaluate(() => window.game.world.dayNight.setTimeOfDay(0.5));
  // Hold the sun still (the world keeps moving): a change is then the only reason to redraw.
  await page.evaluate(() => {
    const dn = window.game.world.dayNight;
    const update = dn.update.bind(dn);
    dn.update = (context) => { const t = dn.time; update(context); dn.time = t; };
  });
  await sleep(2500);
  // Pick victims: static, in the sun's view, near her, big enough to see.
  await page.evaluate(() => {
    const cache = window.game.world.dayNight.shadowCache;
    const p = window.game.player.position;
    const pick = (test) => {
      let best = null; let bestD = Infinity;
      for (const [o, e] of cache.entries) {
        if (!e.inStatic || !o.isMesh || !test(o)) continue;
        o.updateWorldMatrix(true, false);
        const d = Math.hypot(o.matrixWorld.elements[12] - p.x, o.matrixWorld.elements[14] - p.z);
        if (d < bestD && d > 2) { bestD = d; best = o; }
      }
      return best;
    };
    const plain = (o) => !o.isInstancedMesh && o.castShadow && o.geometry?.index && (o.geometry.boundingSphere ?? (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere)).radius > 0.3;
    window.__v = {
      mesh: pick(plain),
      mesh2: pick((o) => plain(o) && o !== window.__v?.mesh),
      inst: pick((o) => o.isInstancedMesh && o.castShadow && o.count > 4),
    };
    window.__v.mesh2 = pick((o) => plain(o) && o !== window.__v.mesh);
    window.__v.parent = window.__v.mesh?.parent ?? null;
    const describe = (o) => o && `${o.name || o.type} (${o.parent?.name || o.parent?.type})`;
    window.__vNames = { mesh: describe(window.__v.mesh), mesh2: describe(window.__v.mesh2), inst: describe(window.__v.inst) };
  });
  console.log('victims', JSON.stringify(await page.evaluate(() => window.__vNames)));

  async function auditBurst(label, n = 6) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = await page.evaluate(async () => {
        const a = await window.game.world.dayNight.auditShadowCache();
        return { ...a, reason: window.game.world.dayNight.shadowStats().lastReason };
      });
      out.push(r);
      await sleep(i < 2 ? 50 : 300);
    }
    const bad = out.filter((r) => r.differing > 0);
    console.log(`${label.padEnd(18)} ${bad.length === 0 ? 'ok  ' : 'DIFF'} ${out.map((r) => `${r.frame[0]}${r.differing}`).join(' ')}  reasons: ${[...new Set(out.map((r) => r.reason))].join(' | ')}`);
    return bad.length;
  }

  let failures = 0;
  failures += await auditBurst('baseline');
  for (const kind of only) {
    await page.evaluate((kind) => {
      const v = window.__v;
      const m = v.mesh;
      switch (kind) {
        case 'move': m.position.x += 0.6; m.updateMatrix(); m.updateMatrixWorld(true); break;
        case 'hide': m.visible = false; break;
        case 'show': m.visible = true; break;
        case 'remove': v.parent.remove(m); break;
        case 'readd': v.parent.add(m); break;
        case 'addNew': {
          const Mesh = m.constructor; const p = window.game.player.position;
          const box = new Mesh(m.geometry.clone().scale(1.5, 3, 1.5), m.material);
          box.position.set(p.x + 3, p.y, p.z - 2); box.castShadow = true; box.receiveShadow = true; box.name = 'audit-new-box';
          window.game.engine.scene.add(box); v.added = box; break;
        }
        case 'swapMaterial': m.material = m.material.clone(); break;
        case 'drawRange': { const g = m.geometry.clone(); m.geometry = g; g.setDrawRange(0, Math.floor(g.index.count / 2 / 3) * 3); break; }
        case 'instanceMove': {
          const i = v.inst; const M = i.instanceMatrix.array; M[13] += 2; i.instanceMatrix.needsUpdate = true; break;
        }
        case 'instanceCount': v.inst.count = Math.max(1, v.inst.count - 3); break;
        case 'castOff': v.mesh2.castShadow = false; break;
        case 'bothOff': v.mesh2.castShadow = false; v.mesh2.receiveShadow = false; break;
        case 'bothOn': v.mesh2.castShadow = true; v.mesh2.receiveShadow = true; break;
        case 'materialHidden': v.mesh2.material = v.mesh2.material.clone(); v.mesh2.material.visible = false; break;
        case 'sideFlip': { const mat = v.inst.material; mat.side = mat.side === 2 ? 0 : 2; break; }
        case 'positionAttrSwap': {
          const g = v.mesh2.geometry; const a = g.attributes.position;
          const copy = new a.constructor(new a.array.constructor(a.array), a.itemSize);
          for (let i = 1; i < copy.array.length; i += 3) copy.array[i] *= 1.8;
          g.setAttribute('position', copy); break;
        }
        case 'indexSwap': {
          const g = m.geometry; const idx = g.index;
          const half = new idx.constructor(idx.array.slice(0, Math.floor(idx.count / 6) * 3), 1);
          g.setIndex(half); break;
        }
        case 'layerOut': v.inst.layers.set(5); break;
        case 'layerIn': v.inst.layers.set(0); break;
        case 'libraryOutAndIn': break;
      }
    }, kind);
    if (kind === 'libraryOutAndIn') {
      // A real space change: into the library (iris and all), then back out to its doormat.
      await page.evaluate(() => { const l = window.game.world.library; l.changeToRoom(() => l.enterRoom()); });
      await sleep(4000);
      const inside = await page.evaluate(() => { const p = window.game.player.position; return [p.x.toFixed(0), p.z.toFixed(0), window.game.world.library.inside]; });
      console.log('  inside the library at', inside.join(','));
      await page.evaluate(() => { const l = window.game.world.library; l.spaces.changeTo(() => l.standOutside(l.frame.yaw)); });
      await sleep(1500);
      const outside = await page.evaluate(() => { const p = window.game.player.position; return [p.x.toFixed(0), p.z.toFixed(0), window.game.world.library.inside]; });
      console.log('  back out at', outside.join(','));
      failures += await auditBurst('after library', 8);
      continue;
    }
    failures += await auditBurst(kind);
  }
  console.log(`DONE: ${failures} audits with differing texels`);
  console.log('errors', errors.slice(0, 5));
} finally {
  await browser.close();
}
