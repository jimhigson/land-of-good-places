import { BoxGeometry, Group, Mesh, type Material } from 'three';
import { interiorMaterial } from './parts';
import {
  SHOP_RECESS_DEPTH,
  SHOP_SCALE_XZ,
  SHOP_UNITS,
  shopForecourtRegion,
  shopGroupName,
  shopHasForecourt,
  shopLocalToBuilding,
  shopScaleY,
  worldX,
  worldZ,
  type ShopUnitDefinition,
} from './layout';
import type { CollisionWorld } from '../Collision';
import { COUNTER_HALF_WIDTH } from './shops/stallShape';

/**
 * The seven empty shop units.
 *
 * Build step 4 fits these out. Each one is an alcove with a counter and a
 * stripy awning, plus an empty `Group` named
 * `shop:<id>` sitting at the unit's front-centre on the deck, facing into the
 * room. Whoever builds the shops adds their fittings to that group and hides
 * the placeholder:
 *
 * ```ts
 * const unit = building.shops.getGroup('toy');
 * unit.add(myToyShop);
 * building.shops.setPlaceholderVisible('toy', false);
 * ```
 *
 * **Shops dominate their rooms** (design feedback, 26 July 2026): what
 * `getGroup()` actually returns is a *stage* nested one level inside the unit's
 * anchor. The stage carries the whole "bigger, and sunk into its own forecourt"
 * treatment — `SHOP_SCALE_XZ` bigger footprint, `shopScaleY` taller where there
 * is headroom for it, sunk `SHOP_RECESS_DEPTH` down where `shopHasForecourt` —
 * so anything built into it (the kiosk shell, the stock, the shopkeeper) gets
 * the treatment for free. `getTopperHook()` returns a second, *unscaled* group
 * on the anchor itself, sitting just above the (already enlarged) roofline —
 * reserved for a future giant themed topper per shop (a teddy bear astride the
 * toy shop's roof, and so on). It is empty today; scaling it from the anchor
 * rather than the stage means a topper built into it starts from real-world
 * metres, not from an already-doubled-up scale.
 */
export class ShopUnits {
  private readonly stages = new Map<string, Group>();
  private readonly topperHooks = new Map<string, Group>();
  private readonly placeholders = new Map<string, Group>();

  /** Builds every unit straight into the floor group it belongs to. */
  constructor(floorGroups: readonly Group[], collision: CollisionWorld) {
    for (const unit of SHOP_UNITS) {
      const floor = floorGroups[unit.deck];
      if (!floor) continue;

      const anchor = new Group();
      anchor.name = shopGroupName(unit.id);
      anchor.position.set(unit.x, 0, unit.z);
      anchor.rotation.y = unit.yaw;
      floor.add(anchor);

      const stage = new Group();
      stage.name = `shop-stage:${unit.id}`;
      const scaleY = shopScaleY(unit);
      stage.scale.set(SHOP_SCALE_XZ, scaleY, SHOP_SCALE_XZ);
      stage.position.y = shopHasForecourt(unit) ? -SHOP_RECESS_DEPTH : 0;
      anchor.add(stage);
      this.stages.set(unit.id, stage);

      // A safe, fixed height rather than one derived from the (rotated,
      // tilted) awning/sign geometry: the clear height under the next deck's
      // slab is only 3.3 m and the kiosk already reaches to within a few
      // centimetres of it, so this is placed by known-safe measurement, not by
      // recomputing where the roofline lands.
      const topperHook = new Group();
      topperHook.name = `shop-topper-hook:${unit.id}`;
      topperHook.position.set(0, shopHasForecourt(unit) ? 3.1 : 2.9, 1.0);
      anchor.add(topperHook);
      this.topperHooks.set(unit.id, topperHook);

      if (shopHasForecourt(unit)) floor.add(buildForecourtFloorPatch(unit));

      const placeholder = buildUnit(unit);
      stage.add(placeholder);
      this.placeholders.set(unit.id, placeholder);

      registerCounter(unit, collision);
    }
  }

  /** The group to build a real shop into. Origin at the unit's front-centre, already scaled. */
  getGroup(id: string): Group {
    const group = this.stages.get(id);
    if (!group) throw new Error(`Unknown shop unit: ${id}`);
    return group;
  }

  /**
   * An empty, unscaled anchor just above the shop's (enlarged) roofline —
   * reserved for a future giant themed topper. Nothing hangs off it yet.
   */
  getTopperHook(id: string): Group {
    const hook = this.topperHooks.get(id);
    if (!hook) throw new Error(`Unknown shop unit: ${id}`);
    return hook;
  }

  /** Hide the empty-unit dressing once a real shop moves in. */
  setPlaceholderVisible(id: string, visible: boolean): void {
    const placeholder = this.placeholders.get(id);
    if (placeholder) placeholder.visible = visible;
  }

