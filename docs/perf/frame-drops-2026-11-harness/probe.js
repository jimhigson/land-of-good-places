// Injected before any page script. Records one entry per presented frame,
// GL work per frame, and captures the three.js renderer/scenes via the
// official __THREE_DEVTOOLS__ hook (works on a production build).
(() => {
  const P = {
    frames: [], slowGl: [], renderers: [], scenes: [],
    inject: { busyMs: 0, garbageMBps: 0, busyEvery: 0 },
    cur: null,
  };
  window.__perf = P;
  const hook = new EventTarget();
  hook.addEventListener('observe', (e) => {
    const d = e.detail;
    if (d && d.isWebGLRenderer) P.renderers.push(d);
    else if (d && d.isScene) P.scenes.push(d);
  });
  window.__THREE_DEVTOOLS__ = hook;

  const protos = [];
  if (typeof WebGL2RenderingContext !== 'undefined') protos.push(WebGL2RenderingContext.prototype);
  if (typeof WebGLRenderingContext !== 'undefined') protos.push(WebGLRenderingContext.prototype);

  const SUSPECTS = [
    'getProgramInfoLog', 'getShaderInfoLog', 'getProgramParameter', 'getShaderParameter',
    'getActiveUniform', 'getActiveAttrib', 'getUniformLocation', 'getAttribLocation',
    'getUniformBlockIndex', 'readPixels', 'finish', 'getError', 'clientWaitSync', 'getBufferSubData',
    'linkProgram', 'compileShader', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texStorage2D',
    'generateMipmap', 'bufferData', 'compressedTexImage2D',
  ];
  const fresh = () => ({ draws: 0, tris: 0, links: 0, texUp: 0, texBytes: 0, bufBytes: 0, bufCalls: 0, glBlockMs: 0, fbBinds: 0 });
  let acc = fresh();
  for (const proto of protos) {
    for (const name of SUSPECTS) {
      const original = proto[name];
      if (!original || original.__wrapped) continue;
      const w = function (...args) {
        const t0 = performance.now();
        const r = original.apply(this, args);
        const ms = performance.now() - t0;
        acc.glBlockMs += ms;
        if (name === 'linkProgram') acc.links++;
        if (name === 'texImage2D' || name === 'texSubImage2D' || name === 'texImage3D' || name === 'compressedTexImage2D') {
          acc.texUp++;
          const src = args[args.length - 1];
          if (src && src.width) acc.texBytes += src.width * src.height * 4;
          else if (args.length >= 9 && typeof args[3] === 'number') acc.texBytes += args[3] * args[4] * 4;
        }
        if (name === 'bufferData') { acc.bufCalls++; const d = args[1]; if (d && d.byteLength) acc.bufBytes += d.byteLength; }
        if (ms > 2 && P.slowGl.length < 5000) P.slowGl.push({ t: t0, name, ms });
        return r;
      };
      w.__wrapped = true;
      proto[name] = w;
    }
    const bsd = proto.bufferSubData;
    if (bsd && !bsd.__wrapped) {
      const w = function (...args) { acc.bufCalls++; const d = args[2]; if (d && d.byteLength) acc.bufBytes += (args[4] ? args[4] * (d.BYTES_PER_ELEMENT || 1) : d.byteLength); return bsd.apply(this, args); };
      w.__wrapped = true; proto.bufferSubData = w;
    }
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = proto[name];
      if (!o || o.__wrapped) continue;
      const inst = name.endsWith('Instanced');
      const w = function (mode, a, b, c, d) {
        acc.draws++;
        const count = name.startsWith('drawElements') ? a : b;
        const n = inst ? (name === 'drawElementsInstanced' ? d : c) : 1;
        if (mode === 4) acc.tris += (count / 3) * (n || 1);
        return o.call(this, mode, a, b, c, d);
      };
      w.__wrapped = true; proto[name] = w;
    }
    const bf = proto.bindFramebuffer;
    if (bf && !bf.__wrapped) { const w = function (...a) { acc.fbBinds++; return bf.apply(this, a); }; w.__wrapped = true; proto.bindFramebuffer = w; }
  }

  const rafOriginal = window.requestAnimationFrame.bind(window);
  let currentTs = -1, previousTs = -1, open = null;
  let garbageKeep = null;
  const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
  window.requestAnimationFrame = function (callback) {
    return rafOriginal(function (ts) {
      if (ts !== currentTs) {
        if (open) Object.assign(open, acc);
        acc = fresh();
        currentTs = ts;
        open = { ts, iv: previousTs < 0 ? 0 : ts - previousTs, cpu: 0, heap: mem() };
        previousTs = ts;
        if (P.frames.length < 400000) P.frames.push(open);
        if (P.inject.hidePointLights) for (const sc of P.scenes) sc.traverse((o) => { if (o.isPointLight) o.visible = false; });
        if (P.inject.pixelRatio && P.renderers[0] && P.renderers[0].getPixelRatio() !== P.inject.pixelRatio) { const r = P.renderers[0]; r.setPixelRatio(P.inject.pixelRatio); r.setSize(r.domElement.clientWidth, r.domElement.clientHeight, false); }
        // --- controls: deliberately injected costs, to prove the instrument ---
        const inj = P.inject;
        if (inj.busyMs > 0 && (inj.busyEvery <= 1 || P.frames.length % inj.busyEvery === 0)) {
          const t = performance.now(); while (performance.now() - t < inj.busyMs) { /* spin */ }
          open.injected = inj.busyMs;
        }
        if (inj.garbageMBps > 0) {
          const bytes = (inj.garbageMBps * 1048576 * Math.max(open.iv, 1)) / 1000;
          const n = Math.floor(bytes / 64);
          const arr = new Array(Math.min(n, 1e6));
          for (let i = 0; i < arr.length; i++) arr[i] = { a: i, b: i, c: i, d: i, e: i }; // ~56-64 B each
          garbageKeep = arr; // dropped next frame
        }
      }
      const t0 = performance.now();
      let q = null, glq = null, ext = null;
      if (P.inject.gpuTimer && P.renderers[0]) {
        glq = P.renderers[0].getContext(); ext = P.tqExt || (P.tqExt = glq.getExtension('EXT_disjoint_timer_query_webgl2'));
        P.pendingQ = P.pendingQ || [];
        for (let i = P.pendingQ.length - 1; i >= 0; i--) {
          const [qq, fr] = P.pendingQ[i];
          if (glq.getQueryParameter(qq, glq.QUERY_RESULT_AVAILABLE)) {
            if (!glq.getParameter(ext.GPU_DISJOINT_EXT)) fr.gpuMs = glq.getQueryParameter(qq, glq.QUERY_RESULT) / 1e6;
            glq.deleteQuery(qq); P.pendingQ.splice(i, 1);
          }
        }
        if (ext && !P.queryOpen) { q = glq.createQuery(); glq.beginQuery(ext.TIME_ELAPSED_EXT, q); P.queryOpen = true; }
      }
      try { return callback(ts); } finally {
        if (q) { glq.endQuery(ext.TIME_ELAPSED_EXT); P.queryOpen = false; P.pendingQ.push([q, open]); }
        if (open) open.cpu += performance.now() - t0;
        if (P.inject.gpuFinish && open && P.renderers[0]) { const g0 = performance.now(); P.renderers[0].getContext().finish(); open.gpuFinish = (open.gpuFinish || 0) + performance.now() - g0; }
      }
    });
  };
  P.snapshot = () => {
    const r = P.renderers[0];
    const out = { renderers: P.renderers.length, scenes: P.scenes.length };
    if (r) {
      out.info = { memory: { ...r.info.memory }, programs: r.info.programs ? r.info.programs.length : null, render: { ...r.info.render } };
      out.pixelRatio = r.getPixelRatio();
      const gl = r.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      out.canvas = [gl.drawingBufferWidth, gl.drawingBufferHeight]; out.timerQuery = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
      out.shadow = { enabled: r.shadowMap.enabled, type: r.shadowMap.type, autoUpdate: r.shadowMap.autoUpdate };
    }
    // scene graph facts on the biggest scene
    let best = null, bestN = -1;
    for (const s of P.scenes) { let n = 0; s.traverse(() => n++); if (n > bestN) { bestN = n; best = s; } }
    if (best) {
      const f = { objects: 0, meshes: 0, visibleMeshes: 0, instanced: 0, instances: 0, skinned: 0, transparent: 0, castShadow: 0, noCull: 0, sprites: 0, points: 0, lines: 0, lights: 0, shadowLights: [], tris: 0, materials: new Set(), geoms: new Set(), autoUpdate: 0, matrixAutoUpdateObjs: 0 };
      const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      best.traverse((o) => {
        f.objects++;
        if (o.matrixAutoUpdate) f.matrixAutoUpdateObjs++;
        if (o.isLight) { f.lights++; if (o.castShadow && o.shadow) f.shadowLights.push({ type: o.type, map: [o.shadow.mapSize.x, o.shadow.mapSize.y], autoUpdate: o.shadow.autoUpdate, radius: o.shadow.radius, blur: o.shadow.blurSamples }); }
        if (o.isSprite) f.sprites++;
        if (o.isPoints) f.points++;
        if (o.isLine) f.lines++;
        if (o.isMesh) {
          f.meshes++;
          const vis = visible(o);
          if (vis) f.visibleMeshes++;
          if (o.isInstancedMesh) { f.instanced++; f.instances += o.count; }
          if (o.isSkinnedMesh) f.skinned++;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { f.materials.add(m); if (vis && m.transparent) f.transparent++; }
          if (vis && o.castShadow) f.castShadow++;
          if (!o.frustumCulled) f.noCull++;
          f.geoms.add(o.geometry);
          if (vis && o.geometry) { const g = o.geometry; const c = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0); f.tris += (c / 3) * (o.isInstancedMesh ? o.count : 1); }
        }
      });
      const mt = {}; for (const m of f.materials) mt[m.type] = (mt[m.type] || 0) + 1; f.matTypes = mt;
      const lt = {}; best.traverse((o) => { if (o.isLight && visible(o)) lt[o.type] = (lt[o.type] || 0) + 1; }); f.visibleLights = lt;
      f.materials = f.materials.size; f.geoms = f.geoms.size;
      out.scene = f;
    }
    return out;
  };
})();
