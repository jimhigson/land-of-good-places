import { Mesh, BufferAttribute, Float32BufferAttribute } from 'three';
/**
 * Control for `pathsMeetBridgesOnlyAtTheirEnds`: copies the paving a bridge
 * carries over its span, turns the copy 90 degrees about the crossing so it runs
 * straight through both parapets, and files it under CTRL_MODE's owner:
 * `other` — another route (rule 1), `carried` — the carried route itself (rule 2).
 * `beside` instead slides an untouched copy 2.5 m sideways (no turn), filed under
 * another route: paving lying along the bridge's flank, off its deck (rule 1).
 */
export default function (facts: any): void {
  const mode = process.env['CTRL_MODE'] ?? 'other';
  const bridge = facts.world.train.bridges[0];
  const crossing = facts.world.train.crossings.find((c: any) => bridge.deckCovers(c.x, c.z));
  let mesh: any = null;
  facts.world.garden.group.traverse((o: any) => { if (o instanceof Mesh && o.name === 'path-surface') mesh = o; });
  const pos = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  const owners: Int32Array = mesh.userData.vertexOwners;
  const picked: number[][] = [];
  let carriedOwner = -99;
  for (let s = 0; s + 2 < index.count; s += 3) {
    const t = [0, 1, 2].map((k) => index.getX(s + k));
    const cx = t.reduce((a, i) => a + pos.getX(i), 0) / 3;
    const cz = t.reduce((a, i) => a + pos.getZ(i), 0) / 3;
    if (Math.hypot(cx - crossing.x, cz - crossing.z) < 5 && bridge.deckCovers(cx, cz)) { picked.push(t); carriedOwner = owners[t[0]]; }
  }
  const owner = mode === 'carried' ? carriedOwner : (carriedOwner === 0 ? 1 : 0);
  // The spine's direction, from the carried triangles' spread.
  const cs = picked.map((t) => [t.reduce((a, i) => a + pos.getX(i), 0) / 3, t.reduce((a, i) => a + pos.getZ(i), 0) / 3]);
  let best = [0, 0];
  for (const a of cs) for (const b of cs) if (Math.hypot(a[0] - b[0], a[1] - b[1]) > Math.hypot(best[0], best[1])) best = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(best[0], best[1]) || 1;
  const side = [-best[1] / len * 2.5, best[0] / len * 2.5];
  const base = pos.count;
  const xyz = Array.from(pos.array as Float32Array);
  const newOwners = Array.from(owners);
  const idx = Array.from(index.array as ArrayLike<number>);
  let v = base;
  for (const t of picked) {
    for (const i of t) {
      const dx = pos.getX(i) - crossing.x;
      const dz = pos.getZ(i) - crossing.z;
      if (mode === 'beside') xyz.push(pos.getX(i) + side[0], pos.getY(i), pos.getZ(i) + side[1]);
      else xyz.push(crossing.x - dz, pos.getY(i), crossing.z + dx);
      newOwners.push(owner);
      idx.push(v++);
    }
  }
  mesh.geometry.setAttribute('position', new Float32BufferAttribute(xyz, 3));
  mesh.geometry.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  mesh.userData.vertexOwners = Int32Array.from(newOwners);
  console.log(`CONTROL planted ${picked.length} paving triangles turned 90° across bridge at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)}), owner ${owner} (${mode}; carried is ${carriedOwner})`);
}
