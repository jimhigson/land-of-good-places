import { Mesh, BufferAttribute } from 'three';
// Deletes drawn paving triangles whose centroid lies in [inner, outer) m of a stall's stand point.
export default function (facts: any): void {
  const id = process.env['CTRL_ID'] ?? 'stall:dodgems';
  const inner = Number(process.env['CTRL_INNER'] ?? 0);
  const outer = Number(process.env['CTRL_OUTER'] ?? 2.5);
  const target = facts.entrances.find((e: any) => e.id === id);
  let removed = 0;
  facts.world.garden.group.traverse((o: any) => {
    if (!(o instanceof Mesh) || (o.name !== 'path-surface' && o.name !== 'path-kerb')) return;
    const pos = o.geometry.getAttribute('position');
    const index = o.geometry.getIndex();
    const keep: number[] = [];
    const n = index ? index.count : pos.count;
    for (let s = 0; s + 2 < n; s += 3) {
      const t = [0, 1, 2].map((k) => (index ? index.getX(s + k) : s + k));
      const cx = t.reduce((a, i) => a + pos.getX(i), 0) / 3;
      const cz = t.reduce((a, i) => a + pos.getZ(i), 0) / 3;
      const d = Math.hypot(cx - target.x, cz - target.z);
      if (d >= inner && d < outer) { removed += 1; continue; }
      keep.push(...t);
    }
    o.geometry.setIndex(new BufferAttribute(new Uint32Array(keep), 1));
  });
  console.log(`CONTROL removed ${removed} paving triangles ${inner}-${outer} m round ${id} at (${target.x.toFixed(2)}, ${target.z.toFixed(2)})`);
}
