# HANDOFF: sb-kerb (fix/sb-kerb, based on origin/wip/sb-merge)

- Model: Claude Opus 5.5, chosen by the structural-backtrack engineer. A replacement runs the same model.
- Task: clear check:coplanar's one finding `garden|garden/path-kerb|garden/path-surface` (0.222 m², 6.1e-3 m, seed 24)
  at cause per ART_DIRECTION.md §7 (delete the hidden face). No PR; push fix/sb-kerb and report back.
- Scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/sb-kerb/
  (probe.mts: LGP_SEED=24 sweep, dumps kerb|surface pairs and nearby triangles).

## Status
- Before-runs started (coplanar, park:attempt seed 24 + 20260728) -> scratch *-before.log.

## Root cause (measured, seed 24)
- Finding at (-7.78, -1.48, -25.80), on a bridge ramp. Kerb band of route 13 (kerb vertices 3762..3765, original
  kerb triangles 3708/3709/3711) runs under another route's paving (surface verts 774..783).
- Plan cover passes. After `drapePathsOverBridges`, `KerbCover.apply` height test fails: at overlap corners the
  paving is up to 2.8 mm BELOW the kerb (gaps -0.0028..0.0310), because the drape lifts each mesh's vertices onto the
  hump separately so the two are different chords of one curved surface. Tolerance was KERB_FLOAT = 1e-4 -> kerb kept.
- Before drape, same triangles had gaps 0.021..0.024 and were dropped.
- Fix (commit on this branch): KERB_PROUD_MAX = PATH_SURFACE_LIFT - PATH_KERB_LIFT (25 mm) replaces KERB_FLOAT.
- Before: check:coplanar exit 1 (the one NEW finding); park:attempt 24 and 20260728 both failures [] exit 0.

## Second finding, unmasked (canonical 20260728)
- After fix 1, check:coplanar still exit 1 with the same key on canonical: 0.200 m² at 8.1e-3 m (the report shows only the
  worst instance per key; this is the 0.1997 recorded by fix/path-ribbon's handoff for base, so it pre-existed).
- At (-35.56, -7.01, -43.93), steep ramp. Route 23's kerb triangle (verts 4916,4917,4918) is fully covered in plan;
  covers after drape: surf 2219/2221/2220 at 8.7-11 mm (the fighter), 919/921/920 at 37-63 mm and 2216/2217/2218 at
  42-58 mm -> refused (> KERB_BURY_MAX 50 mm) -> kerb kept.
- Fix 2: KERB_HIDE_MAX = 100 mm tier. Candidate also records whether other routes' paving covers its sight shadow
  at 100 mm; if so and the ordinary test says no, re-ask with gaps up to 100 mm against that wider shadow. Monotone.
- Probe after fix 2: no kerb|surface pairs on seed 24 or canonical. Full check:coplanar running -> *-after2.log.
