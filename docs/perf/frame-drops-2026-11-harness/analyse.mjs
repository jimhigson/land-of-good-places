// usage: node analyse.mjs label [--json]
import fs from 'node:fs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.PERF_OUT ?? path.join((await import('node:os')).tmpdir(), 'lgp-perf');
const label = process.argv[2];
const { meta, frames: allFrames, slowGl } = JSON.parse(fs.readFileSync(path.join(OUT, `${label}.frames.json`), 'utf8'));
const pct = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q / 100 * s.length))]; };
const r1 = (x) => Math.round(x * 10) / 10;
const frames = allFrames.filter((f) => f.ts > meta.measureFrom && f.ts <= meta.measureTo && f.iv > 0);
const ivs = frames.map((f) => f.iv);
const durS = (meta.measureTo - meta.measureFrom) / 1000;
const vsync = Math.min(pct(ivs, 50), 16.67);
const over16 = frames.filter((f) => f.iv > 16.7), over33 = frames.filter((f) => f.iv > 33.4);
// heap: positive deltas between consecutive frames = allocation lower bound; drops = GCs
let alloc = 0, drops = [];
for (let i = 1; i < frames.length; i++) { const d = frames[i].heap - frames[i - 1].heap; if (d > 0) alloc += d; else if (d < -256 * 1024) drops.push(-d); }
const heaps = frames.map((f) => f.heap);
const sum = (a, k) => a.reduce((s, f) => s + (f[k] || 0), 0);
const report = {
  label, url: meta.urlPath, opts: meta.o, bootS: meta.bootS, durS: r1(durS), frames: frames.length,
  fps: r1(frames.length / durS), vsyncMs: r1(vsync),
  iv: { p50: r1(pct(ivs, 50)), p90: r1(pct(ivs, 90)), p99: r1(pct(ivs, 99)), p999: r1(pct(ivs, 99.9)), max: r1(Math.max(...ivs)) },
  over16: over16.length, over16pct: r1(100 * over16.length / frames.length), over33: over33.length, over33pct: r1(100 * over33.length / frames.length),
  worst: [...ivs].sort((a, b) => b - a).slice(0, 10).map(r1),
  cpuInRaf: { p50: r1(pct(frames.map((f) => f.cpu), 50)), p90: r1(pct(frames.map((f) => f.cpu), 90)), p99: r1(pct(frames.map((f) => f.cpu), 99)), max: r1(Math.max(...frames.map((f) => f.cpu))) },
  perFrame: { draws: pct(frames.map((f) => f.draws || 0), 50), drawsMax: Math.max(...frames.map((f) => f.draws || 0)), trisM: r1(pct(frames.map((f) => f.tris || 0), 50) / 1e6), fbBinds: pct(frames.map((f) => f.fbBinds || 0), 50), bufKBperFrame: r1(pct(frames.map((f) => f.bufBytes || 0), 50) / 1024), glBlockMsP50: r1(pct(frames.map((f) => f.glBlockMs || 0), 50)) },
  links: sum(frames, 'links'), texUploads: sum(frames, 'texUp'), texMB: r1(sum(frames, 'texBytes') / 1048576),
  heap: { minMB: r1(Math.min(...heaps) / 1048576), maxMB: r1(Math.max(...heaps) / 1048576), allocMBps_lowerBound: r1(alloc / 1048576 / durS), gcDrops: drops.length, gcDropMBp50: r1(pct(drops, 50) / 1048576) },
  slowGlInWindow: slowGl.filter((g) => g.t > meta.measureFrom && g.t < meta.measureTo).length,
  snap: meta.snap,
};

