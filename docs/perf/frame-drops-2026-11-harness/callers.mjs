// node callers.mjs label fnName [depth]  -> inclusive ms/s of fn by caller chain (first ancestor not named fn)
import fs from 'node:fs';
const [label, fn, depthS] = process.argv.slice(2); const depth = Number(depthS || 2);
const p = JSON.parse(fs.readFileSync(`${process.env.PERF_OUT ?? (await import('node:os')).tmpdir() + '/lgp-perf'}/${label}.cpuprofile`, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n])); const parent = new Map();
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
let t = p.startTime; const ts = []; for (let i = 0; i < p.samples.length; i++) { t += p.timeDeltas[i]; ts.push(t); }
const dur = (ts[ts.length - 1] - ts[0]) / 1e6;
const k = (n) => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`;
const agg = {};
for (let i = 0; i < p.samples.length - 1; i++) {
  const dt = ts[i + 1] - ts[i];
  // find outermost occurrence of fn in stack
  let id = p.samples[i], hit = null;
  while (id !== undefined) { if (byId.get(id).callFrame.functionName === fn) hit = id; id = parent.get(id); }
  if (hit === null) continue;
  const chain = []; let x = parent.get(hit);
  while (x !== undefined && chain.length < depth) { chain.push(k(byId.get(x))); x = parent.get(x); }
  const key = chain.join(' < ');
  agg[key] = (agg[key] || 0) + dt;
}
for (const [kk, v] of Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log((v / 1000 / dur).toFixed(1).padStart(7), kk);
