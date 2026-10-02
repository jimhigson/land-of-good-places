import { BoxGeometry, Group, Mesh } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { createKeeper, type KeeperHandle } from '../../art/models/keeper';
import { createNoodleMeter, createReptileStallDressing } from '../../art/models/reptileStallAssets';
import { solid } from '../../art/style/materials';
import { interiorMaterial } from '../building/parts';
import {
  BACK_PANEL_HEIGHT,
  BACK_PANEL_THICKNESS,
  BACK_PANEL_Z,
  COUNTER_DEPTH,
  COUNTER_HALF_WIDTH,
  COUNTER_TOP_Y,
  COUNTER_Z,
  SHELF_HALF_WIDTH,
  SHELF_Z,
} from '../building/shops/stallShape';
import { itemsForShop } from '../building/shops/catalogue';
import type { ShopStand } from '../building/shops/Shops';
import { highlightObject } from '../highlight';
import { pressZone, type InteractZone } from '../interact';
import type { HallContext } from './context';
import {
  EXHIBIT_PLACEMENTS,
  METER_FACING,
  METER_POSITION,
  METER_STAND,
  REPTILE_BABY_SNAKE_UNIT,
  REPTILE_HOUSE_ORIGIN_X,
  REPTILE_HOUSE_ORIGIN_Z,
  STALL_FACING,
  STALL_POSITION,
  STALL_STAND,
  type LocalPoint,
} from './layout';

/**
 * **Scales & Tails, and the Noodle-o-meter.**
 *
 * The stall is the market's own counter — the same `COUNTER_*` lines
 * `kiosk.ts` builds to, read from `stallShape.ts` rather than copied — with
 * the `stall` kit's snake-scalloped awning dropped onto it, a keeper in a
 * green apron behind it and its stock stood on the counter top. Its chip is
 * what it sells, as every market stall's is, and pressing it opens the
 * ordinary purchase panel through `InteriorControls.openShop`: the shop is a
 * `ShopStand` like the castle's seven, found by `World.shopStands()`.
 *
 * The nursery's adoption stand is the second {@link ShopStand} here: no
 * counter of its own, just the Nursery's "Adopt a snake!" chip opening the
 * panel on the three pets.
 *
 * Colliders: the counter is one thick wall and the back panel another, the
 * two overlapping at the ends so the keeper's pocket between them is sealed —
 * `check:reptile-house` proves nobody can get in.
 */
export const REPTILE_STALL_SHOP = 'reptileStall';
export const REPTILE_NURSERY_SHOP = 'reptileNursery';

export class ReptileStall {
  readonly stands: readonly ShopStand[];
  private readonly ctx: HallContext;
  private readonly keeper: KeeperHandle;
  private readonly stallGroup: Group;
  private readonly meterGroup: Group;
  private readonly stock: { update?(dt: number, elapsed: number): void }[] = [];

