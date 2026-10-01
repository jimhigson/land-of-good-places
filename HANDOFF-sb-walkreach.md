# HANDOFF sb-walkreach (model: Claude Opus 5.5)

Task: check:walk-reach VOID on seed 5 (bridge @(47.0,-12.6), facade steps @(-40.1,48.5)); all seeds 0..15 must exit 0.

Findings:
- Bridge: hump is narrow and 18.5 m long along the path (144 deg); the march used 16 fixed compass bearings
  (nearest 135/157.5) and 16 m runs, so every run met the hump side-on as a 2-4 m cliff. Fix: march along the
  crossing's own pathDir too, starting past the hump's covered reach (instrument fix).
- Facade steps on seed 5: ramp foot ~1.5 m above the terrain in front (castle on a slope falling to the front).
  Investigating whether that is a real park defect.
