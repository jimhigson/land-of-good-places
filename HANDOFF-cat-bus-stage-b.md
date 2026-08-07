# HANDOFF: cat bus Stage B (`e-cat-bus-stage-b`, branch `e/cat-bus-stage-b`)

The journey, the loading screen, the skip, and the three visual faults Stage A
left open. Issue #245, PR #246.

**Read first:** `HANDOFF-cat-bus-stage-a.md` in this same tree — six rounds of
root causes, all measured, none repeated here.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-stage-b`,
branched off `origin/e/cat-bus-stage-a` @ `1f5acd3`. `npm ci` done, exit 0.
**Pushes to `e/cat-bus-stage-a`** (PR #246's head) — the branch of the same name
is checked out in another worktree, which is why this one has its own.

## Baseline, read off the screen before touching anything

- `npm run build` — **exit 0**
- `npm run test:procgen` — **exit 0**, `Test Files 11 passed (11)` /
  `Tests 226 passed (226)`, **0 skipped**

That is the bar. A drop in the *pass* count is the tell for the seed-skip trap
(CLAUDE.md), not the fail count.

## The number that shapes the whole loading-screen design

**The park's `World` constructor takes 277–488 ms** (three runs, Node, this
branch, measured via `buildHeadlessPark().buildMs`). Not seconds.

The 16 s worst-seed figure in the brief is **the slide branch**, which is not in
this tree. On this branch a 20 s ride outruns generation by a factor of forty,
every time. That does not make the amortisation pointless — see below — but it
does mean the "generation outruns the ride" branch is a correctness requirement
rather than the common case, and must be **guarded rather than trusted**.

Module-scope work (`COASTER_PLANS` solved at import, `parkManifest`,
`PARK_BOUNDARY`) is *not* in that figure. It is paid at import time, before any
frame can render, which is why the boot is a blank screen today.

## Findings so far

### The foreground trees are the *treeline*, and it consults nothing

`ENTRANCE_CLEAR_X/Z/RADIUS` is a **10 m disc centred at (0, 56)**. The bus's
kerb is at `z = ENTRANCE_BUS_STOP_Z` = **69**. The disc covers z 46–66. **It has
never covered the bus at all** — it was sized for the old bus that parked
*inside* the park at z 54.6, and stayed put when the stop moved outside.

The trees actually in shot are `Scenery.ts`'s `buildTreeline()` — 540 trees in a
band `edgeRadiusAt + 11.5 .. + TERRAIN_APRON - 1.5`, i.e. from **z 71.5**
outward on the gate bearing. `buildTreeline` does **not** go through
`isPlantable`, so it never asked about the entrance keep-out even after Stage A
wired one up.

Arithmetic that names them, from the game's own camera constants
(`CAMERA_YAW_DEGREES` 45, `CAMERA_PITCH_DEGREES` 38 — the camera is
**orthographic**, so every view ray is parallel):

- view direction `(0.5573, 0.6156, 0.5573)` back towards the camera;
- a point at kerb `z` is crossed by the ray to the bus at height
  `busTop + 1.1046 * (z - 69)`;
- bus top ≈ 5.36 m, so at **z = 71.5 the ray is 8.2 m up** and a tall treeline
  tree reaches **9.3 m** (`height` up to 5.1 + canopy radius 3.1 × 1.35).
  **It blocks.** By z = 74 the ray is 10.9 m up and nothing reaches it.

So the keep-out wanted is not a bigger disc: it is *"nothing may stand in the
camera's own line to the bus, anywhere along the bus's run"* — derived from the
bus's box, its run along the kerb, and the camera's own angles.

## Decisions

(recorded as they are taken; see the PR comment for the full reasoning)

## Status

- [x] Read CLAUDE.md, issue #245 + 3 comments, PR #246 + 2 comments, Stage A handoff
- [x] Own worktree, `npm ci`, baseline build + procgen measured
- [x] Measured park generation cost (277–488 ms)
- [x] Root-caused the foreground trees (treeline, not the plantable scatter)
- [ ] Bus dimensions exported; sightline keep-out + invariant
- [ ] Opening framing
- [ ] Rainbow arch ruling
- [ ] Stage B journey
- [ ] Loading screen (incremental generation)
- [ ] Skip
- [ ] Watched end to end in a browser
