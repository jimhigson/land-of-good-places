# HANDOFF — keyring stand framing (#418)

Branch `fix/keyring-stand-framing`, worktree
`.claude/worktrees/keyring-framing`, dev-server port **5421** (`--strictPort`).

## The task

Jim, 31 Aug:

> "on an iphone in portrait, the keyring stand when zoomed in doesn't show all
> the keyrings. Adjust the camera to be at a distance where all fit in. Also,
> the keyrings at the front overlap those at the back, bring them forward to
> the front edge of the table so it is easier to click one or the other"

Two faults: (1) not all six keyrings fit at 390×844 portrait; (2) front row
overlaps back row so tapping the intended one is hard.

## Root cause found (fault 1) — a by-eye constant

`src/world/KeychainShop.ts`:

```ts
export const KEYCHAIN_VIEW_ZOOM = 4.25;
```

Its own doc comment admits the defect in as many words:

> "Tuned by eye against a real screenshot of the built view, **not computed
> from the frustum maths** — ... so a formula here would only be a
> screenshot's worth of margin allowance dressed up as maths."

That screenshot was a desktop window. A single zoom number cannot be right for
both a wide desktop frustum and a 390×844 portrait one, because
`IsoCamera.applyFrustum` is **height-led with a minimum width**: at portrait
aspect the half-height is driven up by `CAMERA_MIN_VIEW_WIDTH / 2 / aspect`,
so the *horizontal* extent at a given zoom is much narrower than on desktop.
The fix is to derive the zoom from the content bounds at the narrowest
supported aspect, not to type a new number.

## Map of the relevant code

- `src/world/KeychainShop.ts` (1266 lines) — the whole zoomed rack picker.
  - `RACK_COLUMNS = 3`, `RACK_ROWS = 2` — six keyrings, 3×2 grid (Jim, 24 Aug).
  - `RACK_ROW_GAP = 0.75` — depth between rows, local metres.
  - `RACK_CENTRE_LOCAL_Z = -0.02` — the grid's depth centre on the counter.
  - `RACK_KEYRING_SCALE = 3.75` — display size on the counter.
  - `KEYCHAIN_VIEW_ZOOM = 4.25` — **the by-eye constant to replace.**
  - `VIEW_FOCUS_HEIGHT = 1.6`, `VIEW_FOCUS_TOWARDS_STAND` — focus point.
  - `rackFocus`, `viewOpen`, `viewFocus` — camera override state read by
    `Game.tick` via `IsoCamera.setFocusOverride`/`setZoomTarget`.
- `src/world/tapSpacing.ts` — owns `TAP_FINGER_METRES` and the phone viewport.
  - `PHONE_VIEWPORT = { width: 390, height: 844 }` — already the canonical
    narrowest viewport; reuse it, do not invent another.
  - `TAP_FINGER_METRES = 2 * FALLBACK_UNIT_PX * PHONE_METRES_PER_PX` ≈ 1.13 m
    at default zoom — note it is scale-dependent, so at the rack's own zoom
    the equivalent finger in world metres is **smaller** by the zoom factor.
    The tap-separation assertion for the rack must use the finger measured
    *through the rack view's own zoom*, not the walking-around default.
  - `zoneSeparation(a, b)` — centres distance minus the larger pick radius;
    the exact measurement `check:tap-spacing` uses. Reuse it.
- `scripts/check-keyring-hang.mts` — existing, must stay green. Unrelated
  concern (keyring anchor vs backpack geometry), so a layout change on the
  *rack* should not touch it; confirm anyway.
- `scripts/check-tap-spacing.mts` — the pattern to copy for the new check.
- `src/core/IsoCamera.ts` — `applyFrustum`, `setFocusOverride`, `setZoomTarget`.
- `src/core/constants.ts` — `CAMERA_VIEW_HEIGHT`, `CAMERA_MIN_VIEW_WIDTH`,
  `CAMERA_YAW_DEGREES`, `CAMERA_PITCH_DEGREES`, `CAMERA_ZOOM_MAX`.

## Constraints not to trip over

- TEXT/UI-SCALE (GAME_DESIGN.md line 166) is absolute — **never** shrink
  labels to make the framing work.
