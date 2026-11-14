// Before/after table from thread-time.mjs output: per scene and build, the
// minimum and the median of every sample — the minimum because the noise on a
// shared machine only ever adds time, the median to show how much it added.
//
//   node docs/perf/undrawn-indoors/thread-table.mjs <jsonl>...
import fs from 'node:fs';
const ORDER = ['park', 'hotel', 'castle1', 'library', 'reptile', 'castle0', 'castle2'];
const rows = process.argv.slice(2).flatMap((file) =>
  fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((r) => !r.error && r.control === 0),
);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f = (v) => (v === undefined ? '  -  ' : v.toFixed(2).padStart(5));
console.log('scene    space          n   raf thread ms/frame                cpu p50, min   tris          load (1 min)');
console.log('                             before (min/med)  after (min/med)   before after   before→after');
for (const scene of ORDER) {
  const of = (build) => rows.filter((r) => r.name === scene && r.label === build);
  const b = of('before'); const a = of('after');
  if (b.length === 0 && a.length === 0) continue;
  const stat = (xs, k) => [Math.min(...xs.map((r) => r[k])), median(xs.map((r) => r[k]))];
  const [bm, bd] = stat(b, 'rafThreadMs'); const [am, ad] = stat(a, 'rafThreadMs');
  const [bc] = stat(b, 'cpuP50'); const [ac] = stat(a, 'cpuP50');
  const tris = `${median(b.map((r) => r.tris))}→${median(a.map((r) => r.tris))}`;
  const loads = [...b, ...a].map((r) => r.load[0]);
  console.log(
    `${scene.padEnd(8)} ${(b[0] ?? a[0]).space.padEnd(13)} ${String(Math.min(b.length, a.length)).padStart(2)}   ` +
      `${f(bm)} /${f(bd)}    ${f(am)} /${f(ad)}     ${f(bc)}  ${f(ac)}    ${tris.padEnd(16)} ${Math.min(...loads).toFixed(0)}-${Math.max(...loads).toFixed(0)}`,
  );
}