// ---------------- trace attribution ----------------
const tracePath = path.join(OUT, `${label}.trace.json`);
if (fs.existsSync(tracePath)) {
  const ev = JSON.parse(fs.readFileSync(tracePath, 'utf8')).traceEvents;
  const names = {}; const threads = {};
  for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') threads[`${e.pid}:${e.tid}`] = e.args.name;
  const alignEv = ev.find((e) => e.name === '__perf_align');
  // renderer main = thread of the align mark
  const mainKey = alignEv ? `${alignEv.pid}:${alignEv.tid}` : Object.keys(threads).find((k) => threads[k] === 'CrRendererMain');
  const gpuKeys = Object.keys(threads).filter((k) => threads[k] === 'CrGpuMain' || threads[k] === 'VizCompositorThread');
  const offUs = alignEv ? alignEv.ts - meta.align * 1000 : null;
  // complete-ify B/E
  const spans = { main: [], gpu: [] };
  const stacks = {};
  for (const e of ev) {
    const k = `${e.pid}:${e.tid}`;
    const bucket = k === mainKey ? 'main' : gpuKeys.includes(k) ? 'gpu' : null;
    if (!bucket) continue;
    if (e.ph === 'X') spans[bucket].push({ name: e.name, ts: e.ts, dur: e.dur || 0, args: e.args });
    else if (e.ph === 'B') (stacks[k] ??= []).push(e);
    else if (e.ph === 'E') { const b = (stacks[k] ??= []).pop(); if (b) spans[bucket].push({ name: b.name, ts: b.ts, dur: e.ts - b.ts, args: b.args }); }
  }
  for (const s of spans.main) names[s.name] = (names[s.name] || 0) + 1;
  const clip = (s, a, b) => Math.max(0, Math.min(s.ts + s.dur, b) - Math.max(s.ts, a));
  const GC = new Set(['MinorGC', 'MajorGC']);
  const LAYOUT = new Set(['UpdateLayoutTree', 'Layout', 'Paint', 'PrePaint', 'Layerize', 'RecalculateStyles', 'UpdateLayer', 'HitTest']);
  const SCRIPTLOAD = new Set(['EvaluateScript', 'v8.compile', 'v8.compileModule', 'v8.evaluateModule', 'CompileScript', 'ParseHTML', 'v8.parseOnBackground']);
  const tops = spans.main.filter((s) => s.name === 'RunTask' || s.name === 'ThreadControllerImpl::RunTask');
  const byStart = (arr) => arr.sort((a, b) => a.ts - b.ts);
  byStart(spans.main); byStart(spans.gpu);
  const inWin = (arr, a, b) => arr.filter((s) => s.ts < b && s.ts + s.dur > a);
  // all-window totals
  const fromUs = meta.measureFrom * 1000 + offUs, toUs = meta.measureTo * 1000 + offUs;
  const total = {}; for (const s of inWin(spans.main, fromUs, toUs)) if (GC.has(s.name) || s.name === 'FireAnimationFrame') total[s.name] = (total[s.name] || 0) + clip(s, fromUs, toUs);
  report.trace = {
    aligned: !!alignEv, mainThread: threads[mainKey],
    gcMsPerSec: r1(((total.MinorGC || 0) + (total.MajorGC || 0)) / 1000 / durS),
    minorGC: inWin(spans.main, fromUs, toUs).filter((s) => s.name === 'MinorGC').length,
    majorGC: inWin(spans.main, fromUs, toUs).filter((s) => s.name === 'MajorGC').length,
    gcMaxMs: r1(Math.max(0, ...inWin(spans.main, fromUs, toUs).filter((s) => GC.has(s.name)).map((s) => s.dur / 1000))),
    rafMsPerSec: r1((total.FireAnimationFrame || 0) / 1000 / durS),
  };
  const cats = {};
  const detail = [];
  const idx = new Map(allFrames.map((f, i) => [f, i]));
  const union = (arr, a, b) => { const iv = arr.map((s) => [Math.max(s.ts, a), Math.min(s.ts + s.dur, b)]).filter(([x, y]) => y > x).sort((p, q) => p[0] - q[0]); let t = 0, e = -Infinity; for (const [x, y] of iv) { if (y <= e) continue; t += y - Math.max(x, e); e = y; } return t; };
  for (const f of over16) {
    const prevF = allFrames[idx.get(f) - 1] || {};
    const a = (f.ts - f.iv) * 1000 + offUs, b = f.ts * 1000 + offUs;
    const w = inWin(spans.main, a, b);
    let gc = 0, raf = 0, layout = 0, load = 0, busy = 0, gpu = 0;
    for (const s of w) {
      const c = clip(s, a, b) / 1000;
      if (GC.has(s.name)) gc += c;
      else if (s.name === 'FireAnimationFrame') raf += c;
      else if (LAYOUT.has(s.name)) layout += c;
      else if (SCRIPTLOAD.has(s.name)) load += c;
    }
    busy = union(inWin(tops, a, b), a, b) / 1000;
    for (const s of inWin(spans.gpu, a, b)) if (s.name === 'GPUTask' || s.name === 'ThreadControllerImpl::RunTask' || s.name === 'RunTask') gpu += clip(s, a, b) / 1000;
    const gl = slowGl.filter((g) => g.t >= f.ts - f.iv && g.t < f.ts).reduce((s, g) => s + g.ms, 0);
    const excess = f.iv - vsync;
    let cause;
    if (prevF.injected) cause = 'INJECTED';
    else if (gl > 0.4 * excess) cause = 'GL sync (shader/upload)';
    else if (gc > 0.4 * excess) cause = 'GC';
    else if (load > 0.4 * excess) cause = 'script load/compile';
    else if (layout > 0.4 * excess) cause = 'DOM layout/paint';
    else if (raf - gc > 0.5 * excess) cause = 'JS in frame (tick+render)';
    else if (busy - raf > 0.5 * excess) cause = 'other main-thread task';
    else if (gpu > 0.5 * f.iv) cause = 'GPU process busy';
    else cause = 'main idle (GPU/compositor/vsync)';
    cats[cause] = (cats[cause] || 0) + 1;
    detail.push({ ts: r1(f.ts), iv: r1(f.iv), cpu: r1(prevF.cpu ?? NaN), raf: r1(raf), gc: r1(gc), layout: r1(layout), load: r1(load), other: r1(busy - raf - layout - load), gpu: r1(gpu), gl: r1(gl), links: prevF.links, texUp: prevF.texUp, cause });
  }
  report.causes16 = cats;
  // ---- in-trace CPU samples (ProfileChunk), per long frame ----
  const prof = { nodes: new Map(), parent: new Map(), samples: [] };
  const mainPid = alignEv ? alignEv.pid : null;
  const starts = {};
  for (const e of ev) if (e.name === 'Profile' && e.pid === mainPid) starts[e.id] = e.args.data.startTime;
  const mainProfileIds = new Set(Object.keys(starts));
  const tcur = { ...starts };
  for (const e of ev) {
    if (e.name !== 'ProfileChunk' || !mainProfileIds.has(e.id)) continue;
    const d = e.args.data; const cp = d.cpuProfile || {};
    for (const n of cp.nodes || []) { prof.nodes.set(`${e.id}:${n.id}`, n.callFrame); if (n.parent !== undefined) prof.parent.set(`${e.id}:${n.id}`, `${e.id}:${n.parent}`); }
    const ss = cp.samples || []; const td = d.timeDeltas || [];
    for (let i = 0; i < ss.length; i++) { tcur[e.id] += td[i] || 0; prof.samples.push([tcur[e.id], `${e.id}:${ss[i]}`]); }
  }
  prof.samples.sort((x, y) => x[0] - y[0]);
  report.traceCpuSamples = prof.samples.length;
  if (prof.samples.length) {
    const fk = (cf) => cf ? `${cf.functionName || '(anon)'}:${(cf.url || '').split('/').pop().replace(/-[A-Za-z0-9_-]{8}\.js/, '')}:${cf.lineNumber + 1}` : '?';
    const interesting = (cf) => cf && cf.functionName && !/^\(/.test(cf.functionName);
    for (const d of detail) {
      const f = over16.find((x) => r1(x.ts) === d.ts); if (!f) continue;
      const a = (f.ts - f.iv) * 1000 + offUs, b = f.ts * 1000 + offUs;
      const selfC = {}, inclC = {}; let n = 0;
      for (const [t, id] of prof.samples) {
        if (t < a) continue; if (t >= b) break; n++;
        const cf = prof.nodes.get(id); selfC[fk(cf)] = (selfC[fk(cf)] || 0) + 1;
        const seen = new Set(); let x = id; let depth = 0;
        while (x !== undefined && depth < 60) { const c = prof.nodes.get(x); const k = fk(c); if (interesting(c) && !seen.has(k)) { seen.add(k); inclC[k] = (inclC[k] || 0) + 1; } x = prof.parent.get(x); depth++; }
      }
      if (n) {
        d.topSelf = Object.entries(selfC).sort((p, q) => q[1] - p[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(100 * v / n)}%`);
        d.topIncl = Object.entries(inclC).filter(([k]) => !/^(tick|step|render|\(anon\)):/.test(k)).sort((p, q) => q[1] - p[1]).slice(0, 16).map(([k, v]) => `${k} ${Math.round(100 * v / n)}%`);
      }
    }
  }
  const c33 = {}; for (const d of detail) if (d.iv > 33.4) c33[d.cause] = (c33[d.cause] || 0) + 1;
  report.causes33 = c33;
  report.longFrames = detail.sort((x, y) => y.iv - x.iv).slice(0, 15);
  report.mainEventNames = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 0);
  report._offUs = offUs;
}

// ---------------- CPU profile ----------------
const cpuPath = path.join(OUT, `${label}.cpuprofile`);
if (fs.existsSync(cpuPath)) {
  const p = JSON.parse(fs.readFileSync(cpuPath, 'utf8'));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map(); for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map(); let t = p.startTime; const sampleT = [];
  for (let i = 0; i < p.samples.length; i++) { t += p.timeDeltas[i]; sampleT.push(t); }
  const dt = (i) => (i + 1 < sampleT.length ? sampleT[i + 1] - sampleT[i] : 0);
  for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) || 0) + dt(i));
  const key = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}`;
  const totalUs = sampleT[sampleT.length - 1] - sampleT[0];
  const selfBy = {}; for (const [id, us] of self) { const k = key(byId.get(id)); selfBy[k] = (selfBy[k] || 0) + us; }
  // inclusive by function key (count once per sample stack)
  const incl = {};
  for (let i = 0; i < p.samples.length; i++) {
    const seen = new Set(); let id = p.samples[i];
    while (id !== undefined) { const k = key(byId.get(id)); if (!seen.has(k)) { seen.add(k); incl[k] = (incl[k] || 0) + dt(i); } id = parent.get(id); }
  }
  const ms = (us) => r1(us / 1000 / durS);
  report.cpu = {
    profileMs: r1(totalUs / 1000), note: 'ms per second of wall time',
    topSelf: Object.entries(selfBy).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k, ms(v)]),
    topInclusive: Object.entries(incl).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, v]) => [k, ms(v)]),
  };
  // children of Game tick: find nodes named 'tick' whose url is Game chunk
  const tickChildren = {};
  const tickIds = p.nodes.filter((n) => n.callFrame.functionName === 'tick' && /Game/.test(n.callFrame.url)).map((n) => n.id);
  const under = (id, anc) => { for (let x = parent.get(id); x !== undefined; x = parent.get(x)) if (x === anc) return true; return false; };
  for (let i = 0; i < p.samples.length; i++) {
    // walk up to find the frame directly below a tick node
    let id = p.samples[i], prev = null;
    while (id !== undefined && !tickIds.includes(id)) { prev = id; id = parent.get(id); }
    if (id === undefined) continue;
    const k = prev === null ? '(tick self)' : key(byId.get(prev));
    tickChildren[k] = (tickChildren[k] || 0) + dt(i);
  }
  report.cpu.tickChildren = Object.entries(tickChildren).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, ms(v)]);
  // grandchildren: children of render / system update etc — generic: for given parent names
  void under;
}

