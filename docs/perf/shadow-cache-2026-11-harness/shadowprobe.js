// Injected before any page script, on any build, with NO ?perf=1 (whose overlay
// queries the GPU name 4x a second and stalls on the GPU process). Per rAF frame:
// the interval, CPU inside rAF callbacks, GL draw calls (all, and the shadow
// pass's), shadow-pass ms, and GPU ms from EXT_disjoint_timer_query_webgl2
// (relative only: the plan's control showed it under-reads).
// The shadow pass is timed at its outermost `renderer.shadowMap.render`: the
// probe wraps it on the renderer's creation and again whenever the game swaps it
// (the sun shadow cache installs its own), and only the outermost wrapper counts.
(() => {
  const S = { frames: [], renderer: null, cur: null, wraps: 0, gpu: false };
  window.__shadowProbe = S;
  let depth = 0;
  let outermost = null;
  let draws = 0;
  let tris = 0;
  function wrap(shadowMap) {
    const inner = shadowMap.render;
    const wrapper = function (lights, scene, camera) {
      depth++;
      const counting = depth === 1 && S.cur !== null;
      const before = draws;
      const trisBefore = tris;
      const t0 = performance.now();
      try {
        return inner.call(shadowMap, lights, scene, camera);
      } finally {
        depth--;
        if (counting) {
          S.cur.shadowDraws += draws - before;
          S.cur.shadowTris += tris - trisBefore;
          S.cur.shadowMs += performance.now() - t0;
        }
      }
    };
    shadowMap.render = wrapper;
    outermost = wrapper;
    S.wraps++;
  }
  const hook = window.__THREE_DEVTOOLS__ ?? new EventTarget();
  hook.addEventListener('observe', (e) => {
    const r = e.detail;
    if (!r || !r.isWebGLRenderer || S.renderer) return;
    S.renderer = r;
    wrap(r.shadowMap);
  });
  window.__THREE_DEVTOOLS__ = hook;
  for (const proto of [WebGL2RenderingContext.prototype]) {
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const o = proto[name];
      if (!o) continue;
      const instanced = name.endsWith('Instanced');
      const elements = name.startsWith('drawElements') || name === 'drawRangeElements';
      proto[name] = function (mode, a, b, c, d, e) {
        draws++;
        if (mode === 4) {
          const count = name === 'drawRangeElements' ? c : elements ? a : b;
          const n = instanced ? (elements ? d : c) : 1;
          tris += (count / 3) * (n || 0);
        }
        return o.call(this, mode, a, b, c, d, e);
      };
    }
  }
  const raf = window.requestAnimationFrame.bind(window);
  let ts = -1;
  let prevTs = -1;
  let query = null;
  let pending = [];
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (t !== ts) {
      ts = t;
      const r = S.renderer;
      if (r && r.shadowMap.render !== outermost) wrap(r.shadowMap);
      // GPU timer: close last frame's query, harvest finished ones, open this frame's.
      const gl = r?.getContext();
      const ext = gl && window.__probeGpu === true ? (S.ext ??= gl.getExtension('EXT_disjoint_timer_query_webgl2')) : null;
      if (gl && ext) {
        S.gpu = true;
        if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push([query, S.cur]); query = null; }
        pending = pending.filter(([q, frame]) => {
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) frame.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(q);
          return false;
        });
      }
      S.cur = { t, iv: prevTs < 0 ? 0 : t - prevTs, cpu: 0, draws: 0, tris: 0, shadowDraws: 0, shadowTris: 0, shadowMs: 0, gpuMs: null };
      prevTs = t;
      draws = 0;
      tris = 0;
      if (S.frames.length < 200000) S.frames.push(S.cur);
      if (gl && ext) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
    }
    const t0 = performance.now();
    try {
      return cb(t);
    } finally {
      S.cur.cpu += performance.now() - t0;
      S.cur.draws = draws;
      S.cur.tris = tris;
    }
  });
})();
