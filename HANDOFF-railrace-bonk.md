# HANDOFF — railrace-bonk (agent `e-railrace-bonk`)

Work for PR **#223**, pushed to `chore/rail-race-pr-triage`. My working branch is
`e/railrace-bonk` in `.claude/worktrees/railrace-bonk`; `.claude/worktrees/pr-triage`
is another agent's and was never touched.

Jim rode the Rail Race and reported three things. **Duck bars only exist at
level 3** (`BARS_FROM_LEVEL = 3`) — QA at level 1 or 2 will never see one.

## The headline: 2 and 3 were NOT the same root cause. There were three.

### 1. The face pointed 81° away from the lens — FIXED, guarded

`camera.ts`'s rig stands square-on to the chord it frames, which measures
**81.1° off the rider's forward**, identical at every window shape and every
point on the ring. Measured by projecting her real eyes through the real rig:
one eye sat at a facing of **−0.25** (monitor) / **−0.35** (phone) — round the
back of her head, not drawn — and both eyes landed on the same screen x.

She now turns **50°** of the 81°: body 29°, head 21°. Split that way because
`gondola.ts` already ruled on this for a seated figure (*"the whole toy turns,
not its neck"*) and this kid has no neck — the head pivot is inside the torso.
50° not 60° because on a phone she is framed hard left and turning her walks an
eye towards that edge (60° left 0.003 of NDC margin; 50° leaves 0.061). The
sweep table is in `FACE_TURN_MAX`'s doc comment.

Guarded in `check:rail-race`: builds a real kid, poses her with
`faceTurnTowardsCamera` (the ride's own function, moved into `camera.ts` so
there is one copy), and asserts each eye is on the near side of the skull, on
screen, and separated from its twin. **Proved red at `FACE_TURN_MAX = 0`.**

### 2. The bar was inside her head in BOTH states — FIXED, guarded, one residual

Two causes, neither of them item 3's.

**(a) The clearance was set from measurements that are 1.40 m wrong.**
`DUCK_CLEARANCE_AT_PARK_SCALE` was set twice (1.5, then 2.1 on 1 August), both
documented as "halfway between her ducking and standing head heights", both from
a live reading of 4.70 m / 5.95 m over the rail. Re-measured by composing the
real transform chain: crown **6.10 / 7.35**, head top (hair included) **6.42 /
7.67**. Against a bar at 5.25 m the bar sat inside her head *whichever way she
played it* — the underside 1.54 m below the top of a **ducked** head. That is
why raising it to 2.1 never fixed Jim's 1 August report either.

Now **2.82** — the same rule both earlier passes intended, on real numbers,
measured to her head top because hair is what you watch pass through a bar. A
ducked head clears by 0.26 m; a standing one meets it by 0.99 m.

The duck-bar **posts** are authored 4.70 m tall — the very same wrong number,
sized on the same day — so they only ever reached their bar by coincidence.
Their length is now *derived* from the clearance (measured off the asset's
bounding box, stretched on Y alone), or every bar would float 0.75 m above its
own supports.

**(b) There is no collider on a duck bar at all** — a bonk is decided by button
state at the crossing, and nothing ever compared bar height to head height. So
the response is now physical: **the bar knocks her down into the seat**, by
exactly the drop the clearance is sized against, easing back as the wobble
fades. Rivals too — and two things were missing there: a *ducking* rival tucked
its arms but never actually went down, and a bonked one had no pose at all.

Guarded in `check:rail-race`, **proved red both ways**: at clearance 2.1 the
ducked half fires ("clears by −1.54"), at 4.0 the standing half fires ("strikes
by −1.96", i.e. a bar nothing ever hits is decoration and deletes the game).

### 3. The bonk fired 2.5 m past the bar — FIXED, guarded

The bar's geometry was drawn at `spot.at` — its supporting trestle's
collision-nudged position — while `simulate.ts` bonked at the un-nudged
`bar.at`. On the canonical seed **every one of the seven bars carried a −2.00 m
arc nudge**. `track.ts`'s own comment argued an arc nudge "costs nothing"
because bar and leg move together: true of bar-versus-leg, silent about
bar-versus-physics.

Measured, canonical seed, a rider who never ducks:

| | crossing the built bar | bonk lands |
|---|---|---|
| before | 32.40 → 32.47 m/s (no reaction) | 2.52 m past it |
| after | 32.40 → 11.36 m/s | 0.35 m, under one frame's 0.54 m |

**Fixed by drawing the bar at `bar.at`**, the number it is scored at, so the two
are one number by construction. (My *first* fix published the built position and
scheduled from it — that worked, but left two numbers kept in step by a
parameter, and the first invariant proved it: reverting `chooseLevel` left the
suite **green**. A check that passed without checking anything, in the very PR
about one. Hence the structural version.)

Guarded by a new procgen invariant, `duckBarsSlowYouWhereTheyStand`, across all
five seeds. It compares two things from genuinely different places — the bar's
own instance matrix in the built scene, against a rider driven by the real
`stepRider` through the real `scheduleForLevel` — so neither side can satisfy
the other. **Both halves proved red separately**: restoring `spot.at` gives
2.52/2.08/2.36/2.39 m late against 0.44–0.54 m of frame travel; setting
`BONK_SPEED_FACTOR = 1` leaves the position half green and fires the speed half
on all seven bars.

## The one thing left, with numbers

Her head is enormous (3.74 m tall at ride scale), so it reaches the bar before
her *centre* does. Frame by frame through a bonk at 32.5 m/s, the bar is inside
the top of her skull for **4 frames (67 ms)** — from 1.65 m before the bar to
the bonk frame — and clears cleanly from then on.

The principled fix is to bonk at **first contact** rather than at the bar's
centre: subtract a `BAR_CONTACT_LEAD` of ~1.9 m (head half-depth at the bar's
height, ~1.46 m, plus the bar's own 0.43 m) inside `planHazards` when building
`barCrossings`, so every consumer — `stepRider`, `barIsHere`, the strategies —
sees one consistent number and the rival AI/balance do not shift relative to it.

**I did not do it**, deliberately: it moves when the bonk fires by 1.9 m
immediately after a fix for the bonk firing in the wrong place, and I had **no
browser this session** to check it does not read as "she slows before the bar".
It wants eyes first. The artifact it would remove is ~3× smaller than what was
reported.

## Checks

- `npm run build` — **exit 0**, run directly, never piped.
- `npm run test:procgen` — **137 passed, 8 files, 0 skipped** (was 132; +5 is the
  new invariant across five seeds).
- `npm run check:rail-race` prints the new lines:
  `duck bar underside 6.67 … clears by 0.26, strikes by 0.99` and
  `face monitor turned −50.0° worst eye facing 0.546 …`.

## Needs eyes (I had no browser — chrome MCP absent this session)

1. **Does the 50° turn read as "racing forwards, glancing at you"** or as
   sitting oddly in the cart? The one real judgement call here.
2. **Does a bonk read as a bonk** — bar arrives, she snaps down, wobbles? And is
   the 4-frame skull graze noticeable enough to want the contact lead above?
3. **Do the bars look right 7.05 m over the rail** with stretched posts —
   proportionate to a 5.3 m child, but it is a big change from 5.25.
4. Rivals: same three questions, plus their new hands-over-head bonk pose.
5. #223's own outstanding item: does `'frown'` read as distinct from
   `'sad'`/`'surprised'` at gameplay distance — now that it can be seen at all.

**Ride at level 3** or there will be no bars. `/rail-race` deep link; use a
private window.
