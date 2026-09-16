# Sizing: moving the terrain onto `Geo`, before building it

Asked for by the Overseer, 14 September 2026, after Jim's ruling: *"it also
should be possible to make the park any size so long as it doesn't touch its
opposite side by wrapping around the sphere - no artificial limit please"* and
*"a sphere has no edge, the worst is that it would touch its own opposite
side."*

**Nothing here is built.** This is the cost, measured.

---

## 1. The premise, verified rather than accepted

The claim was that `capHeight` is singular past `d = R`. It is, and it is worse
than "returns a clamped value" — **the entire far half of the planet is mapped
onto a single point**:

```
  d=   200  capHeight=  -128.348  up=(0.9091, 0.4166, 0.0000)
  d=   215  capHeight=  -173.363  up=(0.9773, 0.2120, 0.0000)
  d=   219  capHeight=  -199.048  up=(0.9955, 0.0952, 0.0000)
  d=   220  capHeight=  -220.000  up=(1.0000, 0.0000, 0.0000)
  d=   230  capHeight=  -220.000  up=(1.0000, 0.0000, 0.0000)
  d=  5000  capHeight=  -220.000  up=(1.0000, 0.0000, 0.0000)
```

Every point at `d ≥ R` reports the same height and the same (horizontal) up.
That is not a sphere running out; it is **the flat assumption inside a function
written as a height above a plane**. A vertical column at radius > R never meets
the sphere, so the question `terrainHeight(x, z)` asks is ill-posed out there —
the function is not failing, the *query* is.

## 2. What the artificial limit actually costs: exactly half the planet

Spherical cap area for geodesic radius `s` is `2πR²(1 − cos(s/R))`:

| | geodesic radius | area | of the planet |
|---|---|---|---|
| park today | 105.0 m | 34.0 k m² | **5.6%** |
| equator — where the cap formulation dies | 345.6 m | 304.1 k m² | **50.0%** |
| antipode — where the park meets itself | 691.2 m | 608.2 k m² | **100%** |

So the limit I wrote into `theGroundIsTheSphereItClaimsToBe` refuses **exactly
half the planet**, and Jim's true limit is the whole of it. The park today uses
5.6%, so nothing is blocked *now* — this is about not having the limit there
when someone wants a bigger park.

## 3. This is two pieces of work, not one, and they cost wildly different amounts

### A. Move the ground onto a radius-of-direction — **small, and I recommend it**

The terrain becomes `groundRadiusToward(direction) → radius`, total everywhere
on the planet, with `terrainHeight(x, z)` kept as an adapter that is *exact* for
`d < R` and refuses past it (because the question is ill-posed there, and
silently answering `-R` is what got us here).

**It makes `geo/ground.ts` simpler, not more complex.** Today
`groundRadiusToward` solves a 3-step fixed point *against `terrainHeight`* —
radius derived from height, which is backwards. Invert the ownership and the
iteration disappears: terrain owns radius-of-direction, `ground.ts` just asks.
That deletes the contraction-factor subtlety the lead documented (the `tan²θ`
trap) rather than preserving it.

**Files that must change: about three.** `terrain.ts`, `geo/ground.ts`, and the
wave field. **The 181 `terrainHeight(` call sites do not have to move** — they
keep working through the adapter, exactly as they do today, because they all sit
at `d << R`.

**The one visible risk, measured.** `groundWaves(x, z)` is `sin`/`cos` of the
*orthographic* `x` and `z`. On a sphere it has to take a sphere-native argument
— the geodesic (log-map) coordinate is the natural choice, agreeing with today's
at the origin. That shifts the wave phase, so **the drawn ground changes**:

| distance from centre | phase shift | ground moves by | of the 1.26 m wave amplitude |
|---|---|---|---|
| 25 m | 0.05 m | 0.001 m | 0.1% |
| 75 m | 1.53 m | 0.035 m | 2.8% |
| **105 m (park edge today)** | **4.46 m** | **0.157 m** | **12.5%** |
| 150 m | 15.05 m | 0.384 m | 30.5% |

**Worst change anywhere inside today's park: 0.157 m**, zero at the centre, on
gentle undulation. Almost certainly imperceptible — but it *is* a change to what
a child sees, so it is Jim's call rather than mine, and it is the only part of
(A) that is.

### B. Make the park actually *usable* out there — **large, and not what was asked**

Moving the terrain buys the ability to **represent** a park of any size. It does
not buy one that **works**, because the singularity at the equator is not the
first thing to bite. The `(x, z)` chart is orthographic, and it degrades
*continuously* long before it fails:

| radial stretch | lean | Euclidean | geodesic |
|---|---|---|---|
| 1.1× | 24.6° | 91.7 m | 94.5 m |
| **2×** | 60.0° | 190.5 m | **230.4 m** |
| 5× | 78.5° | 215.6 m | 301.3 m |
| 10× | 84.3° | 218.9 m | 323.5 m |

This is the same defect I measured for the claims registry (1.43× at the park's
reach), now applied to everything else. Counted across `src/`:

- **150** `Math.hypot` on a pair of world `x`/`z`
- **103** `atan2(dz, dx)` bearings — a bearing scalar in a chart with no global north
- **31** `Box3`/bounding-box uses
- **8** uniform grids indexed `floor(x / cell)`
- **181** `terrainHeight(` calls across 81 files (120 in `src/`, 112 of those in `world/`)

None of these *breaks* at the equator; they get progressively wronger. So (B) is
not a migration with an end — it is the whole procgen moving onto the curved
chart, which is the sphere rebuild itself.

**My recommendation: do (A), do not do (B) now.** (A) removes the artificial
limit and is honest about it. (B) should be paid for when someone actually wants
a park past ~230 m geodesic, because that is where the chart error passes 2× and
the park stops being merely distorted and starts being wrong.

## 4. Re-cutting the invariant, per the ruling

`theGroundIsTheSphereItClaimsToBe`'s equator clause becomes:

> the park may not wrap round to meet itself

i.e. the park's **geodesic** radius must stay under `πR` (691 m at R = 220), and
strictly it is the *diameter* that must not close — a park of geodesic radius
`s` meets itself when `2s ≥ 2πR`, so the bound is `s < πR`.

**This cannot honestly be armed until (A) lands.** Today the ground genuinely has
no answer past `d = R`, so a park out there would be drawn on the clamp whatever
the invariant says — and an assertion permitting something the renderer cannot
draw is a check reporting success about a thing it is not describing, which is
the disease this repo already has a section about. So the order is: (A), then
re-cut the clause. Until then the equator clause stays and **says in its failure
message that it is a limitation of the terrain formulation, not of the sphere**
— which is a one-line wording fix I can make immediately and cheaply.

## 5. One thing found while surveying, worth fixing whenever this is touched

**`groundAt` means two opposite things in this codebase.**

```
src/world/geo/ground.ts:101      groundAt(direction, target): Geo     // radius form
src/world/building/surfaces.ts:194  groundAt(x, z): number            // height form
```

Two definitions of one name, with exactly the two parameterisations this
migration is about. That is the repo's signature fault wearing the migration's
own clothes, and it will mislead whoever does (A). Rename the local one.

## 6. Also worth knowing

The ride engineer has **withdrawn** the "park runs off the planet" alarm — those
readings were the 2.3355× park. At scale 1 the race ring measures 62.1–112.0 m
with **0 of 2880** lane samples past the sphere. **Nothing is broken today.**
This is removing a limit before it bites, not fixing a live defect.
