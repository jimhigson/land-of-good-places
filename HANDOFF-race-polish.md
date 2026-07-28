# HANDOFF — race-polish (PR #101, branch `race-coaster`)

Worktree: `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/6a345fce-78f2-4acc-baa9-954a8dc31bfa/scratchpad/rail`
(NOT the shared checkout.)

## Landed, in order

| commit | what |
| --- | --- |
| `6f65c47` | `['stall:skyCruiser', 'Ride']` in `DEFAULT_VERBS` — the chip said "Play!" |
| `73cc74f` | Swept-curve rails on both coasters |
| `57fcb98` | The race: `race: true`, countdown, 2 laps, result, rival child, dressed barriers, HUD; camera facing fix; phone hold pad |
| `a6dfa58` | Coaster casts shadows (rails, pylons, cart bodies) |
| `419f984` | What's-new ids 15/16, race booth copy |

**Rebase onto `origin/main` (PR #100, the SELECTION RULE) had ZERO conflicts.**
The two branches touched disjoint hunks of `Game.ts`, `stalls.ts` and
`ParkTrain.ts`. Nothing was hand-merged. Force-pushed with `--force-with-lease`.

`npm run build` exit 0 at every commit.

## Findings a replacement should not have to rediscover

### 1. The race was never switched on
`World.ts` never passed `race: true`, so `Coaster.buildRace()` never ran. No
barriers, no rival, no hold-to-accelerate — the Rail Race was a Sky Cruiser
seen from behind. This is why the "race polish" brief looked like polish and
was actually the feature.

### 2. Every ride camera in the game looks backwards
Measured, not guessed, with `.claude/scratch/probe-facing.mts`:

```
skyCruiser  dot(cameraForward, travel) = -1.000   (now +1.000)
railRace    dot(cameraForward, travel) = -1.000   (now +1.000)
parkTrain   dot(cameraForward, body+Z) = -1.000   (UNCHANGED — see below)
```

Cause: everything modelled in this park faces **+Z** (ASSET_MANIFEST), and both
`Coaster.placeCart` and `ParkTrain.placeCars` set
`rotation.y = atan2(tangent.x, tangent.z)`, which points the body's +Z along
travel. A three.js `PerspectiveCamera` looks down its own local **−Z**. So an
unrotated eye in that seat faces the way you have just come.

Fixed on the coasters with a dedicated `eyeMount` (a child of `cartMount`
turned π). Deliberately NOT in `core/RideCamera.ts` — parity-gated by
`npm run check:ride-camera` — and NOT on `cartMount`, which is the *seat* the
rider's pose hangs off and should keep meaning what every other mount means.

**`ParkTrain` has the identical bug and I did not touch it** (out of this PR's
scope; the brief named it as the reference). Why nobody noticed: the train's
`yawLimit` is `null` — free 360° look — and it is slow, so "backwards" reads as
"facing down the carriage". The coaster clamps to ±120°, where it is glaring.
**Recommend a follow-up PR** applying the same `eyeMount` to `ParkTrain`.

### 3. The race was unplayable on a phone
`Game.screenIsBusy()` includes `player.riding`, so `TouchControls` (the only
thing bound to `jump` a finger can reach) is hidden the moment she boards.
Holding is the entire game. Fixed by making the race HUD its own hold pad —
the mini-game framework's "the whole screen is the button", for the same
reason. `Coaster.raceHold` is read *alongside* the keyboard, never instead.

### 4. The boot warnings in the PR body are already gone
The PR lists "two sub-floor samples at 46/48 m (2.8 / 4.7 m)". They were fixed
by this branch's own later commits (the repair loop's arc-length
`ownsStationTrack`), before I arrived. Measured now:

```
railRace   d=46 → 8.64 m above ground (was 2.8)
worst clearance outside the station window: skyCruiser 6.20 m, railRace 6.43 m
assert floor is 5.00 m
```

`buildHeadlessPark()` emits **zero** warnings. No code change was needed;
`route.ts`'s repair loop was not touched. Remove that line from the PR body.

### 5. Minor
`check:park` prints `RATCHET LOOSE: anchor.reach:building: recorded 0.1, now
0` — non-fatal, an invitation to tighten. Left alone: it is main's ratchet, not
this branch's.

## How the two UI systems compose (do not "simplify" this)

- Chips fire a **virtual `interact` press** (`interact.ts` `pressAction`).
- That reaches `MiniGameHost.checkStalls`, which does its own proximity check
  and calls `boardRide(stallId)`.
- `Game` wires `boardRide`: `railRacer` → `raceCoaster.requestBoard()`,
  `skyCruiser` → `coaster.requestBoard()`.
- Chip flow owns the *UX*; `boardRide` owns the *routing*. Both are needed.
- `StallDefinition.create` is optional for booths with no mini-game behind them.

## Race design, as built

- 2 laps (~45 s). Distance is **accumulated** (`travelled`), not lap-spotted by
  watching a position wrap — the lap is a division, the finish a comparison,
  who is winning a subtraction. No guard band anywhere.
- Rival rubber-bands ±3.2 m/s around 9.5 m/s at 0.12 per metre of lead, in
  **both** directions, so a child who never holds is waited for rather than
  lapped.
- The rival child waves on any change in the sign of the lead (dead band 0.6 m),
  so being overtaken is answered with a wave too.
- Losing says "So close! Again? You nearly had them!" — no scoreboard, ever.
- Winning: confetti + Cute-o-dex deed `secret.railRace`.

## Left to do

- Browser QA (I own the chrome-devtools MCP for this task).
- `npm run sweep:seeds` — running.
- PR #101 body update + "Verdict: ready for review" comment.

## Scratch

`.claude/scratch/*.mts` are throwaway probes (`.claude/` is gitignored).
`probe-facing.mts` is the one worth keeping if anyone revisits the train.
