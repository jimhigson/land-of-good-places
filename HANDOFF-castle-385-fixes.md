# HANDOFF — PR #385 review fixes

Taking over `feat/castle-interior-376` after its author's session was lost.
PR is **approved**; these are small fixes only. Worktree:
`.claude/worktrees/castle-interior-376` (the original author's — clean and at
the pushed head when found, so reused rather than making a second one).

## Done and pushed

Commit "castle #376: the check asks castleFabric for the beam width instead of
copying it" — all three review fixes.

1. **`BEAM_WIDTH` exported** from `castleFabric.ts`. `check-castle.mts`'s
   `PLATE_BAND` and `castleDecor.ts`'s `PORTCULLIS_INSET` both imported it
   instead of hand-copying `0.4`. The near-wall ceiling failure message prints
   `PLATE_BAND` rather than a literal "0.40 m".
2. **`nearWall` vs `reachFromWall`** — *not* an inconsistency, and now says so.
   `Shell.ts` extrudes each wall run from `halfX - HALF_WALL` to
   `halfX + HALF_WALL`, so `INTERIOR_HALF_X` is the wall **centreline** and
   `WALL_FACE_X` is its room-side surface. `reachFromWall` (how far a prop
   sticks into the room) correctly uses the surface. `nearWall` (is a prop
   under the timber) correctly uses the centreline, because
   `castleFabric.ts:249` places the plate at `INTERIOR_HALF_X - PLATE_INSET`.
   Renamed to `PLATE_ROOM_EDGE_X/Z`, comment explains. **No value changed.**
3. **Negative `reachFromWall` now fails loudly** rather than being clamped —
   a box entirely past a wall face scored < 0 and passed the `<= 0.45`
   wall-furniture exemption. Zero instances hit it today.

## Findings worth keeping

- **`PLATE_BAND` was the only hand-copy of a live source constant in
  `check-castle.mts`.** The others are all legitimate: `WALL_FURNITURE_REACH`
  (0.45) and `FLOOR_TREATMENT_MAX_HEIGHT` (0.1) come from
  `HANDOFF-castle-interior-363.md` §5 and have no code owner to import;
  `FOOTPRINT_SAMPLES` and the 0.1 m soot-drift tolerance are the check's own
  thresholds; `EXTERIOR_MASONRY_PATTERN` is a documented, deliberate copy of an
  inline literal in a test-only module.
- **`PORTCULLIS_INSET`'s old comment was wrong twice over**: it claimed 0.1 m
  of margin past a 0.4 m band while the value was 0.7 (real margin ~0.255 m to
  the bar's near face), and claimed the plate's width could not be imported.
  Value unchanged at `BEAM_WIDTH + 0.3`; comment corrected.
- **The wall-plate is not actually flush with the wall**, despite
  `castleFabric.ts`'s comment saying so. Its centre is `BEAM_WIDTH / 2` in from
  the *centreline*, so 0.225 m of it is buried in the masonry and only 0.175 m
  stands proud. Harmless — and assertion 4 measures its edge distance off
  `INTERIOR_HALF_Z`, which over-states the sightline shadow, so it errs safe.
  Not touched: it is geometry, and this PR is approved for fixes only.

## Art notes — both attempted and pushed

4. **The flame.** Root cause is arithmetic, not taste: `emissiveIntensity`
   multiplies and clips. `slideChuteDeep` (0xf0a52f) at 1.75 saturates to
   `(1.00, 1.00, 0.32)` — a flat lemon yellow — inside a core clipped to pure
   white. Two washed-out yellows on top of each other, so the flame had no
   colour gradient at all. The cone still *paints* amber and now *emits*
   `ART.castleFlameDeep` (0xd4413e), which at the same 1.75 lands on
   `(1.00, 0.45, 0.43)`: hot orange-red sheath, cream core. No geometry, no
   intensity, no draw call and no per-frame work changed.
   **Height was left alone deliberately** — a wall flame is 0.268 m because
   `SCONCE_HEADROOM` caps it, and that is a number published to the 3D Artist
   as the box a sconce must be built inside. Growing the fire means
   renegotiating that contract; not a review fix.
5. **The roof garden.** Trough spacing 3.6 → 3.2 m (troughs are 2.6 m long, so
   the gap drops from 1.0 m of bare paving to 0.6 m) and plants per trough
   4 → 7, staggered ±0.13 m either side of the long axis instead of in one
   line, with the run shortened `LENGTH - 0.5` → `LENGTH - 0.9` so the
   outermost plant stays in its box *and* inside the 1.4 m clearance
   `consider` tests at the trough centre. Free: every one is another instance
   of a mesh that already exists, so the roof garden is still three draw calls
   with nothing in the shadow pass. `check:castle` goes 989 → 1301 instances,
   all still clearing every keep-out including the top deck's slide-entry disc.

**Neither has been looked at.** This agent was not given the browser. Both
need a visual pass, and the flame wants one in daylight *and* at night. The
committed renders in `art/renders/castle/` predate both changes — in
particular `376-deck4-roof-garden.png` and `376-torches-close.png` are now
stale and should be re-shot by whoever does the visual QA.

## Binding proof for fix 1

`BEAM_WIDTH` 0.4 → 1.6 in `castleFabric.ts` gave `check:castle` exit **1**,
29 failures, including the sightline assertion moving with it:
`sightline: the wall-plate stands 1.600 m off the wall, so at 38° it hides the
wall above 1.830 m.` Reverted; back to exit 0 with the reviewed baseline
numbers (416 beam segments, 989 instances, 537 wall-exempt).

## Red proofs for the two assertions that changed

**Negative-reach guard (new).** Parked a crate at `x: INTERIOR_HALF_X + 3`
after `cornerClutter`'s own rejection guard. 4 failures, exit 1:

```
✗ props: deck 0 'castle-crates-0[0]' has a reach from the wall of -2.797 m — it
  lies entirely past a wall face, inside or beyond the masonry. A negative reach
  is not wall furniture; it would be silently exempted from the keep-out check
  below because that test is '<= 0.45'. Place it in the room.
```

**`nearWall` / `PLATE_ROOM_EDGE` (rewritten, same value).** Same slot, a 3.2 m
crate — taller than `BEAM_UNDERSIDE` (3.08) but shorter than
`CASTLE_CEILING_CLEAR` (3.30), so only the near-wall branch can catch it. At
`x: 29` (against the wall), 8 failures, exit 1:

```
✗ props: deck 0 'castle-crates-0[0]' reaches 3.200 m, above the 3.08 m ceiling
  within 0.40 m of a wall.
```

The identical crate at `x: 0`, out in the room, passes — which is the branch
being the discriminator rather than the height alone.

## Gates (all unpiped, exit codes read)

| gate | exit |
| --- | --- |
| `npx tsc --noEmit` | 0 |
| `npm run build` (full chain, unpiped) | 0 |
| `npm run test:procgen` (separate; not in the build chain) | 0, 14 files / 453 tests |
| `npm run check:castle` | 0, 1301 instances across 5 storeys |
| `npm run check:park` | 0 |

`git diff --stat origin/main...HEAD` accounted for: 14 files, no deletions.

## Not done

Visual QA of the two art changes. **Do not merge** — the Overseer merges.
Two branches are stacked on this one.
