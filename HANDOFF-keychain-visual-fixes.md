# Handoff: keychain visual fixes (PR #331 follow-up, Jim's 23 Aug feedback)

**Status: COMPLETE.** All four fixes are on `keychain-size-physics`
(commits `5232b47`, `d9fd136`, merge `d641f86`), the full `npm run build`
passed serially with exit 0 (park-boot included), before/after screenshots
are on the `qa-screenshots` branch under `pr331-followup/`, and the evidence
comment is posted on PR #331.

1. **Idle sway** — `WornKeychain` layers the picker's `KEYCHAIN_SWAY_*`
   two-sine dangle additively under the pendulum springs; `update()` is the
   single writer of `pivot.rotation`. Verified numerically at rest
   (z≈0.158 drifting, was frozen 0).
2. **Attachment** — `CHARM_HANGS` moved to each bag's upper outer flank,
   2–4 cm prouder; `check:charm-hang` 0.030–0.040 m on all five bags.
3. **Rumi doll charm** — `rumiCharm()` in `art/models/keychains.ts`, kind
   `rumi` in `KEYCHAIN_KINDS` + `KEYCHAIN_COPY`; picked up by rack, picker,
   Cute-o-dex, save automatically. Verified collect/wear in-browser.
4. **Strawberry outline** — open-ended cone + outlined shoulders, and
   `addSmoothOutline` (materials.ts: weld-by-position + averaged normals
   before inflating) for cone apices; applied to strawberry, heart point,
   Rumi dress.

Nothing outstanding. If picking this up for review changes, the QA entry
point is `/keychain-stall`.
