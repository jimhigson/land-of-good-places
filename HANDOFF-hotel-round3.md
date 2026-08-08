# HANDOFF — hotel round 3 (Jim's 7 Aug live-play feedback) — COMPLETE bar two visual checks

Branch `feat/hotel-236`, shared worktree. Features agent. All six brief items
plus the QA addendum are landed and pushed; commits 6872a7c, 24a6fb7,
24269a3, 526c576, 1710263, 39d7368, a92bb1b, 5f422bc, 69f38f2.

## What landed (one line each; commit messages carry the detail)

1. Reception zone/desk/receptionist/bubble all derive from RECEPTION_X/Z;
   desk now ON the entrance axis at lobby-local (0, −5.9); receptionist
   calls out "Come to the desk and check in!" on keyless entry. Probe 13.
2. Grand-lobby relayout: runner up the axis, statue+ring+disco centrepiece,
   mirrored sofa groups flanking, café in the SW window corner, planters
   flanking the doors, stub column gone, arrow re-threaded. The artist's
   `createGrandStaircase()` placed at the arc centre; treads/flanks/keep-outs
   derive from its handle; flight sunk 2 cm (STAIR_SINK) under the deck
   plane; gallery rail drops the same to keep butting the handrail.
3. Mezzanine z-fight: deck slab abuts the gallery faces, front face owns the
   outer corner, last tread stops 2 cm shy. Probe 10 (coplanar-tops scan),
   proven red with five pairs.
4. Cinematics: matched-pose start AND return in `cinematic.ts`
   (d = viewHalfHeight/tan(fov/2) up the iso diagonal — the iso camera parks
   90 m out, which was the zoom-out), MIN_SHOT_DISTANCE 1.1 clamp in play(),
   aim eased on return. Food shot: chair-frame, free-side (opposite the
   pet's trot-in), 2.7 m @ 40° for chibi proportions — the across-the-table
   draft ended in the OPPOSITE diner's face; watched on frames three times.
   Art shot 1.6 m @ 46° frames the whole canvas. Window vantage stands on
   the plaza's side of the tower (two earlier drafts had crystal filling the
   frame; /view-verified at built coords). Probes 9 + clamp micro-probe.
5. Solid AND standable: Collision gains opt-in absolute-top colliders
   (compared against real feet Y); place.ts requires `top` per prop, plates
   flat tops under JUMP_APEX_HEIGHT; every hotel prop audited. Probe 11
   (proven red: 76 infinite pillars, sofa-top deflection 1.10 m). Park props
   outside place.ts (Scenery trees, tower/castle walls) still register
   Infinity — full height in truth, noted not fixed.
6. Pictures ask `glazedSpans` (one owner with glazeWall) via clearOfGlass —
   slide along the wall clear of panes and doorway gaps. Probe 12 (built
   AABBs), proven red on the lobby west overlap. Lobby west picture now
   at z≈5.1.
QA addendum: yours-door zone has real actions ('Go in!' / 'Where is my
   key?' star-blink) so Selection shows it (probe 13); pet bed moved to
   (−2.6, −6.4) out of the partition occlusion band and made standable; TV
   screen nudged 9 cm proud of its cabinet; suite sofa yawed −0.9 toward
   camera+telly; tower porch lifted 0.62 m clear of the door; reception
   stand-spot steps east of the statue silhouette; café table respun/moved
   twice (rug interleave, then painting-zone crowding — both watched).

## Watched in a real browser (headless chromium, frame bursts)
Lobby entry/composition; staircase from both sides (reads as proper swept
masonry with rail, no box-stack); check-in end-to-end at the axis desk
(sign, chip, script, welcome-back flip); sofa jump lands and stays (also
cleared right over it pre-landing — impossible before; a pet stood on the
cushions by itself); lift call/floors/ride; Floor 1 breakfast sit + eat
cinematic (matched start, gentle push-in, chest framing, clean return);
corridor + pet statues + yours door; window view via /view at built
vantages (floors 1, 50) — plaza framed, no crystal; tower porch/signboard.
No deck flicker visible in any lobby frame (plus probe 10).

## Still owed to a live-tab QA pass (could not stage headless)
- Suite interior post-fix: pet bed + sleeping pet visible from the fixed
  camera at (−2.6, −6.4); TV screen reads (not the cabinet); lounge sofa
  front visible. (Save-restore into the suite fights the autosave-on-unload;
  I stopped rather than sink more time.)
- The art cinematic full flight in-game (machine verified via the food shot;
  end-pose maths and zone probes green; framing maths checked).
- Entrance leaves visibly sliding under the raised porch during approach.

## Ops
My vite (port 5748) killed at end of session. QA agent owns 5643 — never
touched. Foreign WIP (boundary.ts, ride plans) belongs to another agent —
transient page crashes during my runs came from their mid-edit states, not
this branch.
