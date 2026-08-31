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

## Status

- [x] Worktree created off `origin/main` (6d475dab).
- [x] Root cause of fault 1 identified — off-centre focus **and** by-eye zoom.
- [x] Both faults reproduced with numbers (above).
- [x] Design decided (above).
- [ ] Derive zoom from content bounds at narrowest aspect.
- [ ] Move front row to the table's front edge, measure separation.
- [ ] New check inside `pnpm run check`, proved red by mutation.
- [ ] 390×844 playwright-core screenshots before/after + a wide viewport.
- [ ] PR referencing #418.

## Notes for a replacement

Five disconnects so far, all early — commit early and often. `pnpm run check`
is the 47-check suite; `build` is `vite build` alone; `test:procgen` separate.
`check:park-boot` is a known load-dependent flake (#324) with seven agents
running — re-run quiet and test `origin/main` before believing a red is yours.