- `CAMERA_ZOOM_MAX` was *raised* specifically to let `KEYCHAIN_VIEW_ZOOM` have
  its value. A derived zoom that comes out lower is fine; check whether the
  raised ceiling is still needed by anything else before touching it.
- The park has one fixed camera angle forever (ARCHITECTURE.md), so the
  content bounds can be projected into the fixed view basis analytically —
  no need to search over camera angles.
- The keychain zoom sets `Player.riding`, so #405's HUD hiding applies.
  Re-check menu + map behaviour after the camera change.

## Both faults reproduced numerically (measured on the built park)

Camera basis for a yaw/pitch orthographic rig with no roll — derived once, and
worth writing down because getting it wrong is silent:

```
screenRight = ( cos yaw,           0,       -sin yaw          )
screenUp    = (-sin p · sin yaw,   cos p,   -sin p · cos yaw  )
```

### Fault 1 — the outer keyrings are off-frame in portrait

At 390×844, `applyFrustum` gives `base = max(15/2, 11/2/0.462) = 11.903`, so at
`KEYCHAIN_VIEW_ZOOM = 4.25` the frame is **half-width 1.294 m**, half-height
2.801 m. The six keyrings' screen-space extent about `rackFocus` runs
**right ∈ [-0.55, +1.92]**. So `strawberry` overhangs the right edge by
**0.63 m** and `rumi` by 0.53 m. On desktop 16:9 the half-width is 3.137 m and
everything fits — exactly the reported symptom.

**Two causes, not one.** The content is only 2.46 m wide, so it *would* fit a
1.294 m half-width if it were centred. It is not: `VIEW_FOCUS_PLAYER_WEIGHT =
0.43` pulls the focus toward the child, pushing the keyrings off to one side, so
the required half-width is 1.92 rather than 1.23. **The off-centre focus is the
bigger half of the bug**; the zoom constant is the other half.

### Fault 2 — the rows are half a finger apart on screen

Local `+Z` is the camera-facing (front) side — confirmed: `standLocalZ = +3.1`,
and the front row's screen `up` is *lower* than the back row's. A displacement
of Δ along local Z moves a keyring `sin(pitch) · Δ = 0.6157 · Δ` down the
screen, because the cart's facing happens to align local Z with the ground's
up-the-screen axis.

`RACK_ROW_GAP = 0.75` therefore projects to only **0.462 m** of screen
separation, while each keyring is ~0.85 m wide and ~1.1 m tall on screen — so a
front keyring covers most of the one behind it. Column neighbours get 0.800 m.

`check:tap-spacing` cannot see this: it measures **world** distance, and all six
keyrings share one verb, so their overlaps are logged as "harmless ambiguity"
warnings. Jim's report is that the ambiguity is *not* harmless. The new check
must measure **screen-space separation at the view's own zoom** — a different
and more honest question than the walking-around world-space one.

## The geometry available to fix it

- Counter surface is `STALL_DEPTH - 0.06 = 1.44` deep → **front edge at local
  Z = +0.720**.
- Worst keyring half-depth at `RACK_KEYRING_SCALE`, over all six kinds and the
  ±0.18 rad lean: **0.262 m** (`heart`). So the front row can go to
  **local Z = +0.458** without overhanging — up from `+0.355` today.
- Worst keyring half-width: 0.371 m (`rainbow`).
- `TALLEST_CHILD_HEIGHT = 2.97` (kid.ts) is the honest height for the child in
  shot — every hair × hat combination, re-measured by a procgen invariant so it
  cannot go stale. `PLAYER_RADIUS = 0.62`.

## Candidate framings measured

`zoom = min(worstHalfWidth / neededHalfWidth, worstHalfHeight / neededHalfHeight)`

| layout | content half-box | zoom | finger at that zoom | min screen sep |
|---|---|---|---|---|
| current, keyrings only, centred | 1.232 × 0.853 | 4.135 | 0.273 | 0.462 |
| current + child, centred | 1.852 × 1.710 | 2.749 | 0.410 | 0.462 |
| **front row → front edge + child** | 1.852 × 1.710 | 2.749 | 0.410 | **0.525** |
| both rows → both edges + child | 1.852 × 1.710 | 2.749 | 0.410 | 0.564 |

