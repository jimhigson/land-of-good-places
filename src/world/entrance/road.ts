import type { BufferAttribute, BufferGeometry } from 'three';
import { toonMaterial } from '../../art/style/materials';
import { roadTexture } from '../../core/textures';
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
 * kerbs, the same slabs, the same dashed line down the middle.
 *
 * That is the whole reason this file exists rather than each scene owning its
 * own ribbon. Two roads kept the same width by hand is this repo's most
 * expensive bug shape, and here it would be visible in the worst possible place:
 * the single cut between the ride and the park, where a child's eye is on the
 * road and nothing else.
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

/** The road's material — one texture, shared by every road in the game. */
export function roadMaterial(): ReturnType<typeof toonMaterial> {
  return toonMaterial(0xffffff, { map: roadTexture() });
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
