# Jetpack hold-to-fly control rework

## Task
Jim's ask: the jump button becomes dual-purpose once a jet pack is worn — tap
still hops, hold takes off and climbs, release falls under normal gravity.
Remove the separate descend control.

## What the control scheme was

- `fly` (G/R keys, RB gamepad, a dedicated on-screen "up" button): **tap** to
  take off, **hold** to climb (also read `jump` as a secondary hold once
  already flying), **release** to sink at a slow, capped `FLY_SINK_SPEED`
  (~3 m/s — a controlled float, not real gravity).
- `flyDown` (H/T keys, LB gamepad, a dedicated on-screen "down" button):
  **hold** to sink briskly at `FLY_DIVE_SPEED` (~6 m/s) instead of drifting.
  This was the "descend button" Jim wants gone.

## What it is now

One action, `jump`, does everything (`src/entities/Player.ts`, the "THE JET
PACK" comment + `update()`):

- `justPressed('jump') && !airborne` → the ordinary hop, unconditionally,
  pack or not. Unchanged from before.
- While airborne and not yet flying, `jumpHeldFor` accumulates every frame
  `isDown('jump')` stays true (reset to 0 on release or a fresh press). Once
  it reaches `JETPACK_HOLD_THRESHOLD` (0.16 s) **and** `canFlyHere`, `flying`
  flips true — the hop's own existing arc (already partway through, still
  carrying real velocity) is what `approachScalar` eases towards the climb
  target, so there's no snap.
- Once flying: held → `approachScalar` towards `FLY_RISE_SPEED` with the
  existing ceiling-headroom easing (unchanged). **Released → literal
  `verticalVelocity -= GRAVITY * dt`**, the exact same formula the plain
  (non-jetpack) fall uses — this is the "normal gravity takes over" part of
  the ask, replacing the old float. `flying` itself stays true throughout
  (climbing or falling) until she actually lands, so the flying pose and
  `Parade`'s "keep the trail airborne with her" logic don't flicker during a
  brief thrust-off.
- Taking the jet pack off mid-air, or losing `canFlyHere` (e.g. walking
  indoors), just makes `thrusting` false next frame — same gravity fall,
  same as letting go. No separate handling needed.
- `flyDown`/`fly`/`FLY_SINK_SPEED`/`FLY_DIVE_SPEED` are gone entirely, along
  with the G/R/H/T keyboard bindings and the LB/RB gamepad bindings
  (`src/core/input/actions.ts`).

## Why a 0.16 s hold threshold

`jump`'s `isDown` can't tell a tap from the first frame of a hold — both look
identical the instant the button goes down — so every press starts as an
ordinary hop, and only turns into a climb if still held past the threshold.
0.16 s comfortably outlasts the fastest deliberate tap a six-year-old can
manage, and is well short of the ~0.78 s a full hop naturally takes, so a
genuine hold never feels laggy.

## Touch / on-screen control

`src/ui/ScreenControls.ts` used to show three buttons: hop (edge-triggered,
`pressVirtual`) plus a separate fly-up/fly-down pair (state-held,
`holdVirtual`) that only appeared with a pack worn. Now there is **one**
button, always present on touch, bound to `jump` via `holdVirtual` (switched
from `pressVirtual` so a sustained touch produces a sustained `isDown`,
matching a held key/gamepad button). `Game.updateHud` calls
`screenControls.setJetpackAvailable(player.canFlyHere)`, which re-skins that
same button (🚀 glyph, "hold to fly" label, sky-blue background matching the
jet pack's own harness colour) rather than showing a second control.
`src/style.css`'s `.screen-fly`/`.screen-btn--fly-up`/`--fly-down` rules and
the width-widening media query for the old two-button cluster are removed;
added `.screen-btn--jetpack` for the re-skin.

## Fuel/altitude/speed caps — untouched

`PARK_FLY_CEILING` (12 m), `INDOOR_FLY_CEILING` (1.2 m, also disables
take-off indoors), `FLY_CEILING_EASE`, `FLY_RISE_SPEED`,
`FLY_VERTICAL_ACCELERATION` are all unchanged. No fuel mechanic exists or was
added. The only thing genuinely re-tuned is the fall behaviour on release —
deliberately, per the ask.

## Build status

`npm run build` (from inside this worktree — it resolves `node_modules` from
the parent shared checkout via Node's normal upward module search, since the
worktree is nested under it, but every source file it compiles is this
worktree's own `src/`; confirmed by grepping the built bundle for
`screen-btn--jetpack`) — **exit 0**, including `tsc --noEmit` and every
`check:*` invariant script. `npm run test:procgen` could not run — `vitest`
isn't installed in the shared `node_modules` at all (pre-existing gap,
unrelated to this change); this PR doesn't touch procgen so CLAUDE.md's
"extend an invariant" rule doesn't apply here regardless.

## Not done

**No visual/in-browser QA.** The shared chrome-devtools Chrome profile had
another agent's page open on `/rail-race` (port 5991) and I was not told I
own it, so per CLAUDE.md I left it alone. Whoever picks this up with browser
access should check, with a jet pack bought/worn via the shop or character
creator:

1. A quick tap of jump/hop still does a normal hop (no accidental lift-off).
2. Holding jump lifts her off and climbs steadily, easing towards the
   ceiling rather than clunking into it.
3. Releasing mid-climb lets her fall — noticeably brisker than the old
   float-down, since it's now real gravity — with no other input needed.
4. Re-holding mid-fall resumes the climb.
5. On touch (or a narrow/mobile viewport), the single hop button visually
   changes (🚀, sky blue, "hold to fly" label) the moment a pack is worn
   somewhere flight is allowed, and back again indoors / pack off.
6. No leftover G/R/H/T keys or LB/RB gamepad buttons do anything jet-pack
   related any more.

## Files touched

- `src/core/input/actions.ts` — removed `fly`/`flyDown` actions and all
  their bindings.
- `src/entities/Player.ts` — the state machine rewrite described above.
- `src/entities/WornJetpack.ts` — doc comment only.
- `src/core/input/InputSystem.ts` — `holdVirtual` doc comment only.
- `src/ui/ScreenControls.ts` — collapsed to one dual-purpose button.
- `src/style.css` — removed the old fly-pair styling, added the re-skin.
- `src/Game.ts` — `setFlyControls(...)` → `setJetpackAvailable(...)` call site.