  /**
   * **Take the empty-unit dressing away for good**, once a real shop has moved
   * into this unit.
   *
   * `Shops` used to call `setPlaceholderVisible(id, false)` here, and every one
   * of the seven units has a real shop in it — so all seven placeholders were
   * built, hidden on the same frame, and then carried for the rest of the game
   * as counters and awnings sitting inside the kiosks that replaced them. That
   * is seven pairs of coplanar faces (#472), 17.5 m² of them, and seven units'
   * worth of geometry nobody will ever see.
   *
   * `check:coplanar` reports them because it deliberately ignores `visible`:
   * two-thirds of the meshes in this game are `visible = false` at build time,
   * since the castle's interior and the hotel's rooms are hidden until you walk
   * in, and honouring the flag would sweep the park and skip every interior.
   * So a permanently-hidden mesh is indistinguishable from a temporarily-hidden
   * one, and the honest fix is the one `ART_DIRECTION.md` §7 asks for anyway:
   * if it is never seen, do not keep it.
   *
   * `setPlaceholderVisible` stays for a unit that has no shop yet, which is
   * still a real state — `Shops` skips any unit with no skin defined.
   */
  discardPlaceholder(id: string): void {
    const placeholder = this.placeholders.get(id);
    if (!placeholder) return;
    placeholder.removeFromParent();
    placeholder.traverse((object) => {
      const mesh = object as { isMesh?: boolean; geometry?: { dispose(): void } };
      if (mesh.isMesh) mesh.geometry?.dispose();
    });
    this.placeholders.delete(id);
  }
}

/**
 * Shop fittings receive shadow but never cast one.
 *
 * They live inside a shell that already casts a deep shadow across the whole
 * floor plate, and there are seven of them: making them casters buys a
 * difference nobody can see for a chunk of the draw-call budget.
 */
function shopMesh(geometry: BoxGeometry, material: Material): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function buildUnit(unit: ShopUnitDefinition): Group {
  const group = new Group();
  group.name = 'unit-placeholder';

  // No back panel: the building's own wall is 15 cm behind this, and an alcove
  // liner nobody can see is not worth a draw call in the shadow pass as well.
  const counter = shopMesh(
    new BoxGeometry(COUNTER_HALF_WIDTH * 2, 0.95, 0.7),
    interiorMaterial(unit.accent, 0.66),
  );
  counter.position.set(0, 0.475, 1.15);
  group.add(counter);

  // Shallow, and set high: a deep awning looks lovely from the ground and hides
  // the whole alcove from a camera that is looking down at 38°.
  const awning = shopMesh(
    new BoxGeometry(4.8, 0.26, 0.95),
    interiorMaterial(unit.accent, 0.6),
  );
  awning.position.set(0, 2.86, 0.42);
  awning.rotation.x = -0.16;
  group.add(awning);

  // No "opening soon!" board: the park has no painted signs any more (family
  // ruling, 28 July 2026). Every one of these units has a real shop in it by
  // the time a child sees it, and the shop names itself on its sign card.
  return group;
}

/**
 * The counter is solid; the alcove behind it is not, so you can lean over and
 * peer in.
 *
 * This used to add *"collision is height-blind, so this holds on every deck at
 * once — which is exactly why no two units are stacked on top of each other."*
 * Half of that is dead: since #377/#380 the floors are disjoint spaces 300 m
 * apart, so a counter reaches no other storey at all
 * (`scripts/probe-height-blind.mts`). The stacking rule outlived its reason
 * anyway — all seven stalls are on the mall now, in one frame, by Jim's own
 * choice (see `layout.ts`).
 *
 * Scaled by `SHOP_SCALE_XZ` to match the now-bigger counter built into the
 * stage — the counter mesh itself lives inside the scaled stage, but this wall
 * is computed independently in world space (collision does not know about a
 * `THREE.Group`'s scale), so it has to be scaled by hand to still land on the
 * counter's real edges instead of on thin air a metre short of it.
 */
function registerCounter(unit: ShopUnitDefinition, collision: CollisionWorld): void {
  // `COUNTER_HALF_WIDTH` rather than a copy of it: the mesh and the wall that
  // has to land on its ends now read the same number, so a stall whose counter
  // narrows can never leave a strip of solid air where its end used to be.
  const [ax, az] = shopLocalToBuilding(unit, -COUNTER_HALF_WIDTH * SHOP_SCALE_XZ, 1.15 * SHOP_SCALE_XZ);
  const [bx, bz] = shopLocalToBuilding(unit, COUNTER_HALF_WIDTH * SHOP_SCALE_XZ, 1.15 * SHOP_SCALE_XZ);
  // Half the counter's real depth (0.7 m), not more — `hotel/place.ts`'s
  // generous-light rule. It no longer costs another storey its floor (the
  // floors are disjoint since #377/#380), but a counter fatter than the wood a
  // child can see is still a child brushing an invisible wall.
  collision.addWall(worldX(ax), worldZ(az), worldX(bx), worldZ(bz), 0.35 * SHOP_SCALE_XZ);
}

/**
 * The sunken forecourt's own floor, capping the bottom of the hole cut for it
 * (see `DECK_HOLES` in `layout.ts`) in the shop's own accent colour — a tinted
 * pit reads as "this belongs to that shop" far better than a plain grey one.
 *
 * Inset a few centimetres from the hole's edges so this patch never shares a
 * boundary edge with the slab's own punched rim — coincident faces at the same
 * depth are exactly the recipe for z-fighting.
 */
function buildForecourtFloorPatch(unit: ShopUnitDefinition): Mesh {
  const region = shopForecourtRegion(unit);
  const inset = 0.05;
  const width = region.maxX - region.minX - inset * 2;
  const depth = region.maxZ - region.minZ - inset * 2;
  const mesh = new Mesh(
    new BoxGeometry(Math.max(0.1, width), 0.08, Math.max(0.1, depth)),
    interiorMaterial(unit.accent, 0.55),
  );
  mesh.position.set(
    (region.minX + region.maxX) / 2,
    -SHOP_RECESS_DEPTH - 0.04,
    (region.minZ + region.maxZ) / 2,
  );
  mesh.receiveShadow = true;
  mesh.name = `shop-forecourt-floor:${unit.id}`;
  return mesh;
}
