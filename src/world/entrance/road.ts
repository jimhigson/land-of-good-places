import type { BufferAttribute, BufferGeometry } from 'three';
import { toonMaterial } from '../../art/style/materials';
import { roadTexture, type RoadTone } from '../../core/textures';
import { CAT_BUS_WIDTH } from './catBus';

/**
 * **The road the cat bus arrives on — one road, in two scenes.**
 *
 * Jim, 7 August 2026: *"it doesn't actually drive up to the park, the road
 * needs to actually go to the park."*
 *
 * The ride and the park are separate `Scene`s and have to be (`BusJourney`
 * explains why at length: the park's terrain is a hilltop diorama and the ride
 * has to be on screen before any park exists). So "the road goes to the park"
 * cannot be one continuous mesh. What it *can* be — and what it now is — is one
 * road **specification**, which both scenes build from: the same width, the same
 * kerbs, the same slab courses, the same dashed line down the middle.
 *
 * That is the whole reason this file exists rather than each scene owning its
 * own ribbon. Two roads kept the same width by hand is this repo's most
 * expensive bug shape, and here it would be visible in the worst possible place:
 * the single cut between the ride and the park, where a child's eye is on the
 * road and nothing else.
 *
 * **One thing does differ across the cut, on purpose** (#477): the park's road
 * is cut from grey stone and the ride's lane from sand. See
 * {@link roadMaterial}. It is a tone, not a shape — every dimension above still
 * comes from here, so the two roads still line up kerb to kerb and dash to
 * dash, and the thing that would actually read as a jump (a road that changes
 * width or loses its markings) still cannot happen.
 */

/**
 * Half the carriageway, in metres — **derived from the bus, so "narrow" stays
 * true.**
 *
 * *"A narrow lane"* is a relationship, not a number: the lane is narrow when the
 * bus nearly fills it. A hand-picked 5.2 gave a carriageway 1.6 times the bus's
 * width, which on screen read as a wide sandy road with a bus somewhere on it. A
 * verge of about half a bus-width in total is a lane a bus only just belongs on,
 * and it moves on its own if the bus is ever resized again.
 *
 * **Still the bodywork, and #364 is why that is worth a paragraph.** The
 * wheels doubled and moved outboard, so the vehicle now measures 7.25 m across
 * its tyres against a 5.28 m body, and the obvious response — derive this from
 * `CAT_BUS_TRACK_WIDTH` instead — was made and reverted. It gives a 9.75 m
 * carriageway, and **the gate arch the road drives through is 8.6 m wide**:
 * five procgen seeds went red at once with *"the road is not going through the
 * arch, it is spilling across the park"* and the roadside walls of the journey
 * lane standing 0.43 m inside their own carriageway.
 *
 * It was also unnecessary. The track is 7.25 m and this road is 7.78 m, so the
 * tyres run on tarmac with 0.26 m to spare either side — narrower verges than
 * the paragraph above describes, but a bus that fits. That margin is asserted
 * in `check:cat-bus-suspension` rather than left as a sentence here, because a
 * sentence promising two numbers agree is not a mechanism.
 */
export const ROAD_HALF_WIDTH = CAT_BUS_WIDTH / 2 + 1.25;

/**
 * How many metres of road one tile of {@link roadTexture} covers, along its
 * length.
 *
 * Set to the road's own width, which is what makes the paving slabs square:
 * the texture is a cross-section, so `u` spans the full width and `v` spans this
 * — pick anything else and the slabs are stretched one way or the other.
 *
 * It is the one owner of the road's scale. Both roads write `v` in these units
 * (see {@link applyRoadUvs}) rather than each setting a `repeat` on a shared
 * texture, which would have meant one texture per road length and two numbers
 * that have to agree for the seam to work.
 */
export const ROAD_TILE_METRES = ROAD_HALF_WIDTH * 2;

/**
 * The road's material.
 *
 * **The width, the kerbs, the slab courses and the centre line are the same
 * whatever tone is asked for** — that is the whole point of this module, and
 * `tone` deliberately cannot reach any of them. It picks which stone the
 * carriageway is cut from, and nothing else (`textures.ts`'s {@link RoadTone}
 * explains why that is a second bake rather than a tint).
 *
 * Two callers, and the difference between them is issue #477:
 *
 * - `BusJourney.ts` — the **intro ride's** lane, in its own scene. Takes the
 *   default, `'sand'`, and is therefore byte-identical to what it always drew.
 * - `Entrance.ts` — the park's own road, the one a child walks out to and the
 *   one the bus stands on. `'grey'`, per Jim: *"the paving outside the park
 *   that the bus arrives on should be grey during gameplay - don't change the
 *   intro sequence."*
 *
 * A default of `'sand'` rather than a required argument is what keeps that
 * promise mechanical: the intro asks for a road and gets the road it had, so
 * nobody can change it here without going to the ride and typing the change
 * out.
 */
export function roadMaterial(tone: RoadTone = 'sand'): ReturnType<typeof toonMaterial> {
  return toonMaterial(0xffffff, { map: roadTexture(tone) });
}

export interface RoadUvOptions {
  /** Which world axis runs across the road. */
  readonly across: 'x' | 'z';
  /** Which world axis runs along it. */
  readonly along: 'x' | 'z';
  /** Where the centre line sits on the `across` axis. Defaults to the origin. */
  readonly centre?: number;
}

/**
 * Rewrites a road ribbon's UVs so the texture lands on it in **metres**.
 *
 * `u` spans the carriageway exactly once — that is what pins the kerbs to the
 * kerbs and the dashes to the middle — and `v` counts {@link ROAD_TILE_METRES}
 * along it, so a road of any length gets the same-sized slabs without anybody
 * choosing a `repeat` for it.
 *
 * Read off the geometry's **own positions**, which must already be in world
 * coordinates. That is deliberate: displacing a plane and then moving the mesh
 * is exactly the mistake that put the journey's hills 100 m out of step with
 * everything driving on them (see `BusJourney.buildGround`), and UVs computed
 * from positions inherit that error silently. Bake the offset into the geometry
 * and there is only ever one coordinate here.
 */
export function applyRoadUvs(geometry: BufferGeometry, options: RoadUvOptions): void {
  const { across, along, centre = 0 } = options;
  const position = geometry.getAttribute('position') as BufferAttribute;
  const uv = geometry.getAttribute('uv') as BufferAttribute | undefined;
  if (!uv) throw new Error('applyRoadUvs: road geometry has no uv attribute');
  const get = (index: number, axis: 'x' | 'z'): number =>
    axis === 'x' ? position.getX(index) : position.getZ(index);

  for (let i = 0; i < position.count; i += 1) {
    const u = (get(i, across) - centre) / (ROAD_HALF_WIDTH * 2) + 0.5;
    const v = get(i, along) / ROAD_TILE_METRES;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}
