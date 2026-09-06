# Engineering brief — stage 3, step 2a: the swept-bus instrument, as a ratchet

**Status: READY — dispatchable today.** No dependency on step 1, #511 or
the built-park measurement. Authority:
`docs/DESIGN-round-robin-generation.md`, "Stage 3, ruled (5 Sep, Jim)".
One engineer, one worktree, normal CLAUDE.md discipline. Invisible work:
merges after review + QA measurement without Jim; nothing to screenshot.

## What this is

The independent instrument every later stage-3 step is measured by: the
cat bus's swept body along its arrival route against the **drawn**
rail-race trestle geometry — trunk and branches, at height — on every
pool seed, with a control that discriminates. It is written **before**
the fix so it can be watched failing (CLAUDE.md, "a check can pass
without checking anything"), and it lands as a **ratchet with a
baseline** (`check:coplanar`'s precedent) because `main` is red on it
today: #498 measured 2–8 feet per seed in the bus body, and the posts
lean.

- `scripts/check-entrance-road.mts` on PR #498's branch
  (`fix/road-487-488`, head `9768fe62`) is the prior art: it sweeps the
  whole trestle tree with radii from each mesh's own `CylinderGeometry`.
  Its reviewer's blocker — it tested feet, then posts at height showed
  8–9 hits per seed — is your spec. Take the *approach*, not the file:
  #498 is stalled and conflicting; do not cherry-pick.
- **Owners, not copies**: the bus body from `catBus.ts`'s own dimensions;
  the bus route from the entrance's own owner (after step 1 lands,
  `roadCorridor.ts`; before it, `layout.ts`'s line — read whichever `main`
  has); leg geometry read off the built scene by mesh name
  (`railRace:trestle-legs`, `-branches-lower`, `-branches-upper`), never
  re-derived from the placer's rules.
- **Ratchet**: a committed per-seed baseline of intrusion counts; the
  check fails if any seed's count *rises*, prints every seed's count and
  worst penetration (metres, height) to stderr on every run, and prints
  "N seeds still intruding — step 2 owes these" so nobody reads green as
  clear. Step 2's definition of done is driving the baseline to zero and
  deleting it.

## Acceptance — measured

1. Red run, pasted **with geometry** (seed, leg coordinates, penetration,
   height) for the canonical seed and the five #498 was red on
   (5, 11, 24, 131, canonical).
2. Controls, both pasted: a flat bus (body height 0) → 0 hits; feet-only
   sweep vs drawn-post sweep on the same seeds → different counts (the
   post count is the one that binds).
3. `check:entrance-road` (or whatever name — coordinate with the step-1
   engineer so the two do not both claim it) added to the `check` chain;
   verify by parsing `package.json`'s `scripts` and comparing step *sets*
   with `main`'s.
4. Full gates green with the baseline in place: `pnpm run check`,
   `pnpm run test:procgen`, `pnpm run check:coplanar` — exit codes
   captured directly.

## Traps

- Every check script must build the *seeded* park it claims to measure
  (#496's lesson: on Node 26 the scripts built a random park). Name the
  park measured, on pass and on fail.
- Do not build the park twice in one process.
- `rerere` is on: rebuild any chain conflict from `main`'s parsed steps.
