# HANDOFF — issue #480, "a weird segment of a torus near the park edge"

Branch `fix/torus-480`, worktree `.claude/worktrees/torus-480-b`.

**Model: Opus** (`claude-opus-5[1m]`), chosen by the Overseer as the
replacement for this task's first agent, which was also Opus — per CLAUDE.md's
"a replacement runs the same model as the agent it replaces". If you are
picking this up next, you are Opus too.

**Worktree note:** the original `.claude/worktrees/torus-480` still holds the
branch checked out and belongs to the dead agent; this session works in
`torus-480-b`, detached at the branch tip, pushing with
`git push origin HEAD:fix/torus-480`. Do not check the branch out in two
worktrees at once.

## Found it — measured, not guessed

`park-gate-arch`, the crossbar of the park's entrance gate, built in
`src/world/entrance/Entrance.ts` (~line 311). It is a half `TorusGeometry`
(radius `ENTRANCE_GATE_HALF_WIDTH` = 4.3, tube 0.28, arc π), and it carries two
rotations that are both wrong:

- `rotation.z = Math.PI` — inverts the semicircle, so the arch hangs **down**
  from the post tops instead of springing up over the gateway.
- `rotation.y = Math.PI / 2` — turns it 90° out of the gate plane, so it lies
  **along** the path instead of spanning it.

Measured on the built park (`scripts/measure-torus-480.mts`, canonical seed),
world bbox:

```
park-gate-arch  TorusGeometry  centre 0.00,0.95,60.00
                size 0.53 x 4.58 x 9.16
                min -0.27,-1.34,55.42   max 0.27,3.24,64.58
```

0.53 m thin across X (one tube diameter), 9.16 m long in Z (2 × (4.3 + 0.28)),
top at y 3.24 (the post tops) and bottom at y −1.34, i.e. **1.34 m below
ground**. So what a player sees is two curved prongs coming out of the paving
either side of the gate, 4.3 m up and down the path, with no collider — a
segment of a torus by the park edge. Gate centre is (0, 60); the boundary is
there.

The instrument walked 5510 meshes and found 178 torus/tube/lathe, 66 of them
≥ 1.5 m — that is the control: it saw everything else too (the rail-race
finish rainbow, the ferris rim, the dodgem rails), and this is the only one
out of place.

`src/world/entrance/BusJourney.ts` (~1498) builds the same arch for the
park-seen-from-the-road at the end of the bus ride, and has **its own copy** of
the geometry and the `rotation.z = Math.PI` inversion (its yaw is right, only
because that gate happens to lie along X). Two definitions of one thing.

## The fix

One owner — `src/world/entrance/gateArch.ts` — that both call: post positions,
cap, crossbar and its orientation all derived from one `yaw`, so the crossbar
can never again point somewhere the posts do not.

Collider: the arch's only ground-level parts are its two feet, which land
exactly on the posts, and the posts already carry `collision.addCircle(r 0.55)`
in `Entrance.ts` (post radius 0.5, arch tube 0.28 — covered). Everything else
is ≥ 3.45 m up, over the gateway a child must walk through, so a collider
under the span would block the way in. Proved with an instrument + control.

Jim has commissioned an authored Blender arch (ferris logo, painted title), so
nothing here touches the arch's *appearance* — only orientation, ownership and
solidity.

## Status

- [x] Found and measured (see above)
- [x] One owner `src/world/entrance/gateArch.ts`; `Entrance.ts` and
      `BusJourney.ts` both call it. Posts derived from the same `yaw`.
- [x] Collider: `arch.footRadius` (0.55, derived) on each foot, in `Entrance`.
      Nothing under the span — that is the way in.
- [x] Invariant `the park gate arch stands over its gateway, and the gateway
      stays open`, both mutations proved red (rotations restored; colliders
      removed). `test:procgen` green on all 5 seeds, exit 0.
- [x] Browser before/after, posted to #480 (comment 5524511359) with the
      `/view?camPos=0,4.5,74&camDir=0,-0.08,-1&timeOfDay=12:00` framing.
- [x] `pnpm run build` exit 0; `pnpm run test:procgen` exit 0 (17 files, 520
      tests); `pnpm run check` exit 0 (re-run on the final tree in flight at
      hand-off — confirm before merge)
- [x] PR #482 raised. **Not merged.**
- [x] #481 filed: the boundary spline crosses the fixed gate on pool seed 288
      and sweep seed 18. The invariant's walkability clause is withheld for it
      and announces the gap on stderr every run.

## Trap for whoever probes near the boundary

**The gate line is blocked from wall to wall.** The park boundary keeps a child
*inside* the park, so a `PLAYER_RADIUS` body standing on z = 60 overlaps the
outside and comes back not-standable — 33 of 33 probes across the gate,
measured with `scripts/measure-gate-480.mts`. My first draft of the invariant
probed exactly there for open ground and was green for a reason that had
nothing to do with the arch. Probe 1.5 m inside for "open", 1.0 m in front of a
post for "solid" (that is inside `GATE_POST_REACH` = 1.17 m, so it is
guaranteed by geometry, not by the seed).

