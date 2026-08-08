// Injected before any page script by `check-frame-time.mts`.
//
// Records one entry per PRESENTED frame (the interval between them is what a
// person actually sees), plus every synchronous WebGL call that blocked the
// main thread for more than 2 ms. Those two together are what distinguish "the
// GPU is busy" from "the main thread is waiting on the GPU process", which want
// completely different fixes.
(() => {
  const S = { frames: [], slowGl: [] };
  window.__frameProbe = S;

  const proto =
    (typeof WebGL2RenderingContext !== 'undefined' && WebGL2RenderingContext.prototype) ||
    (typeof WebGLRenderingContext !== 'undefined' && WebGLRenderingContext.prototype);

  // Every GL entry point that can force a round-trip to the GPU process and
  // wait for the answer. `getProgramInfoLog` is the one that cost 152 ms.
  const SUSPECTS = [
    'getProgramInfoLog', 'getShaderInfoLog', 'getProgramParameter', 'getShaderParameter',
    'getActiveUniform', 'getActiveAttrib', 'getUniformLocation', 'getAttribLocation',
    'getActiveUniforms', 'getUniformBlockIndex', 'getActiveUniformBlockParameter',
    'readPixels', 'finish', 'getError', 'clientWaitSync', 'getBufferSubData',
  ];
  if (proto) {
    for (const name of SUSPECTS) {
      const original = proto[name];
      if (!original) continue;
      proto[name] = function (...args) {
        const started = performance.now();
        const result = original.apply(this, args);
        const ms = performance.now() - started;
        if (ms > 2 && S.slowGl.length < 5000) S.slowGl.push({ t: started, name, ms });
        return result;
      };
    }
  }

  const rafOriginal = window.requestAnimationFrame.bind(window);
  let currentTs = -1;
  let previousTs = -1;
  let openFrame = null;

  window.requestAnimationFrame = function (callback) {
    return rafOriginal(function (ts) {
      if (ts !== currentTs) {
        currentTs = ts;
        openFrame = { ts, iv: previousTs < 0 ? 0 : ts - previousTs, cpu: 0 };
        previousTs = ts;
        S.frames.push(openFrame);
      }
      const started = performance.now();
      try {
        return callback(ts);
      } finally {
        if (openFrame) openFrame.cpu += performance.now() - started;
      }
    });
  };
})();