Note the tension: pulling back to fit makes the finger *bigger* in world
metres, so the two faults are coupled and must be solved together.

## The design decided

**A single zoom constant cannot be right for every aspect**, because
`applyFrustum` is height-led with a minimum width:
`halfWidth = max(H/2·aspect, MINW/2)/zoom` and `halfHeight = max(H/2, MINW/2/aspect)/zoom`.
Width is worst on a *narrow* screen (floor `MINW/2 = 5.5`), height is worst on a
*wide* one (floor `H/2 = 7.5`). So one number tuned anywhere is slack somewhere
and short somewhere else — which is the whole bug.

So the zoom is **re-derived from the content against the camera's *current*
frustum**, every frame the view is open. Portrait gets the pull-back it needs;
desktop keeps its tight composition; rotating the phone reframes for free.

1. `IsoCamera.zoomToFit(halfW, halfH, margin)` — new, and the natural owner
   since it already owns `applyFrustum`'s formula. Extract `frustumBase()` so
   there is exactly one copy of `max(H/2, MINW/2/aspect)`.
2. `src/world/keychainFraming.ts` — pure screen-space projection and content
   box, shared by the game and the check so neither re-derives the basis.
3. `KeychainShop` — collects framing subjects once, derives `rackFocus` as the
   **content box centre** (replacing `VIEW_FOCUS_PLAYER_WEIGHT` and
   `VIEW_FOCUS_HEIGHT`, which were hand-tuned to approximate exactly that:
   "nudged until the gap either side of the two subjects came out even"), and
   moves the front row to the counter's front edge.
4. `Game.tick` asks the camera for the zoom instead of passing the constant.

## Mutation transcripts — the check proved red before trusted green

**1. Restore the old by-eye zoom (`viewZoom` returns 4.25) and the old
off-centre focus (`VIEW_FOCUS_PLAYER_WEIGHT = 0.43`)** — i.e. the shipped code:

```
iPhone portrait 390x844: zoom 4.250, frame ±1.294 x ±2.801 m, finger 0.265 m
  tightest is 'strawberry' with -0.718 m of margin to spare
x the 'strawberry' keyring is OUTSIDE the frame — 0.622 m past the left/right edge.
  A child cannot choose a keyring she cannot see (#418).
x the 'rumi' keyring is OUTSIDE the frame — 0.528 m past the left/right edge.
check:keyring-view FAILED — 5 problem(s)          (exit 1)
```

That is issue #418 reproduced exactly, from the built game.

**2. Front row back to the old `RACK_ROW_GAP` position** (`localZ 0.355`
instead of the derived `0.418`) — the view zooms in to the ceiling trying to
keep the rack tappable and runs out of frame:

```
iPhone portrait 390x844: zoom 4.135, frame ±1.330 x ±2.879 m, finger 0.273 m
x the 'strawberry' keyring is inside the frame but 0.000 m into the 8% margin
  — it touches the edge of the screen.
check:keyring-view FAILED — 1 problem(s)          (exit 1)
```

**3. Drop the tap floor from `viewZoom`, with the front row also back** — the
tap branch on its own, six failures across both phone orientations:

```
iPhone portrait 390x844: zoom 2.059, frame ±2.671 x ±5.780 m, finger 0.548 m
  closest pair 'ripika' and 'rainbow': 0.302 m vs a 0.548 m finger (TOO CLOSE)
x 'stall:keychain:ripika' and 'stall:keychain:rainbow' are 0.302 m apart on screen
  once their pick areas are allowed for, inside the 0.548 m a fingertip covers at
  this zoom — a tap aimed at one can select the other (#418).
  ... and 'star'/'heart', 'strawberry'/'rumi', plus all three again in landscape
check:keyring-view FAILED — 6 problem(s)          (exit 1)
```

## Green, after the fix

