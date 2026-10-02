import { Mesh, BufferAttribute, Float32BufferAttribute } from 'three';
/**
 * Control for `noDrawnPavingUnderASolid` / `noDrawnPavingOutsideThePark`:
 * copies the drawn paving within 3 m of a point and plants the copy somewhere
 * it must not be. CTRL_MODE=booth: moved from the first stall's stand point
 * onto its booth. CTRL_MODE=outside: from the paving nearest the boundary,
 * moved 4 m out past it. CTRL_MODE=castle: from the castle's doormat, 6 m in
 * under its front wall. CTRL_MODE=rail: onto the rail centre line where the
 * loop is furthest from every station and crossing. The copy keeps its owners, so nothing is exempt.
 */
export default function (facts: any): void {
  const mode = process.env['CTRL_MODE'] ?? 'booth';
  const meshes: any[] = [];
  facts.world.garden.group.traverse((o: any) => { if (o instanceof Mesh && (o.name === 'path-surface' || o.name === 'path-kerb')) meshes.push(o); });
  let from: [number, number];
  let shift: [number, number];
  if (mode === 'rail') {
    // Onto the rail centre line at the point of the loop furthest (along it)
    // from every station and every bridge — inside the fences, nothing carrying it.
    const route = facts.world.train.route;
    const marks = [
      ...facts.world.train.stations.map((st: any) => st.distance),
      ...facts.world.train.crossings.map((c: any) => route.distanceNear(c.x, c.z)),
    ];
    let bestAlong = 0;
    let bestGap = -1;
    for (let a = 0; a < route.length; a += 1) {
      const gap = Math.min(...marks.map((m: number) => Math.abs(((a - m + route.length * 1.5) % route.length) - route.length / 2)));
      if (gap > bestGap) { bestGap = gap; bestAlong = a; }
    }
    const at = { x: 0, z: 0 } as any;
    route.flatPointAt(bestAlong, at);
    let best = Infinity;
    from = [0, 0];
    const p = meshes[0].geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const d = Math.hypot(p.getX(i) - at.x, p.getZ(i) - at.z);
      if (d < best) { best = d; from = [p.getX(i), p.getZ(i)]; }
    }
    shift = [at.x - from[0], at.z - from[1]];
  } else if (mode === 'castle') {
    // From the castle's doormat, 6 m in under its front wall.
    const door = facts.entrances.find((e: any) => e.id === 'anchor:building');
    from = [door.x, door.z];
    shift = [0, -6];
  } else if (mode === 'booth') {
    const stall = facts.stalls[0];
    from = [stall.standX, stall.standZ];
    shift = [stall.drawnX - stall.standX, stall.drawnZ - stall.standZ];
  } else {
    let best = Infinity;
    from = [0, 0];
    const p = meshes[0].geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const d = facts.boundary.distanceToEdge(p.getX(i), p.getZ(i));
      if (d < best) { best = d; from = [p.getX(i), p.getZ(i)]; }
    }
    const len = Math.hypot(from[0], from[1]) || 1;
    shift = [(from[0] / len) * (best + 4), (from[1] / len) * (best + 4)];
  }
  let planted = 0;
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const owners: Int32Array = mesh.userData.vertexOwners;
    const xyz = Array.from(pos.array as Float32Array);
    const newOwners = Array.from(owners);
    const idx = Array.from(index.array as ArrayLike<number>);
    let v = pos.count;
    for (let s = 0; s + 2 < index.count; s += 3) {
      const t = [0, 1, 2].map((k) => index.getX(s + k));
      const cx = t.reduce((a, i) => a + pos.getX(i), 0) / 3;
      const cz = t.reduce((a, i) => a + pos.getZ(i), 0) / 3;
      if (Math.hypot(cx - from[0], cz - from[1]) > 3) continue;
      for (const i of t) { xyz.push(pos.getX(i) + shift[0], pos.getY(i), pos.getZ(i) + shift[1]); newOwners.push(owners[i]!); idx.push(v++); }
      planted += 1;
    }
    mesh.geometry.setAttribute('position', new Float32BufferAttribute(xyz, 3));
    mesh.geometry.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
    mesh.userData.vertexOwners = Int32Array.from(newOwners);
  }
  console.log(`CONTROL ${mode}: planted ${planted} paving triangles from (${from[0].toFixed(1)}, ${from[1].toFixed(1)}) moved by (${shift[0].toFixed(1)}, ${shift[1].toFixed(1)})`);
}