## Second session: rebased onto #485/#493, and three corrections

The first agent died with the PR approved. This session did four things.

**Rebased onto `main`.** One conflict, `test/procgen/parkFacts.ts`: `main`'s
`boundaryBlockWidth` and this branch's `parkGateArch` on the same interface
line. Both kept; verified present in the type *and* the returned object.
Three-dot diff is 9 files, additions only. `rerere` was disabled for the
rebase (`git -c rerere.enabled=false`) so no stale resolution could be
replayed.

*Trap, if you rebase this branch again:* every commit subject starts with
`#480`, and any rebase step that opens an **editor** applies git's `strip`
cleanup, which deletes `#`-leading lines — the subject vanishes and the commit
is named after its `Co-Authored-By` trailer. Reword with
`-c commit.cleanup=verbatim`. It happened here and was caught by reading the
log; it would not have shown in any diff.

**What the rebase changed about the measurements.** #485 moved the boundary
masonry out of the gate opening, so the invariant's masked-post count improved
on its own: **5 of 10 post-probes live with two blank seeds → 9 of 10 with
none blank.** The withheld walkability clause is no longer withheld — #485
landed it next door as `theWalkInFromTheGateIsWalkable`, over
`gatewayWalk.ts`'s full-width flood fill. The stderr note now names that owner
instead of claiming the cover is missing.

**#485 also introduced a name collision:** its own `GATE_PROBE_INSET` in
`gatewayWalk.ts` (a number: where the walk-in flood starts) against this
branch's (an object: where the post probes stand), same directory, and after
the rebase a redeclaration error in `invariants.ts`. Renamed mine to
`GATE_POST_PROBE_INSET`. New export `GATE_POST_REACH` is now the single owner
of `PLAYER_RADIUS + GATE_POST_COLLIDER_RADIUS`.

**`.clear` is derived, and this is the bit that matters for the authored
arch.** It was the literal `1.5`, safely outside the 1.17 m reach by 0.33 m —
but with `GATE_ARCH_PIER_KEEP_OUT = 0.80` the reach becomes **1.42 m and a
literal 1.5 leaves 0.08 m**, where the masking detector goes near-degenerate
and drops live posts silently. It is now `GATE_POST_REACH + 0.3`, so it moves
with the collider. **Nothing more is needed here when the asset lands** — that
was the whole point of doing it now.

**`probe-gate-pool.mts` clause 2 no longer has its own opinion.** It used to
sample a 3.66 m band at one depth of a 7.5 m clear width, hence one failing
park where a full-width sweep finds four. It calls `measureGatewayWalk` now.

**Verified on this tree:** `test:procgen` exit 0 (18 files, 541 tests);
`build` exit 0; `check` exit 0, 58 steps, set-compared against `main` by
parsing `package.json` (none dropped, none added). Mutation re-proved red —
foot colliders removed at `Entrance.ts:331` gives 10 failed / 531 passed, and
notably **#485's own walk-in check fails too, on its CONTROL clause**, because
it depends on these post colliders. Do not remove them thinking only this
invariant cares.

## New scope arrived mid-task, NOT started

1. **Place the authored arch.** Jim approved the Blender asset: *"perfect. Add
   the arch please to the game."* It is on branch `art/gate-arch-asset` with
   `HANDOFF-gate-arch-asset.md`. `createGateArch()`, origin at the middle of
   the gateway on the ground, forward +Z; collider two circles r
   `GATE_ARCH_PIER_KEEP_OUT` 0.80 at x = ±`ENTRANCE_GATE_HALF_WIDTH`; keep the
   node names `park-gate-arch` **and** `park-gate-post-0/1` — both are now
   load-bearing (`check:park-map` reads the first, the invariant reads all
   three). It replaces the meshes `gateArch.ts` builds; the seam is
   `buildGateArch`, and the contract it already offers is `yaw` (local +X onto
   the gateway axis), `feet` (±4.3 along that axis), `footRadius` (0.55,
   exported as `GATE_POST_COLLIDER_RADIUS`) and `clearHeightY` (3.45 m of
   headroom). Owes a `keepOutsFor` reachability check with a control, and
   `check:coplanar`. Note the asset's 0.80 keep-out is wider than the 0.55
   here, so re-run `scripts/probe-gate-pool.mts` after: it is the one thing
   that could narrow the opening.
2. **The arrival camera sequence.** Jim: doors → follow her in under the arch →
   rise to the normal pseudo-isometric camera. Not begun. Read the Overseer's
   brief in the session log; the constraints that matter are: no snap at the
   handover, deep links must not wait on it, skippable, `dt`-driven, and the
   normal camera pose read from its existing owner rather than copied.
