/** TEMP: can a door's arrival lead be SNAPPED to a shared lattice line
 * without changing its outward ray or lengthening the lead much?
 *
 * The lead is a fixed 3.5 m out along `entrance - plotCentre` (`arrivalLead`).
 * The ray carries the meaning ("which way in"); the 3.5 is arbitrary ("a few
 * metres out"). So this asks, per door: at what distance `t` along that same
 * ray does the lead's row or column land on a 12 m or 6 m shared line?
 *
 * CONTROL: the current 3.5 m lead's own off-line distance is printed beside
 * each candidate, so a door already on a line is visible as such rather than
 * being counted as a snap. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PARK_LAYOUT } from '../src/world/parkLayout.ts';
import { PLAZA } from '../src/world/paths.ts';

quietly(() => buildHeadlessPark());
const plazaX = PLAZA.x;
const plazaZ = PLAZA.z;
const pitch = 12; // STREET_PITCH, not exported
console.log(`plaza (${plazaX.toFixed(2)},${plazaZ.toFixed(2)}) pitch=${pitch}`);

const offLine = (v: number, origin: number): number => {
  const full = Math.abs(v - origin - Math.round((v - origin) / pitch) * pitch);
  const half = Math.abs(v - origin - Math.round((v - origin) / (pitch / 2)) * (pitch / 2));
  return Math.min(full, half);
};
/** distances t>0 along the ray at which `origin + dir*t` lands on a shared line */
const snaps = (start: number, dir: number, axisOrigin: number): number[] => {
  if (Math.abs(dir) < 1e-6) return [];
  const out: number[] = [];
  for (const step of [pitch, pitch / 2]) {
    for (let k = -12; k <= 12; k += 1) {
      const line = axisOrigin + k * step;
      const t = (line - start) / dir;
      if (t > 0.5 && t < 14) out.push(t);
    }
  }
  return [...new Set(out.map((t) => Number(t.toFixed(2))))].sort((a, b) => a - b);
};

for (const e of PARK_LAYOUT.entries.values()) {
  if (e.id === 'fountain') continue;
  const [x, z] = [e.entranceX, e.entranceZ];
  const outX = x - e.x;
  const outZ = z - e.z;
  const len = Math.hypot(outX, outZ);
  if (len <= 1e-6) continue;
  const dx = outX / len;
  const dz = outZ / len;
  const lead: [number, number] = [x + dx * 3.5, z + dz * 3.5];
  const cur = Math.min(offLine(lead[0], plazaX), offLine(lead[1], plazaZ));
  const cand = [...snaps(x, dx, plazaX), ...snaps(z, dz, plazaZ)].sort((a, b) => a - b);
  const near = cand.filter((t) => t >= 2.0 && t <= 5.5);
  console.log(
    `${e.id.padEnd(26)} door(${x.toFixed(1)},${z.toFixed(1)}) ray(${dx.toFixed(2)},${dz.toFixed(2)}) ` +
      `lead@3.5 offLine=${cur.toFixed(2)} | snap t in [2.0,5.5]: ${near.length ? near.join(',') : 'NONE'} ` +
      `| all t in (0.5,14): ${cand.join(',') || 'none'}`,
  );
}
