# Handoff — animal hat heads (RiPika / Trilla critter hoods)

**Branch** `animal-hat-heads`. **Worktree** `.claude/worktrees/animal-hat-heads`.

## The job

`hats.ts`'s `createRipikaHat()` and `createPuffHat()` currently perch a shrunken
copy of the *creature itself* on the wearer's crown (`buildRipikaHead()`,
`createPuffCreature()`). That reads as uncanny — you are wearing a tiny animal,
not a hat. Replace both with **designed critter hoods**: ears, a stylised face
on the front, a hood/cap silhouette, in each creature's own palette.

## What the reference told us (emp.co.uk Pikachu cap, photos saved)

Photos in `scratchpad/ref/{a,b,c,d}.jpg` (a = 3/4 front, b = back).

1. It is a **structured snapback**, not a soft hood: crown, panel seams, a
   crown button, a straight peak, a band.
2. **The face lives on the crown's front wall, entirely above the peak.** The
   peak is a separate horizontal plane below the chin. This is the thing that
   makes it read as a hat rather than a head.
3. **Ears are sewn onto the top-back of the crown**, at the 10-and-2 positions,
   leaning outward — placed for silhouette, not anatomy.
4. Face is appliqué: flat eyes, flat cheek discs, tiny nose, wide mouth. No
   sculpted muzzle anywhere.

We take (1)–(4) as the *genre*. Everything visual is our own.

## The two designs

**RiPika cap** — a neat six-panel plush cap. Yellow crown, deep-yellow peak
with a cream (`ripikaBelly`) lining, cream hem roll (the sweatband), a
deep-yellow crown button, and RiPika's own painted face (disc cheeks, cocoa
nose, `cat` mouth). Ears are **short, wide, blunt plush paddles** — RiPika's
own "short-for-their-kind, rounded" ears, flattened as appliqué, not the long
thin spikes of the reference. One ear droops more than the other (the required
asymmetric feature).

**Trilla bonnet** — deliberately a different *kind* of hat: a soft round
bonnet with **real earflaps**, which is what the hood shell's varying hem is
for. `blossomPink` shell, pale `stonePinkLight` brim and a pale bib patch above
it, `heartPink` hem roll, and the puff's own `heartPink` curl worn as the
bonnet's topknot (its asymmetric feature, and the only thing it borrows
literally). Trilla has no ears, so the flaps carry the silhouette instead.

## Peak height (the reported defect)

The prototype's peak sat too low. Fixed by giving the hood a **front hem well
above the side hem** so the peak springs from a brow line rather than the band:

| | peak y (head units) | in metres below the crown |
| --- | --- | --- |
| existing `cap` hat (family said correct) | −0.08 | −0.120 |
| RiPika cap | −0.086 | −0.129 |
| Trilla bonnet | −0.128 | −0.192 |

The kid's eye-tops are at −0.42 m below the crown, so both peaks clear the eyes
by ≥ 0.23 m.

## Method

Modelled in Blender against the hair agent's `KidRef_*` reference kid (still in
the scene; skull r = 0.66 m, hat anchor at z = +0.63 in that frame), then
hand-ported — the `hairShell.ts` precedent. The Blender prototype runs the
*same* parametric formulas the runtime will, so nothing is lost in the port.

Renders: `scratchpad/renders/ripika09_*.png`, `trilla04_*.png` (front / iso 38°
/ side / back / whole-kid).

## Decisions worth keeping

- **Face patch is a sector of the hood's own surface**, not `createFacePatch`'s
  sphere patch. A sphere patch floats off an ellipsoidal hood at the top.
  `hoodFacePatchGeometry` UV-maps a (φ, y) window of the shell and offsets it
  along the true surface normal.
- **A bolt badge on the side of the RiPika cap was tried and dropped** — three
  rounded slabs read as a defect, not a lightning flash, and it broke the
  silhouette. Worth retrying as a proper extruded bolt polygon if the family
  wants more RiPika signature.
- **The puff hat sings** (`createPuffCreature` schedules a melody, bursts
  notes, swaps to a singing face and jiggles). The bonnet must keep all of
  that — do not drop it when replacing the creature reuse.

## Status

- [x] Reference studied, both designs modelled and rendered in Blender
- [ ] Ported to `src/art/models/hoodShell.ts`
- [ ] `hats.ts` rewired; puff song preserved
- [ ] `npm run build` exit 0 (`check:hat-fit` bounds: span 0.45–1.15× the bare
      head, tip ≤ 1.45× the kid's height — both designs measure ~1.0× span)