  constructor(ctx: HallContext) {
    this.ctx = ctx;
    const stallYaw = (STALL_FACING * Math.PI) / 180;
    const group = new Group();
    group.name = 'reptile-stall';
    group.position.set(STALL_POSITION.x, 0, STALL_POSITION.z);
    group.rotation.y = stallYaw;
    ctx.root.add(group);
    this.stallGroup = group;

    // The counter and back panel, to `kiosk.ts`'s own dimensions.
    const accent = interiorMaterial(ART.snakeMint, 0.66);
    const cream = interiorMaterial(PALETTE.buildingWall, 0.7);
    const counter = solid(new Mesh(new BoxGeometry(COUNTER_HALF_WIDTH * 2, 0.95, COUNTER_DEPTH), accent));
    counter.position.set(0, 0.475, COUNTER_Z);
    group.add(counter);
    const top = solid(new Mesh(new BoxGeometry(COUNTER_HALF_WIDTH * 2 + 0.24, 0.12, COUNTER_DEPTH + 0.16), cream));
    top.position.set(0, 0.98, COUNTER_Z);
    group.add(top);
    const back = solid(new Mesh(new BoxGeometry(COUNTER_HALF_WIDTH * 2, BACK_PANEL_HEIGHT, BACK_PANEL_THICKNESS), cream));
    back.position.set(0, BACK_PANEL_HEIGHT / 2, BACK_PANEL_Z);
    group.add(back);
    const shelf = solid(new Mesh(new BoxGeometry(SHELF_HALF_WIDTH * 2, 0.09, 0.44), interiorMaterial(PALETTE.wood, 0.72)));
    shelf.position.set(0, 0.72, SHELF_Z);
    group.add(shelf);

    const dressing = createReptileStallDressing();
    group.add(dressing.root);
    ctx.atlas.applyTo(dressing.sign);

    this.keeper = createKeeper({ colour: PALETTE.leafMid });
    this.keeper.root.position.set(-0.9, 0.1, 0.45);
    group.add(this.keeper.root);

    // The stock, on the counter and the shelf, from the catalogue's own models.
    const items = itemsForShop(REPTILE_STALL_SHOP);
    items.forEach((item, index) => {
      const model = item.model();
      const onCounter = index < 3;
      model.root.position.set(-1.1 + index * 0.75, onCounter ? COUNTER_TOP_Y + 0.02 : 0.77, onCounter ? COUNTER_Z : SHELF_Z);
      model.root.scale.setScalar(0.5);
      model.root.rotation.y = 0.2 * index;
      group.add(model.root);
      if (model.update) this.stock.push({ update: model.update.bind(model) });
    });

    // Colliders: the counter one thick wall, the back panel another, in the hall's frame.
    const local = (x: number, z: number): LocalPoint => ({
      x: STALL_POSITION.x + Math.cos(stallYaw) * x + Math.sin(stallYaw) * z,
      z: STALL_POSITION.z - Math.sin(stallYaw) * x + Math.cos(stallYaw) * z,
    });
    ctx.props.wall('the stall counter', local(-COUNTER_HALF_WIDTH, COUNTER_Z), local(COUNTER_HALF_WIDTH, COUNTER_Z), COUNTER_DEPTH / 2 + 0.05, 'wall');
    ctx.props.wall('the stall back panel', local(-COUNTER_HALF_WIDTH, BACK_PANEL_Z), local(COUNTER_HALF_WIDTH, BACK_PANEL_Z), 0.3, 'wall');

    // The Noodle-o-meter.
    const meter = createNoodleMeter();
    const meterGroup = new Group();
    meterGroup.name = 'noodle-o-meter';
    meterGroup.position.set(METER_POSITION.x, 0, METER_POSITION.z);
    meterGroup.rotation.y = (METER_FACING * Math.PI) / 180;
    meterGroup.add(meter.root);
    ctx.root.add(meterGroup);
    this.meterGroup = meterGroup;
    ctx.atlas.applyTo(meter.board);
    ctx.props.disc('the Noodle-o-meter', METER_POSITION.x, METER_POSITION.z, meter.baseRadius, 'wall');

    const nursery = EXHIBIT_PLACEMENTS.find((exhibit) => exhibit.id === 'nursery');
    if (!nursery) throw new Error('Reptile House: no nursery placement for the adoption stand');
    this.stands = [
      {
        id: REPTILE_STALL_SHOP,
        title: 'Scales & Tails',
        glyph: '🐍',
        greeting: 'Hisss! Something snakey for you?',
        accent: ART.snakeMint,
        deck: 0,
        x: REPTILE_HOUSE_ORIGIN_X + STALL_STAND.x,
        z: REPTILE_HOUSE_ORIGIN_Z + STALL_STAND.z,
        y: 0,
      },
      {
        id: REPTILE_NURSERY_SHOP,
        title: 'The Nursery',
        glyph: '🐍',
        greeting: 'Who wants to come home with you?',
        accent: ART.snakeCoral,
        deck: 0,
        x: REPTILE_HOUSE_ORIGIN_X + nursery.stand.x,
        z: REPTILE_HOUSE_ORIGIN_Z + nursery.stand.z,
        y: 0,
      },
    ];
  }

  zones(): InteractZone[] {
    const counterX = REPTILE_HOUSE_ORIGIN_X + STALL_POSITION.x;
    const counterZ = REPTILE_HOUSE_ORIGIN_Z + STALL_POSITION.z;
    return [
      pressZone(
        {
          id: 'reptile:stall',
          label: 'Scales & Tails',
          x: counterX,
          y: 1,
          z: counterZ,
          pickRadius: 2.4,
          standX: REPTILE_HOUSE_ORIGIN_X + STALL_STAND.x,
          standZ: REPTILE_HOUSE_ORIGIN_Z + STALL_STAND.z,
          verb: 'Shop',
          highlight: highlightObject(this.stallGroup),
        },
        () => this.ctx.openShop(REPTILE_STALL_SHOP),
        '🛍️',
        'Snake toys',
      ),
      pressZone(
        {
          id: 'reptile:meter',
          label: 'Noodle-o-meter',
          x: REPTILE_HOUSE_ORIGIN_X + METER_POSITION.x,
          y: 1,
          z: REPTILE_HOUSE_ORIGIN_Z + METER_POSITION.z,
          pickRadius: 2,
          standX: REPTILE_HOUSE_ORIGIN_X + METER_STAND.x,
          standZ: REPTILE_HOUSE_ORIGIN_Z + METER_STAND.z,
          verb: 'How tall',
          highlight: highlightObject(this.meterGroup),
        },
        () => {
          const rungs = Math.max(1, Math.round(this.ctx.playerHeight() / REPTILE_BABY_SNAKE_UNIT));
          this.ctx.say(`You are ${rungs} baby snake${rungs === 1 ? '' : 's'} tall!`, METER_POSITION, 3.3);
        },
        '📏',
        'How tall?',
      ),
    ];
  }

  update(dt: number, elapsed: number): void {
    const keeper = this.keeper;
    keeper.body.rotation.z = Math.sin(elapsed * 1.1) * 0.03;
    keeper.head.rotation.y = Math.sin(elapsed * 0.6) * 0.35;
    keeper.setWalkPhase((elapsed * 0.35) % 1, 0.5);
    for (const item of this.stock) item.update?.(dt, elapsed);
  }
}
