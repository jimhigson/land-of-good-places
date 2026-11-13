import fs from 'node:fs';
for (const l of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(`${process.env.PERF_OUT ?? (await import('node:os')).tmpdir() + '/lgp-perf'}/${l}.report.json`, 'utf8'));
  console.log(`\n### ${l} ${r.url} boot=${r.bootS}s dur=${r.durS}s frames=${r.frames} fps=${r.fps} vsync=${r.vsyncMs}`);
  console.log(' iv', JSON.stringify(r.iv), '>16.7:', r.over16, `(${r.over16pct}%)`, '>33:', r.over33, `(${r.over33pct}%)`, 'worst', r.worst.slice(0, 6).join(','));
  console.log(' cpuInRaf', JSON.stringify(r.cpuInRaf), 'perFrame', JSON.stringify(r.perFrame), 'links', r.links, 'texUp', r.texUploads, r.texMB + 'MB');
  console.log(' heap', JSON.stringify(r.heap), 'trace', JSON.stringify(r.trace));
  console.log(' causes16', JSON.stringify(r.causes16), 'causes33', JSON.stringify(r.causes33));
  const s = r.snap.scene || {}; console.log(' scene', JSON.stringify({ objects: s.objects, meshes: s.meshes, vis: s.visibleMeshes, inst: s.instanced, tris: s.tris, mats: s.materials, transp: s.transparent, castShadow: s.castShadow, lights: s.lights, shadowLights: (s.shadowLights||[]).length }), 'programs', r.snap.info?.programs, 'canvas', r.snap.canvas, 'tq', r.snap.timerQuery);
  for (const d of (r.longFrames || []).slice(0, Number(process.env.N || 5))) console.log('  LF', JSON.stringify(d));
}
