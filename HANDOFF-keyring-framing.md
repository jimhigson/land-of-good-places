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

## Status

- [x] Worktree created off `origin/main` (6d475dab).
- [x] Root cause of fault 1 identified (by-eye `KEYCHAIN_VIEW_ZOOM`).
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
