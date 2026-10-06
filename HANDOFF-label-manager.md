# HANDOFF — label manager (feat/label-manager)

Task (Overseer, from Jim): one owner for every on-screen world text label —
at most one per item, never overlapping, precedence table, stable ties with
hysteresis. Design doc `docs/design/LABELS.md`, check `check:labels`.

## Decisions so far
- `src/ui/LabelManager.ts` owns it. `World.labels` is the park's instance;
  mini-games with labels (dodgems, water fight) own one each.
- Labels register with `labels.add(label)`; an unregistered label is never
  drawn (`sprite.visible = wanted && granted`), so forgetting is loud.
- Resolve runs once per frame after every producer: `Game.tick` just before
  `render()`; headless checks call `world.labels.resolve(view, dt)` after
  `world.update`.
- Precedence: actionFeedback 50 > callToAction 40 > speech 30 > playerName 20
  > name 10. Per item, the highest wanted label is the item's only candidate
  (no fallback to a lower one if it is crowded out).
- Ties: incumbent first, then earliest shownSince, then labelId. A label that
  loses an overlap is held off for LABEL_HOLD_SECONDS.
- Items: chips = zone.id; reptile bubble = `reptile:<exhibit>`; reception
  bubble = `hotel-reception`; wild pet bubble = `wildPet:<uid>`; NPC pill and
  bubble = `npc:<name>`; player pill = `player`.

## State
- [ ] manager  - [ ] migrate  - [ ] check:labels  - [ ] doc  - [ ] PR
