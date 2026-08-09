# HANDOFF: cat bus round 5 (`e-cat-bus-round5`, pushes to `e/cat-bus-stage-a`)

Seven faults Jim found riding the finished arrival, plus two corrections that
arrived mid-round. Issue #245, PR #246.

**Read first:** `HANDOFF-cat-bus-stage-a.md` and `HANDOFF-cat-bus-stage-b.md` in
this tree — six earlier rounds of root causes, all measured, none repeated here.

Worktree `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/e-cat-bus-round5`,
off `origin/e/cat-bus-stage-a` @ `a43127f`. `npm ci` done, exit 0.

## Baseline and bar

- start: `build` exit 0, `test:procgen` **11 files / 231 tests / 0 skipped**
- end: `build` exit 0, `test:procgen` **11 files / 236 tests / 0 skipped**
  (+5 = 5 seeds x one new invariant)

## The seven, and what each actually was

| # | Jim | Root cause, measured |
|---|---|---|
| 1 | face floats off the head | patch at `FACE_RADIUS*1.02` on a sphere squashed to 0.6 in z — **1.13 m of clear air**. Baked into the sphere's own UVs. |
| 2 | see inside, switching | *corrected to*: cuts by itself. Shot list, 5 beats. |
| 3 | doesn't tilt on hills | tilted the **wrong way on 1200/1200 frames**; sign error. Now `lookAt` along the road. |
| 4 | road too plain | one flat fill. Now a painted cross-section: slabs, kerbs, dashes. |
| 5 | road doesn't reach the park | **no road existed at the entrance at all**, and the ride showed no park. Both built. |
| 6 | "Land of Good Places" on the front | into the face's own canvas. |
| 7 | bus number 67 | roundel on the same board. |

## Things worth not re-deriving

- **The face sphere is the whole front of the bus.** `CAT_BUS_CABIN_FRONT_Z`
  (new export) is where the clear interior stops; the driver sits *inside* the
  blob, and its back reaches to within 0.01 m of the front row's heads.
- **The cabin's ceiling is not the roof.** `cat-bus-shell-upper` is a solid slab
  from the window heads to the roof, so the clear interior stops 0.47 m below
  the bus's own height. `CAT_BUS_CABIN_CEILING_Y` (new export).
- **This bus is packed nearly solid.** A child is 1.53 m across, seats at
  x = ±1.3, `AISLE_WIDTH` 0.8. The only clear volume anywhere inside is the
  gangway at |x| < 0.53, floor to ceiling. Any interior camera lives there.
- **Kids' painted faces point along their own +Z** (measured). Twelve of them
  all facing the nose is two lines of profiles from the aisle, which is why the
  passengers are turned 0.6 rad **inboard**.
- **The kerb road's boundary clipping does not currently bind** — the
  bus-run clamp (`ENTRANCE_BUS_ARRIVE_X + CAT_BUS_LENGTH/2`) is tighter on all
  five seeds. It is kept because the boundary is a spline that differs per seed
  and the clamp that dominates today may not tomorrow. **Do not "simplify" it
  away**; the invariant is what proves the result, not the clipping.
- `ROAD_TILE_METRES` / `ROAD_HALF_WIDTH` in `world/entrance/road.ts` are the one
  owner of the road's scale, shared by the lane and the park.
- `ENTRANCE_GATE_HALF_WIDTH` / `_POST_HEIGHT` moved to `layout.ts`: the arch is
  built **twice** (park and ride) and the cut lands on it.

## Guards added, each proved red by mutation

| guard | went red with |
|---|---|
| face is one painted surface, baked, solid, ray-first | *"the cat's face floats 1.16 m in front of the bus's own skin"* |
| tilt sign vs `laneHeight` gradient | *"the bus tilts the WRONG way on 1121 of the 1121 frames where the lane is actually sloped"* |
| tilt is non-zero on the steepest climb | *"the bus's nose is only 0.0000 above horizontal — driving up a hill dead level"* |
| road exists / reaches the gate / goes through it | *"there is no road at the park entrance at all — the bus arrives on grass"* |
| road stays between the arch's posts (invariant, 5 seeds) | *"50 road vertices inside the park stand more than 4.3 m off the gate's axis"* |
| the ride cuts, both shots get frames | *"the ride cut between views 0 times over 20s"* |
| lettering painted into the bus's **own** canvas | *"3 of the 3 words the bus paints go onto a canvas that is not the face's"* |
| nothing within 0.3 m of the inside lens | catches every interior bug this round produced |

