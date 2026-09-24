# HANDOFF sb-catbus (model: Claude Opus 5.5, chosen by the structural-backtrack engineer)

Task: new check:coplanar finding, cat-bus chassis, 0.969 m2, generation seed 860110031.

- 860110031 = hashString('park-restart/128/7') -> pool seed 128, restart 7 (ACCEPTED_RESTARTS[128] = 7).
- Pair: chassis `<Mesh:RoundedBoxGeometry>` = the unnamed `doorway` decal in catBus.ts vs `cat-bus-shell-lower`.
  Doorway box spans BODY_BOTTOM_Y..BODY_BOTTOM_Y+DOOR_HEIGHT with its outer face on x = -BODY_WIDTH/2,
  the same plane as the lower shell's flank; below WINDOW_SILL_Y it is buried in the solid lower shell.
- Why only seed 128/r7: the sweep only counts faces whose normal faces the fixed iso camera; on that
  park the arrival bus parks with its door (-X) flank toward the rig (normal 0.50,0.32,-0.81).
- Fix: doorway spans only the window band (sill..min(head, door top)), where the flank really is open.
