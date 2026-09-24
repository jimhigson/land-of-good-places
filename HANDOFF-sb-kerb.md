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

## After fix 2 (full run)
- check:coplanar exit 1, one finding: NEW garden|path-kerb|path-surface 0.000 m² (1.24e-4) at 8.1e-3 m, seed 131.
- Seed 131 at (-1.6, -1.71, 42.09), normal (0.004, 0.271, 0.962): a paving SHEET (surface rises -4.13 -> +0.73 m over
  1.37 m of plan at x=-1.6) and its own route's kerb band beside it (kerb verts 882-885, surf 252-254). Edge contact at
  x=-1.6; the 25 mm lift offset on a near-vertical plane with a 0.004 x-tilt projects to a ~24 um sliver. Not a buried
  face; the defect is the sheet itself = fix/paving-drape's root cause (drape lifts other routes' paving inside bridge
  stone). Pre-existing on base (verified by probing the base pathGraph.ts). Left for the caller to decide.
- Revert proof: base pathGraph.ts -> seed 24 0.2217 m² @6.1 mm, canonical 0.1997 @9.9 mm, 131 1.24e-4 @8.1 mm;
  branch -> 24 and canonical none, 131 unchanged.
- park:attempt 24 and 20260728: failures [] before and after (exit 0). tsc exit 0.

## Part 2: took over fix/paving-drape (Overseer-ish ruling via structural-backtrack engineer)
- Merged origin/wip/sb-merge (b5d0b05d) then origin/fix/paving-drape (4d66d808), clean; merged diff == paving-drape's own.
- Before (base b5d0b05d, worktree .claude/worktrees/sb-kerb-base), park:attempt restart 0: 131/24/20260728/2 failures [];
  11 fails "built the park it was asked for" (175 bushes, needs >180). Logs scratch pd-before-*.log.
- After merge: sheet invariant passes on all five. 24, canon clean. NEW lattice fails ("every street sits on the shared
  12 m lattice"): 131 gate-approach x3 (z=46.16, x=27.30, z=-34.95; count 4), 11 spur-building x=42, 2 spur-stall.dodgems
  x=62 + connector-waterFight z=-38/x=-42. 11's bush fail gone. Logs pd-merge-*.log. tsc + typecheck:test exit 0.
- Fixes on top of the merge: (1) gridDetour half rail clamp restored (fixes 131 gate-approach, 11 spur-building);
  (2) paving-drape's raw-diagonal connector refusal dropped (refused seed 2's base lattice connector via
  longestOffAxisRun's inclusive-sampling overcount 11.9->15.35 m; connector screens are fix/sb-lattice's);
  (3) gridDetour straightening: lattice-kept second pass with dog-legs via lattice lines, used only when the
  ordinary one carries an off-lattice street run and it does not (seed 2 spur-stall.dodgems).
- After (pd-after-*.log): 131, 24, 11, 20260728, 2 all accepted, failures [] (11's base bush fail gone).