## Three guards of mine that could not fail, and how each was caught

Worth reading before writing the next one.

1. **"The face stands proud of the frontmost bodywork"** — the face sphere *is*
   the frontmost bodywork, so it was compared with itself and reported 0.000 m
   with the face moved a metre forward. Caught by mutation. Replaced with
   "how much air is behind it along a ray".
2. **"Ten of twelve children are in the frustum"** — true on a build whose
   inside view was a flat brown wall. **A containment test is not a visibility
   test**; that is the third time on this feature the difference has mattered.
   Replaced with a ray.
3. **"Every ray reaches its own child"** — went red on a *good* shot, reporting
   `hair.shell.bowl` as an obstruction. That is a busload of children occluding
   each other, i.e. the picture Jim asked for, described as a defect.

## The process failure of this round — read it

**`git checkout --` to undo a mutation destroyed uncommitted work three times**,
and the third reached a commit: the shot-list director was reverted along with a
mutation, and the commit that followed carried a message describing it and a
file without it. The round-3 handoff records the same thing happening once
before. **Commit before mutating. No exceptions.**

Two things let it get past me, both worth fixing in habit:

- `npm run build > log 2>&1; echo "EXIT=$?"` run in the **background**: the
  harness reports its own exit code (the `echo`'s), not npm's, and I never read
  the recorded line. `check:bus-journey` had failed outright. Always grep the
  log for the recorded exit and for the check's own pass line.
- `tsc --noEmit` passes on a tree missing an export that only a file under
  `scripts/` imports. A green typecheck is not coverage of the check scripts.

Found in the end by **looking**: a browser probe over the running ride reported
`view=outside` at every sample from t=0 to t=17.6.

## Seen, in a browser, all seven

Headless Chromium via Playwright (`playwright` is not in this worktree; it is at
`~/.npm/_npx/e41f203b7505f1fb/node_modules`), SwiftShader, throwaway profile —
**not** the shared chrome-devtools profile. Dev server on **5447**
(`--strictPort`), killed by PID. 5200 / 5210 / 5410 / 5412 / 5437 untouched.

Script: `scratchpad/round5/shoot.mjs`. Shots in `scratchpad/round5/final7/`.

**Do not abort `/@vite/client`.** Vite injects every stylesheet through it, so
blocking it leaves the page unstyled *and* halts the module graph before
`main.ts` runs — the capture then photographs a splash stuck on "building the
garden…", which looks exactly like a boot failure. Cost half an hour.

SwiftShader runs 1-2 fps and `Loop` clamps `dt`, so ride time and wall clock are
an order of magnitude apart: **poll `window.journey.ride.elapsed`, never sleep.**

## Still open

1. **The destination board crowds the cat's face a little.** It occupies the
   upper half of the nose and the eyes sit low under it. It reads as a cat
   wearing a destination board like a headband, which is charming, but if Jim
   wants the face given more room the board's band is one number
   (`paintDestinationBoard`'s `bottom`).
2. **The near two children dominate the inside frame.** Unavoidable from the
   gangway of a bus this full — they are 0.53 m either side of the lens and
   there is nowhere to retreat to. Mitigated with a 33-degree lens and by
   pushing the lens as far forward as `CAT_BUS_CABIN_FRONT_Z` allows.
3. **The park at the end of the lane is off to one side at the settle**, because
   the closing camera is on the park's own bearing (45 degrees) rather than
   behind the bus. The wall reads; the arch is only partly in frame.
4. **The rail-race rainbow arch still crosses the arrival**, per stage B's
   ruling. Unchanged.
5. **`NPC_COUNT` is 24 and still unmeasured on a device.** Unchanged from
   round 4.
