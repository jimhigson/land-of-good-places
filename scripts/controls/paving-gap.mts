import { Mesh, BufferAttribute } from 'three';
// Deletes drawn paving triangles whose centroid lies in [inner, outer) m of a stall's stand point.
export default function (facts: any): void {
  const id = process.env['CTRL_ID'] ?? 'stall:dodgems';
  const inner = Number(process.env['CTRL_INNER'] ?? 0);
  const outer = Number(process.env['CTRL_OUTER'] ?? 2.5);
  const target = facts.entrances.find((e: any) => e.id === id);
  // CTRL_HOTEL_OVERLAP=1: instead, cut just the paving in under the hotel's
  // doors — the DOOR_PAVING_OVERLAP stretch past their drawn front.
  const hotelOverlap = process.env['CTRL_HOTEL_OVERLAP'] === '1';
  const hotel = facts.plots.find((p: any) => p.id === 'hotel');
  const band = facts.world.hotel.towerDoorBand();
  const ox = Math.sin(band.yaw);
  const oz = Math.cos(band.yaw);
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
      if (hotelOverlap) {
        const along = (cx - hotel.x) * ox + (cz - hotel.z) * oz;
        const across = Math.abs((cx - hotel.x) * oz - (cz - hotel.z) * ox);
        if (along < 1.77 && along > 0.5 && across < 2) { removed += 1; continue; }
        keep.push(...t);
        continue;
      }
      const d = Math.hypot(cx - target.x, cz - target.z);
      if (d >= inner && d < outer) { removed += 1; continue; }
      keep.push(...t);
    }
    o.geometry.setIndex(new BufferAttribute(new Uint32Array(keep), 1));
  });
  console.log(hotelOverlap ? `CONTROL removed ${removed} paving triangles in under the hotel doors` : `CONTROL removed ${removed} paving triangles ${inner}-${outer} m round ${id} at (${target.x.toFixed(2)}, ${target.z.toFixed(2)})`);
}
