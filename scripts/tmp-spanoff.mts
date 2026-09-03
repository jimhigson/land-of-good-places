/** TEMP diagnostic: which offset, if any, lets a span shape clear between two
 * lattice nodes two pitches apart. Control: offset 0 (the straight run that is
 * known blocked) must report blocked. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugLegScreens } from '../src/world/paths.ts';
quietly(() => buildHeadlessPark());
const [ax, az, bx, bz] = process.argv.slice(2, 6).map(Number) as [number, number, number, number];
for (const off of [0, 6, -6, 4, -4, 3, -3, 2, -2, 1.5, -1.5]) {
  const shape: [number, number][] = [
    [ax, az],
    [ax, az + off],
    [bx, bz + off],
    [bx, bz],
  ];
  const verdicts = [];
  let ok = true;
  for (let i = 1; i < shape.length; i += 1) {
    const v = debugLegScreens(shape[i - 1]![0], shape[i - 1]![1], shape[i]![0], shape[i]![1]) as Record<string, unknown>;
    const bad = Object.entries(v).filter(([k, val]) => ['streetClear', 'ring', 'railSide', 'ramp'].includes(k) && val === false).map(([k]) => k);
    if (bad.length) ok = false;
    verdicts.push(bad.length ? `leg${i}:${bad.join(',')}` : `leg${i}:ok`);
  }
  console.log(`offset ${String(off).padStart(5)}  ${ok ? 'CLEAR' : 'blocked'}  ${verdicts.join(' ')}`);
}
