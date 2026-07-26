import { BoxGeometry, Group, Mesh, type Material } from 'three';
import { cuteSign, interiorMaterial } from './parts';
import { SHOP_UNITS, shopGroupName, worldX, worldZ, type ShopUnitDefinition } from './layout';
import type { CollisionWorld } from '../Collision';

/**
 * The seven empty shop units.
 *
 * Build step 4 fits these out. Each one is an alcove with a counter, a stripy
 * awning and an "opening soon" board, plus an empty `Group` named
 * `shop:<id>` sitting at the unit's front-centre on the deck, facing into the
 * room. Whoever builds the shops adds their fittings to that group and hides
 * the placeholder:
 *
 * ```ts
 * const unit = building.shops.getGroup('toy');
 * unit.add(myToyShop);
 * building.shops.setPlaceholderVisible('toy', false);
 * ```
 */
export class ShopUnits {
  private readonly anchors = new Map<string, Group>();
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
      this.anchors.set(unit.id, anchor);

      const placeholder = buildUnit(unit);
      anchor.add(placeholder);
      this.placeholders.set(unit.id, placeholder);

      registerCounter(unit, collision);
    }
  }

  /** The group to build a real shop into. Origin at the unit's front-centre. */
  getGroup(id: string): Group {
    const group = this.anchors.get(id);
    if (!group) throw new Error(`Unknown shop unit: ${id}`);
    return group;
  }

  /** Hide the empty-unit dressing once a real shop moves in. */
  setPlaceholderVisible(id: string, visible: boolean): void {
    const placeholder = this.placeholders.get(id);
    if (placeholder) placeholder.visible = visible;
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
    new BoxGeometry(3.5, 0.95, 0.7),
    interiorMaterial(unit.accent, 0.66),
  );
  counter.position.set(0, 0.475, 1.15);
  group.add(counter);

  // Shallow, and set high: a deep awning looks lovely from the ground and hides
  // the sign completely from a camera that is looking down at 38°.
  const awning = shopMesh(
    new BoxGeometry(4.8, 0.26, 0.95),
    interiorMaterial(unit.accent, 0.6),
  );
  awning.position.set(0, 2.86, 0.42);
  awning.rotation.x = -0.16;
  group.add(awning);

  const sign = cuteSign({
    title: unit.title,
    subtitle: 'opening soon!',
    glyph: unit.glyph,
    accent: unit.accent,
    width: 2.7,
  });
  sign.position.set(0, 1.9, 0.04);
  // Tipped back a little so it points at the isometric camera rather than the
  // opposite wall.
  sign.rotation.x = -0.24;
  group.add(sign);

  return group;
}

/**
 * The counter is solid; the alcove behind it is not, so you can lean over and
 * peer in. Collision is height-blind, so this holds on every deck at once —
 * which is exactly why no two units are stacked on top of each other.
 */
function registerCounter(unit: ShopUnitDefinition, collision: CollisionWorld): void {
  const cos = Math.cos(unit.yaw);
  const sin = Math.sin(unit.yaw);
  const rotate = (localX: number, localZ: number): [number, number] => [
    localX * cos + localZ * sin,
    -localX * sin + localZ * cos,
  ];

  const [ax, az] = rotate(-1.75, 1.15);
  const [bx, bz] = rotate(1.75, 1.15);
  collision.addWall(
    worldX(unit.x + ax),
    worldZ(unit.z + az),
    worldX(unit.x + bx),
    worldZ(unit.z + bz),
    0.4,
  );
}
