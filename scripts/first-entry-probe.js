// Injected before the page's own scripts by `scripts/check-first-entry.mts`
// (`gpu:first-entry`). One record per animation frame, taken in a
// requestAnimationFrame wrapper so it brackets the game's own frame:
//
//   { t, interval, hole, curtainShut, blocking, links, draws, space }
//
// - `hole`: the iris eye's width in CSS px at the START of the frame — what
//   showed through the gap that ends at the next frame. -1 before the iris
//   exists. 0 is shut.
// - `curtainShut`: a curtain game's curtain covers the screen (from `?perf=1`'s
//   context; null on a build that does not say).
// - `blocking`: links this frame **waited for** on the main thread. With
//   `KHR_parallel_shader_compile`, a program's first use (three asks
//   `ACTIVE_UNIFORMS` to build its uniforms) blocks only when its link has not
//   finished: asked first, without blocking, through `COMPLETION_STATUS_KHR`.
//   Without the extension every `linkProgram` is a synchronous link and counts.
// - `links`: every `linkProgram` — a compile *started*, waited for or not.
//
// GL work between two frames (a setTimeout midpoint) is counted into the
// earlier frame, whose gap it lengthens.
(() => {
  const P = { frames: [], marks: [], parallel: null };
  window.__firstEntry = P;
  const COMPLETION_STATUS_KHR = 0x91b1;
  const ACTIVE_UNIFORMS = 0x8b86;
  let acc = { blocking: 0, links: 0, draws: 0 };
  const protos = [];
  if (typeof WebGL2RenderingContext !== 'undefined') protos.push(WebGL2RenderingContext.prototype);
  if (typeof WebGLRenderingContext !== 'undefined') protos.push(WebGLRenderingContext.prototype);
  for (const proto of protos) {
    const link = proto.linkProgram;
    const getParam = proto.getProgramParameter;
    const getExtension = proto.getExtension;
    if (!link || link.__firstEntry) continue;
    proto.linkProgram = function (program) {
      acc.links += 1;
      if (P.parallel === null) P.parallel = getExtension.call(this, 'KHR_parallel_shader_compile') !== null;
      if (!P.parallel) acc.blocking += 1;
      return link.call(this, program);
    };
    proto.linkProgram.__firstEntry = true;
    proto.getProgramParameter = function (program, pname) {
      if (pname === ACTIVE_UNIFORMS && P.parallel) {
        if (getParam.call(this, program, COMPLETION_STATUS_KHR) === false) acc.blocking += 1;
      }
      return getParam.call(this, program, pname);
    };
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const draw = proto[name];
      if (!draw) continue;
      proto[name] = function (...args) {
        acc.draws += 1;
        return draw.apply(this, args);
      };
    }
  }
  let eye = null;
  const holePx = () => {
    if (!eye || !eye.isConnected) eye = document.querySelector('.iris-eye');
    return eye ? parseFloat(getComputedStyle(eye).width) || 0 : -1;
  };
  const raf = window.requestAnimationFrame.bind(window);
  let currentTs = -1;
  let open = null;
  let previous = -1;
  window.requestAnimationFrame = function (callback) {
    return raf(function (ts) {
      if (ts !== currentTs) {
        currentTs = ts;
        const now = performance.now();
        if (open) Object.assign(open, acc);
        acc = { blocking: 0, links: 0, draws: 0 };
        open = { t: now, interval: previous < 0 ? 0 : now - previous, hole: holePx(), curtainShut: null, blocking: 0, links: 0, draws: 0, space: null };
        previous = now;
        if (P.frames.length < 100000) P.frames.push(open);
      }
      try {
        return callback(ts);
      } finally {
        if (open && open.space === null && window.__perf) {
          try {
            const c = window.__perf.context();
            open.space = c.space ?? null;
            if (typeof c.curtainShut === 'boolean') open.curtainShut = c.curtainShut;
          } catch {
            // not yet
          }
        }
      }
    });
  };
  const observe = () => {
    const iris = document.querySelector('.iris');
    if (!iris) {
      setTimeout(observe, 50);
      return;
    }
    new MutationObserver((records) => {
      const now = performance.now();
      for (const r of records) P.marks.push([now, iris.getAttribute(r.attributeName)]);
    }).observe(iris, { attributes: true, attributeFilter: ['data-closed'] });
  };
  observe();
})();
