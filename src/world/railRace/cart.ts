import { Color, Group, Mesh, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { cartAssetMesh, cartAssetPart } from '../../art/models/cartAsset';
import { addOutline, decal, disposeTree, solid, toonMaterial } from '../../art/style/materials';
import { heartGeometry } from '../../art/style/shapes';
import { RIDE_SCALE } from './route';

/**
 * **A cart for the Rail Race** — one per rail, four on the ring.
 *
 * The cart is an **authored asset** (`art/blend/cart.blend` →
 * `src/art/assets/cart.glb` → `cartGlb.ts` → `art/models/cartAsset.ts`), the
 * same `.glb` pipeline the player kid's body and head already use
 * (`ART-AGENT-NOTES.md` §6a). It replaces a hand-tuned procedural version
 * that shipped with the tub's own walls and floor completely burying every
 * wheel — twice, in two separate review passes.
 *
 * ## Two rounds of live feedback, both addressed by this shape
 *
 * **Round 1** (playtest, "just rectangles with headlights"): a first Blender
 * pass fixed wheel visibility geometrically (ray-cast verified) but Jim's
 * next live look found "half-wheels vanishing at random below a weird
 * looking box thing" — the first asset only cleared the wheel by a partial
 * margin (tub floor at the wheel's own axle height), which held up at zero
 * pitch/roll but not once the whole rigid cart pitches on this route's real
 * hills (`RailRace.ts`: `cart.group.rotation.x = -Math.asin(tangent.y)`,
 * observed up to several degrees around the lap) combined with the ride's
 * own camera looking down at a real angle (`camera.ts`, ~20° declination) —
 * a viewing ray that isn't purely side-on any more clips through the tub
 * before it reaches the wheel, at some but not all points on the track,
 * which is exactly what "vanishing at random" looks like from the sofa.
 *
 * **Round 2** (Jim, same day): reshape to read as an actual mine cart — a
 * hopper that flares wider at the rim than at the floor, on a visible
 * wheeled underframe — using a reference silhouette, cute (not rusty/worn)
 * colours per this game's own house style.
 *
 * The fix for both in one move: rather than exposing the wheel by a *partial*
 * margin (which is what broke under pitch), the hopper's floor is now set
 * **entirely above the wheel's own top point** (`FLOOR_Y = 0.38` against a
 * wheel top of `2 * WHEEL_RADIUS = 0.32`) — full vertical separation, so
 * there is no pitch/camera angle at which the hopper's own floor plane can
 * sweep down into the wheel's silhouette. The mine-cart taper (narrow floor,
 * wide rim) and the thin, deliberately inboard `frame-rail-l/r` (nowhere near
 * the wheels' own x-position) are what give the wheels the "on a chassis"
 * read the reference has, while never being the thing that occludes them.
 *
 * **What the asset owns:** each part's shape and its own local transform —
 * `hopper`, `frame-rail-l/r` (shared geometry), `seat-back`, `seat-base`,
 * `pet-seat`, `pet-back`, four wheels (`wheel-fl/fr/bl/br`, shared geometry)
 * and two headlamps (`lamp-l/r`, shared geometry) — modelled in Blender
 * against this file's own reference numbers (`WHEEL_RADIUS`, the rail gauge,
 * `SEAT_HEIGHT`), not copied from them.
 *
 * **What stays in code**, same split the kid uses for skin/hair colour: every
 * material (this cart's whole colour comes from `LANE_COLOURS[lane]` at
 * runtime — see the file-level colour-bug note below), the wheel-spin idiom
 * (`spinWheels`, unchanged — the wheel geometry is still a plain unrotated
 * cylinder, so `rotation.z = PI/2` once and `rotation.y` every frame still
 * lays it on its side and rolls it exactly as before), and the headlamp glow
 * (a separate task is adding real light sources to these lamps — their
 * *mesh* lives in the asset, mounted on the hopper's own sloped front face,
 * but the emissive material/behaviour is still assigned here, so that work
 * only needs to touch this file, not the asset).
 *
 * ## Scale
 *
 * Built at natural size, in the same metres the old two-box cart used
 * (`RailRace.ts`'s `buildCarts` applies `RIDE_SCALE` to the whole group
 * externally, once, alongside the rider riding inside it — baking a second
 * scale into the asset would double it up, which is why `blend:cart` never
 * touches `RIDE_SCALE`). The wheel gauge is the one number that has to agree
 * exactly with the world the cart is dropped into: it is baked into the
 * asset at `0.31` m either side of centre, which is `RAIL_GAUGE / RIDE_SCALE
 * / 2` — and, because `RAIL_GAUGE := 0.62 * RIDE_SCALE` (`track.ts`), that
 * ratio is `0.62 / 2` regardless of what `RIDE_SCALE` is set to, so baking it
 * is safe rather than a second hand-picked constant that could drift.
 * `scripts/check-cart-shape.mts` asserts the asset's actual baked gauge
 * against `RAIL_GAUGE` so a future change to either number is caught rather
 * than silently decoupled.
 *
 * ## Why the colour bug this replaces happened
 *
 * The old caller passed each rival's own `RIVALS[].cart` colour — a second,
 * hand-maintained copy of "which colour is this racer" that was never checked
 * against `track.ts`'s `LANE_COLOURS` and had drifted out of step with it
 * (and the player's cart was not even parameterised — hardcoded to
 * `markerPink` regardless of which lane, i.e. rail colour, she was actually
 * on). `RailRace.ts` now derives every cart's colour from `LANE_COLOURS` by
 * lane, the same array the rails themselves are painted from, so there is
 * only one fact to ever get right.
 */

/** Every named part `art/blend/cart.blend` exports. */
export const CART_PARTS = [
  'hopper',
  'frame-rail-l',
  'frame-rail-r',
  'seat-back',
  'seat-base',
  'pet-seat',
  'pet-back',
  'wheel-fl',
  'wheel-fr',
  'wheel-bl',
  'wheel-br',
  'lamp-l',
  'lamp-r',
] as const;

export type CartPart = (typeof CART_PARTS)[number];

/**
 * Wheel radius, in this cart's own (pre-`RIDE_SCALE`) metres — baked into the
 * asset's `wheel` mesh at this same radius, and still needed here for
 * {@link CartHandle.spinWheels}'s circumference math.
 */
export const WHEEL_RADIUS = 0.16;

/**
 * How high the seat's own sitting surface is, in this cart's own
 * (pre-`RIDE_SCALE`) metres — the one fact `RailRace.ts`'s `poseRider()` and
 * `buildCarts()` both need to actually put a rider *on* the seat rather than
 * hovering over the cart's floor. Baked into the asset's `seat-base` node at
 * this same height (its top surface sits at exactly `SEAT_HEIGHT`); kept as
 * an explicit exported constant, same discipline as the kid rig's own
 * `KID_HEAD_HEIGHT` staying in code rather than something a caller would have
 * to measure out of the mesh.
 */
export const SEAT_HEIGHT = 0.47;

/**
 * Where a pet mark sits, relative to the asset's own `pet-seat` node —
 * derived from that node's authored position rather than a second, absolute
 * hand-picked coordinate that could quietly stop matching it if the perch
 * ever moves in Blender.
 */
const PET_MARK_OFFSET = new Vector3(0, 0.1, -0.045);

export interface CartHandle {
  readonly root: Group;
  /**
   * Spins the wheels to match how far the cart has rolled.
   *
   * Takes **absolute** metres travelled (`Rider.travelled`), not a per-frame
   * delta, and sets each wheel's angle outright (`distance / (WHEEL_RADIUS *
   * RIDE_SCALE)`) rather than accumulating one — so a fresh race, which
   * resets `Rider.travelled` to 0, resets the wheels to the same start angle
   * too, and there is no drift to accumulate over a long race.
   *
   * `travelled` is real, unscaled world arc-length (`route.ts`), but the
   * wheel actually drawn is `RIDE_SCALE` bigger than `WHEEL_RADIUS` — the
   * external `group.scale.setScalar(RIDE_SCALE)` this cart relies on grows it
   * along with everything else. Dividing by the bare, pre-scale radius spins
   * the wheel `RIDE_SCALE`× too fast for the ground it is actually rolling
   * over; the rendered circumference is what has to match the distance.
   */
  spinWheels(travelled: number): void;
  dispose(): void;
}

/**
 * Builds one cart, painted to match its lane's rail colour.
 *
 * @param colour - This cart's own colour. Callers should pass
 *   `LANE_COLOURS[lane]` (`track.ts`) so a cart always matches the rail it
 *   is riding, never a second, independently chosen colour.
 */
export function createCart(colour: number): CartHandle {
  const root = new Group();
  root.name = 'railRace:cart';

  const bodyMaterial = toonMaterial(colour);
  const deepMaterial = toonMaterial(new Color(colour).multiplyScalar(0.8).getHex());
  const petMaterial = toonMaterial(new Color(colour).lerp(new Color(PALETTE.buildingWall), 0.5).getHex());
  const wheelMaterial = toonMaterial(PALETTE.ink);
  const frameMaterial = toonMaterial(PALETTE.ink);
  const lampMaterial = toonMaterial(PALETTE.fairyWarm, {
    emissive: PALETTE.fairyWarm,
    emissiveIntensity: 1,
  });
  const petMarkMaterial = toonMaterial(PALETTE.buildingWall);

  // --- hopper -------------------------------------------------------------
  const hopper = solid(cartAssetMesh('hopper', bodyMaterial));
  addOutline(hopper, 0.02);
  root.add(hopper);

  // --- underframe -----------------------------------------------------------
  // Dark, metal-toned rails connecting the hopper down to the wheels — a
  // deliberately thin, inboard chassis (nowhere near the wheels' own
  // x-position) so it reads as "on a frame" without ever being a second
  // thing that could occlude a wheel the way the hopper itself once did.
  for (const name of ['frame-rail-l', 'frame-rail-r'] as const) {
    root.add(solid(cartAssetMesh(name, frameMaterial)));
  }

  // --- headlamps ------------------------------------------------------------
  // A warm glowing disc either side of the hopper's front slope — the same
  // "emissive reads as lit, no dynamic light needed" trick as the dodgem's
  // spark and star, which is deliberately cheap: up to four of these carts
  // are on screen at once over trestle-heavy scenery, and a `PointLight` per
  // cart is not worth the draw-call and shadow-map cost for a glow that
  // reads just as well without it.
  for (const name of ['lamp-l', 'lamp-r'] as const) {
    root.add(decal(cartAssetMesh(name, lampMaterial)));
  }

  // --- wheels ---------------------------------------------------------------
  // Gauge matches `RAIL_GAUGE` exactly (see the file header): baked into the
  // asset, checked against it by `scripts/check-cart-shape.mts`. The
  // hopper's floor sits entirely above the wheel's own top point, so there
  // is no pitch or camera angle at which the hopper occludes it.
  const wheels: Mesh[] = [];
  for (const name of ['wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br'] as const) {
    const wheel = solid(cartAssetMesh(name, wheelMaterial));
    // Same idiom as `minigames/dodgems/car.ts` and the procedural cart this
    // replaces: lay the cylinder on its side once, then drive its rolling
    // angle through `rotation.y` every frame. The asset's wheel geometry is
    // still a plain unrotated cylinder (axis along local Y), so this still
    // works unchanged.
    wheel.rotation.z = Math.PI / 2;
    root.add(wheel);
    wheels.push(wheel);
  }

  // --- rider's seat -----------------------------------------------------
  // Centred on the cart's own origin, because that is where `RailRace.ts`
  // actually stands the rider (rivals' `kid.root` and the player's own model
  // both sit at `x = 0` inside/against this cart) — the backrest has to be
  // where she really is, not just somewhere in the hopper.
  const seatBack = solid(cartAssetMesh('seat-back', deepMaterial));
  addOutline(seatBack, 0.016);
  root.add(seatBack);

  root.add(solid(cartAssetMesh('seat-base', deepMaterial)));

  // --- pet perch --------------------------------------------------------
  // A second, smaller bench beside the rider's — the physical space the brief
  // asks for. It is never occupied by a live model here: the park's existing
  // "a pet comes with you" feature is `entities/parade/BackpackPeek.ts`, which
  // already rides along for free wherever the character herself goes (it is
  // driven off her own body's `backpackAnchor`, not off any ride-specific
  // code), so whichever pet she has out already pops its head up beside her
  // during this ride exactly as it does everywhere else in the park. Actually
  // seating a *specific* walking pet down here — one of `entities/parade`'s
  // own members, sat rather than walked — would need new per-ride wiring
  // (which pet, spawned and posed for the ride, torn down at the dismount)
  // and is future work; see `HANDOFF-rail-cart-upgrade.md`.
  const petSeat = solid(cartAssetMesh('pet-seat', petMaterial));
  addOutline(petSeat, 0.014);
  root.add(petSeat);

  root.add(solid(cartAssetMesh('pet-back', petMaterial)));

  // A little paw-print stand-in — a heart, the shape the park already uses
  // for "a pet belongs here" (`art/models/backpacks.ts`'s heart backpack
  // decal) — marking the perch as a pet's spot at a glance, without needing a
  // second bespoke decal shape. Not part of the asset: it reuses an existing
  // shared primitive rather than being a unique modelled surface, so it stays
  // procedural, positioned off the asset's own `pet-seat` placement.
  const petMark = decal(new Mesh(heartGeometry(0.08, 0.02), petMarkMaterial));
  petMark.position.copy(cartAssetPart('pet-seat').position).add(PET_MARK_OFFSET);
  petMark.rotation.x = -0.3;
  root.add(petMark);

  return {
    root,

    spinWheels(travelled: number): void {
      const angle = -travelled / (WHEEL_RADIUS * RIDE_SCALE);
      for (const wheel of wheels) wheel.rotation.y = angle;
    },

    dispose(): void {
      // `disposeTree`, not a hand-rolled walk: every part's geometry now
      // comes from the shared asset cache (`cartAsset.ts`, `markShared`) —
      // four carts, and every future one, all point at the same wheel and
      // lamp buffers, so freeing them here would corrupt the other carts
      // still on the ring. `disposeTree` already knows to skip anything
      // `markShared` marked and to free only this cart's own materials.
      disposeTree(root);
    },
  };
}