// ---------------- heap sampling ----------------
const heapPath = path.join(OUT, `${label}.heapprofile`);
if (fs.existsSync(heapPath)) {
  const h = JSON.parse(fs.readFileSync(heapPath, 'utf8'));
  const by = {}; let tot = 0;
  const stackBy = {};
  const walk = (n, chain) => {
    const k = `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    const c = [...chain, n.callFrame.functionName || '(anon)'];
    if (n.selfSize) { by[k] = (by[k] || 0) + n.selfSize; tot += n.selfSize; const sk = c.slice(-4).join(' < '.replace('<', '>')); stackBy[`${k} :: ${c.slice(-5, -1).join(' > ')}`] = (stackBy[`${k} :: ${c.slice(-5, -1).join(' > ')}`] || 0) + n.selfSize; void sk; }
    for (const ch of n.children || []) walk(ch, c);
  };
  walk(h.head, []);
  const mbps = (b) => r1(b / 1048576 / durS * 10) / 10;
  report.alloc = {
    totalMBps: mbps(tot), perFrameKB: r1(tot / 1024 / frames.length),
    top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, mbps(v), `${r1(100 * v / tot)}%`]),
    topStacks: Object.entries(stackBy).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => [k, mbps(v)]),
  };
}
fs.writeFileSync(path.join(OUT, `${label}.report.json`), JSON.stringify(report, null, 1));
const { snap, ...brief } = report;
console.log(JSON.stringify(process.argv.includes('--full') ? report : { ...brief, longFrames: (brief.longFrames || []).slice(0, 6), cpu: undefined, alloc: brief.alloc ? { totalMBps: brief.alloc.totalMBps, perFrameKB: brief.alloc.perFrameKB } : undefined }, null, 1));