```
iPhone portrait  390x844 : zoom 3.808, frame ±1.444 x ±3.126, finger 0.296
   tightest 'strawberry' 0.106 m of margin spare; closest pair 0.341 vs 0.296 (0.044 spare)
iPhone landscape 844x390 : zoom 5.192, frame ±3.126 x ±1.444, finger 0.296
   tightest 'heart' 0.465 m spare;            closest pair 0.341 vs 0.296 (0.044 spare)
desktop 16:9  1920x1080  : zoom 3.747, frame ±3.558 x ±2.001, finger 0.148
   tightest 'heart' 0.981 m spare;            closest pair 0.341 vs 0.148 (0.193 spare)
screen basis: analytic and rendered agree to 1.7e-16
```

`CAMERA_ZOOM_MAX` 4.6 -> 5.5: the landscape phone's derived zoom is 5.192 and
4.6 was silently capping it, leaving 0.006 m of tap clearance. Its own doc
comment already established that a derived framing must not run into a hand-set
clamp unnoticed — the clamp rises or the check goes red.

## Browser verification — real 390x844 device viewport, headless playwright-core

Chromium with `isMobile`, `hasTouch`, `deviceScaleFactor: 3` and an iPhone UA —
a real device viewport, not a narrowed desktop window. Deep link
`/keychain-stall`.

**A trap worth writing down:** headless swiftshader renders this scene at about
**1.5 fps**, so the camera's damping takes tens of seconds of wall clock. A
3.5 s wait produced a screenshot of an *unsettled* camera (zoom still 1.0,
focus still on the player) that looked like a total failure of the fix. The
script now polls until `zoom` and `focusPoint` have both converged rather than
waiting a guessed duration.

| | before (`origin/main`) | after |
|---|---|---|
| phone portrait 390x844 | zoom 4.250, **2 of 6 keyrings off-screen** (`strawberry`, `rumi`) | zoom 3.808, **6 of 6 on-screen** |
| desktop 1440x900 | zoom 4.250, 6 of 6 on-screen | zoom 3.747, 6 of 6 on-screen |

The before shot is issue #418 photographed: four keyrings visible, Eleri filling
the left third, and a sliver of pink at the right edge where `strawberry` is cut
off. The after shot has all six spread across the counter with the front row
standing at the table's edge. Desktop is unchanged in character — Eleri fully in
shot with her name label, the whole stall, all six keyrings.

Screenshots: `/tmp/keyring-shots/{before,after}-{phone-portrait,desktop}.png`.

## #405 HUD hiding, confirmed in the browser after the camera change

`check:hud-during-rides` passes but says outright that it drives `ui/Hud.ts`
directly and proves no CSS and no `Game.tick` wiring, so it was checked live:

```
WHILE THE RACK VIEW IS OPEN (riding): riding=true  viewOpen=true   menuButton=hidden   mapPill=hidden   X=shown
AFTER CLOSING (back on her feet):     riding=false viewOpen=false  menuButton=visible  mapPill=hidden   X=hidden
AFTER PRESSING MENU:                  riding=false viewOpen=false  menuButton=visible  mapPill=VISIBLE  drawer data-open="true"
```

The map pill lives inside the menu drawer, so it is correctly hidden until the
drawer is opened. Closed with the on-screen X, the way a child does it.

## Status

- [x] Worktree off `origin/main`; branch pushed.
- [x] Both faults reproduced with numbers, and in a real browser.
- [x] Camera derived from content per viewport (`IsoCamera.zoomToFit`).
- [x] Front row at the table's front edge, derived from the deepest keyring.
- [x] `check:keyring-view` in `pnpm run check`, proved red by three mutations.
- [x] `check:keyring-hang` still green.
- [x] 390x844 before/after screenshots + a wide viewport.
- [x] #405 HUD hiding confirmed live.
- [ ] Full `pnpm run check` (running, 0 failures at check:bus-journey), `build`,
      `test:procgen`.
- [ ] PR referencing #418.

## Cleanup owed at the end

- Dev server on **5471** (mine; 5421 was already taken by another agent, so I
  did not use it). Kill by PID, then confirm with
  `lsof -nP -i:5471 | grep LISTEN`.
- Scratch files `_shots.mjs`, `_hud.mjs`, `_probe2.mjs`, `_probe3.mjs` in the
  worktree root — delete, never commit.
