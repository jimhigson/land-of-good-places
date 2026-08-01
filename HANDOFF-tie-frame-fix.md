# Handoff: tie-frame-fix (#112, "the sleeper bug")

Status: **done**, PR ready to open (or already open — check `gh pr list`).

## What this was

Sky Cruiser's ties (sleepers) were oriented with
`rotation.setFromUnitVectors(new Vector3(0, 0, 1), forward)` in
`src/world/coaster/Coaster.ts` (~line 330, pre-fix). That's the *minimal*
rotation from +Z onto the track's tangent: it pins the tie's along-track axis
to `forward` but leaves its long (rail-bridging, 1.5 m) axis free to roll
about an arbitrary axis whenever `forward` has a vertical component — i.e.
almost everywhere on this ride. Confirmed by inspection, not just trusted
from the brief: `BoxGeometry(1.5, 0.08, 0.3)` has its long axis on local X,
which is exactly the axis the minimal rotation doesn't constrain.

The rails are offset from the route's centre line with a strictly
**horizontal** side vector (`src/world/rail/sweptRail.ts`: `sideX =
along.z, sideZ = -along.x`), never rolled — "no track in this park banks."
Proved algebraically that this `side` is always exactly perpendicular to
`along`, for any `along.y`: `dot((along.z, 0, -along.x), along) =
along.x·along.z + 0 − along.x·along.z = 0`. So `along`, `side`, and their
cross product always form a valid orthonormal frame, however steep the
climb.

## The fix

1. `src/world/rail/sweptRail.ts`: factored the inline `sideX/sideZ` math out
   into a private `horizontalSide(along, target)`, used by the existing rail
   sweep. Added an exported `railFrameAt(sampler, distance, out)` returning
   an orthonormal `{ position, forward, side, up }` frame built from that
   same `horizontalSide`.
2. `src/world/coaster/Coaster.ts`'s tie-placement loop now calls
   `railFrameAt`, then `Matrix4.makeBasis(frame.side, frame.up,
   frame.forward)` → `Quaternion.setFromRotationMatrix`, instead of
   `setFromUnitVectors`. This maps the tie's local X (long axis) to
   `frame.side` exactly, local Z to `forward`, local Y to `up` — so ties
   land on the rails by shared construction, not coincidence.
3. Exported `RAIL_GAUGE = 1.1` and `TIE_STEP = 1.4` as named constants from
   `Coaster.ts` (previously inline literals at both the `sweptRails(...)`
   call and the tie loop) so the regression check samples the exact same
   points production code builds from. Named the ties `InstancedMesh`
   (`ties.name = 'ties'`) so the check can find it without guessing group
   order.

## The regression check

`scripts/check-tie-frame.mts` (`npm run check:tie-frame`, wired into `npm
run build` right after `check:rail-race`). Builds the real Sky Cruiser
headlessly via `scripts/park-harness.mts` (the `check-park.mts` /
`measure-hop-clearance.mts` precedent — build the real thing, never model
it), reads the real `ties` InstancedMesh's instance matrices, and for each
tie's rail-gauge point (`±RAIL_GAUGE/2` out along its own local X, in world
space) checks the 3-D distance to the rail centre line computed
independently via `railFrameAt` at that tie's own distance along the route.
Epsilon 50 mm (rail sweep's own Catmull-Rom fit strays up to ~20 mm per
`Coaster.ts`'s own comment; 50 mm leaves headroom above that).

**Proved it catches the bug** (not just asserted): temporarily reverted the
tie rotation to `setFromUnitVectors(new Vector3(0, 0, 1), frame.forward)`,
ran `npm run check:tie-frame`:

```
worst deviation 912.5 mm (at s=70.0 m, right rail), epsilon 50 mm
check:tie-frame: FAIL ... exit 1
```

Restored the fix immediately after; re-ran, confirmed:

```
worst deviation 0.0 mm (at s=102.2 m, right rail), epsilon 50 mm
tie frame: every tie sits on both rails, within epsilon.
exit 0
```

(0.0 mm rather than merely "small" because both the tie's rotation and the
check's expected point are now built from the same `railFrameAt` call — by
design, per the brief: "tie endpoints land on the rails by shared
construction rather than coincidence.")

## Verified

- `npm run build` — exit 0, checked as a real exit code (not piped through
  `tail`/`head`). Includes `tsc --noEmit` and every existing `check:*`
  script plus the new `check:tie-frame`.
- The unfixed-code failure above, by hand.
- Did **not** get live browser time — did not message the Overseer to ask
  for the shared chrome-devtools profile, since the numeric proof above is
  the acceptance criterion the brief called "the one that actually
  matters." Visual QA in-game (a climb/descent on the Sky Cruiser) is still
  worth someone doing opportunistically, but nothing here depends on it.

## Files touched

- `src/world/rail/sweptRail.ts` — `horizontalSide` helper, exported
  `railFrameAt` + `RailFrame` interface.
- `src/world/coaster/Coaster.ts` — tie rotation now via `railFrameAt` +
  `Matrix4.makeBasis`; exported `RAIL_GAUGE`, `TIE_STEP`; named `ties` mesh.
- `scripts/check-tie-frame.mts` — new regression check.
- `package.json` — `check:tie-frame` script, wired into `build`.

## Not touched

Route-solving (`coaster/route.ts`), the rail-generator work happening in
parallel elsewhere, anything about the Rail Race. This was scoped
deliberately narrow per the architect review that split it out of #112.

## Next step if you're picking this up

Open the PR if it isn't already (`gh pr create` from this branch,
`fix/tie-frame`, against `main`). Don't merge it yourself — two peer reviews
plus QA, Overseer merges. If you get told you own the shared chrome-devtools
profile, a look at a climb/descent segment in-game would be a nice-to-have
visual confirmation on top of the numeric proof, not a blocker.
