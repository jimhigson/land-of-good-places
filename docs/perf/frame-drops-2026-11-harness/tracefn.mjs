// node tracefn.mjs label regex : inclusive ms/s of functions matching regex, from in-trace CPU samples (main thread)
import fs from 'node:fs';
const [label, re] = process.argv.slice(2); const R = new RegExp(re);
const OUT = process.env.PERF_OUT ?? (await import('node:os')).tmpdir() + '/lgp-perf';
const ev = JSON.parse(fs.readFileSync(`${OUT}/${label}.trace.json`, 'utf8')).traceEvents;
const al = ev.find((e) => e.name === '__perf_align'); const pid = al.pid;
const starts = {}; for (const e of ev) if (e.name === 'Profile' && e.pid === pid) starts[e.id] = e.args.data.startTime;
const nodes = new Map(), parent = new Map(), samples = []; const cur = { ...starts };
for (const e of ev) { if (e.name !== 'ProfileChunk' || !(e.id in starts)) continue; const d = e.args.data, cp = d.cpuProfile || {};
  for (const n of cp.nodes || []) { nodes.set(e.id + ':' + n.id, n.callFrame); if (n.parent !== undefined) parent.set(e.id + ':' + n.id, e.id + ':' + n.parent); }
  const ss = cp.samples || [], td = d.timeDeltas || []; for (let i = 0; i < ss.length; i++) { cur[e.id] += td[i] || 0; samples.push([cur[e.id], e.id + ':' + ss[i]]); } }
samples.sort((a, b) => a[0] - b[0]);
const from = al.ts, to = samples[samples.length - 1][0]; const dur = (to - from) / 1e6;
const incl = {}; let tot = 0;
for (let i = 0; i < samples.length - 1; i++) { const [t, id] = samples[i]; if (t < from) continue; const dt = samples[i + 1][0] - t; tot += dt; const seen = new Set();
  for (let x = id, k = 0; x !== undefined && k < 80; x = parent.get(x), k++) { const cf = nodes.get(x); if (!cf) continue; const key = `${cf.functionName}:${cf.lineNumber + 1}`; if (R.test(cf.functionName) && !seen.has(key)) { seen.add(key); incl[key] = (incl[key] || 0) + dt; } } }
console.log('window s', dur.toFixed(1));
for (const [k, v] of Object.entries(incl).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log((v / 1000 / dur).toFixed(1).padStart(7), 'ms/s', k);
