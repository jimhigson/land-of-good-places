// Before/after table from measure.mjs output: every run of a build, per scene.
//   node docs/perf/undrawn-indoors/table.mjs <x1.jsonl> [x4.jsonl]
import fs from 'node:fs';
const ORDER = ['park', 'hotel', 'library', 'reptile', 'castle0', 'castle1', 'castle2'];
for (const file of process.argv.slice(2)) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((r) => !r.error);
  const throttle = rows[0]?.throttle ?? '?';
  console.log(`\nthrottle x${throttle} — cpu p50 / p99 ms (dpr), each run`);
  const build = (label) => label.replace(/-[A-Z]$/, '');
  for (const scene of ORDER) {
    const of = (b) => rows.filter((r) => r.name === scene && build(r.label) === b).map((r) => `${r.cpuP50.toFixed(1)}/${r.cpuP99.toFixed(1)}${r.dpr !== 2 ? ` (dpr ${r.dpr})` : ''}`).join(', ');
    const space = rows.find((r) => r.name === scene)?.space ?? '';
    console.log(`${scene.padEnd(8)} ${space.padEnd(13)} before: ${of('before').padEnd(36)} after: ${of('after')}`);
  }
}
