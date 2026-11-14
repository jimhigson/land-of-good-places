// Who calls a function in a saved .cpuprofile: ms/s by caller chain.
// usage: node callers.mjs <profile> <functionName> [depth]
import fs from 'node:fs';

const [file, fn, depthS] = process.argv.slice(2);
const depth = Number(depthS ?? 4);
const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const total = (profile.endTime - profile.startTime) / 1e6;
const chains = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
  let id = profile.samples[i];
  // find the innermost frame named fn on this stack
  let hit = null;
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    if (byId.get(cur).callFrame.functionName === fn) { hit = cur; break; }
  }
  if (hit === null) continue;
  const names = [];
  for (let cur = parent.get(hit), d = 0; cur !== undefined && d < depth; cur = parent.get(cur), d++) {
    const cf = byId.get(cur).callFrame;
    names.push(`${cf.functionName || '(anon)'}:${cf.lineNumber}:${cf.columnNumber}`);
  }
  const key = names.join(' < ');
  chains.set(key, (chains.get(key) ?? 0) + dt);
}
for (const [k, v] of [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${(v / total).toFixed(1).padStart(7)} ms/s  ${fn} < ${k}`);
