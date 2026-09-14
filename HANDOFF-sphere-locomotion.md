# Handoff: locomotion and gravity on the sphere

**Model: Opus 5 (1M context)**, chosen by the Overseer for the Engineer role on
the spherical-world rebuild. **A replacement runs the same model.**

**Branch** `eng/sphere-locomotion`, off `feat/sphere-combined`.
**Worktree** `.claude/worktrees/eng-sphere-locomotion`.

**Lane:** locomotion and gravity for movers — Player, NPCs, pets — on top of
`src/world/geo/`. The collision/nav engineer (`a581ec9314b321968`) owns
`Collision.ts` and `NavGrid.ts`; I call into them and do not edit them.

## The measurement everything here is judged against

`scripts/check-radial-hop.mts`, taken **verbatim from `eng/radial-collide`** so
its numbers are comparable with that branch's. Run:

```
node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-radial-hop.mts
```

**Baseline on `feat/sphere-combined` at `714e7d4e`, before any change of mine
— this is the park a child is walking today:**

```
CONTROL (park origin, 0.0 deg of lean): apex 1.2267 m, drift 0.0000 m, 45 frames airborne.
  d=  0 m (lean  0.0): apex 1.2267 m ( 0.0000 vs origin), across 0.0000 (wanted 0.0000)
  d= 40 m (lean 10.5): apex 1.2064 m (-0.0203 vs origin), across 0.0000 (wanted 0.2193)  FAILED
  d= 80 m (lean 21.3): apex 1.1429 m (-0.0838 vs origin), across 0.0000 (wanted 0.4156)  FAILED
  d=120 m (lean 33.1): apex 1.0290 m (-0.1977 vs origin), across 0.0000 (wanted 0.5612)  FAILED
  d=157 m (lean 45.5): apex 0.8616 m (-0.3651 vs origin), across 0.0000 (wanted 0.6149)  FAILED
worst apex error 0.3660 m; worst landing drift 0.0000 m
```

Two separate faults in those columns, and they need separate fixes:

1. **The apex shrinks with every metre she walks outward** — 30 % of her hop is
   gone at the park's reach. Gravity and the height write run along world `+Y`.
2. **`across` is 0.0000 at every radius.** A hop along the local up carries her
   `apex · sin θ` across the ground and brings her back — **0.875 m at the rim**
   with a correct apex. Hers does not move at all, so in her own frame the hop
   leans towards the middle of the park by that much. This is the half
   `eng/radial-collide` never implemented.

The origin row is the control: the sphere contributes nothing there, and every
form of this arithmetic — right or wrong — agrees to the last decimal. If the
origin ever stops reading 1.2267 / 0.0000, the instrument is broken, not the
game.

## Status

- [x] Instrument ported and run; baseline above recorded.
- [ ] Fix.

## Coordination sent, not yet answered

Asked `a581ec9314b321968` (collision/nav) two boundary questions:

1. Are `resolveMovement`'s `dx`/`dz` **chart** metres or **real surface**
   metres? They are chart metres today, and that is a live bug in my lane: a
   chart step of `s` metres radially is `s / cos θ` of real ground, so a child
   walking outward **speeds up by up to 1.43x at the rim**. My preference is
   that they stay chart metres *deliberately* and I scale by `cos θ` on my side.
2. The hop's lateral half will arrive as part of the `dx`/`dz` I hand them
   (≤ 0.07 m in a frame — far under any tunnelling threshold), rather than my
   writing `position.x/z` behind their back.

## Rules inherited, and why (do not relearn these)

- **Never re-derive a position from an altitude.** `position = foot + up *
  altitude` makes lateral position a function of altitude, so a surface dropping
  away teleports the mover sideways, which raises the altitude further.
  `check:deck-fallthrough` went green → **401 of 1280 runs losing the surface at
  gradient 0.1**, gaps to 50 m. The lateral half must be an **integrated
  impulse**. (`eng/radial-collide`, `HANDOFF-radial-collide.md`.)
- **A per-frame tilt is never a pre-multiply.** `faceOnGround`, not
  `standOnGround`, inside a tick.
- **`walkHeight(x, -Infinity, z)` is `+Infinity`, not `NaN`**, and
  `baseHeight` defaults to `-Infinity` on nearly every collider — the naive
  radial conversion of the base gate makes the whole park non-solid, and it
  typechecks.
- **`scripts/playerSim.mts` is one copy driving three chain checks**
  (`check:deck-fallthrough`, `check:hop-clearance`, `check:wall-tunnelling`).
  Change it once.
