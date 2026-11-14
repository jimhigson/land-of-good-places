// Over a whole 150 s day at 120 fps: share of sunlit frames that redraw the static
// cache for sun steps alone, for a few (height, tolerance) step criteria.
const DAY = Number(process.argv[2] ?? 150), FPS = 120; // DAY_LENGTH_SECONDS
const sun = (t) => { const th = (t - 0.25) * 2 * Math.PI; const v = [Math.cos(th), Math.sin(th), -0.42 * Math.sin(th) - 0.28]; const l = Math.hypot(...v); return v.map((x) => x / l); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SUNUP = (s) => 1.35 * smooth(-0.12, 0.12, s[1]) > 0.02; // DayNight: active when sunStrength > 0.02 (intensity ~1.35-1.75)
function make(H, TOL) {
  return (p, s) => {
    if (p[1] < 0.02 || s[1] < 0.02) return p[0] !== s[0] || p[1] !== s[1] || p[2] !== s[2];
    const tx = s[0] / s[1] - p[0] / p[1], tz = s[2] / s[1] - p[2] / p[1];
    const reach = TOL / H; return tx * tx + tz * tz > reach * reach;
  };
}
for (const [label, H, TOL] of [['current 5 m / 3 cm', 5, 0.03], ['15 m / 2.5 cm (1 texel)', 15, 0.0254], ['15 m / 5 cm (2 texels)', 15, 0.0508], ['10 m / 2.5 cm', 10, 0.0254]]) {
  const need = make(H, TOL);
  let placed = null, lit = 0, steps = 0, every = 0;
  const N = DAY * FPS;
  for (let i = 0; i < N; i++) {
    const t = i / N; const s = sun(t);
    if (!SUNUP(s)) { placed = null; continue; }
    lit++;
    if (placed === null || need(placed, s)) { steps++; placed = s; }
  }
  console.log(`${label.padEnd(26)} sunlit ${(100 * lit / N).toFixed(0)}% of the day; static redraws on ${(100 * steps / lit).toFixed(1)}% of sunlit frames (${(steps / (lit / FPS)).toFixed(1)}/s average)`);
}
