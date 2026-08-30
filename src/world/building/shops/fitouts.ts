import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { PALETTE } from '../../../core/palette';
import { TAU } from '../../../core/mathUtils';
import { interiorMaterial } from '../parts';
import { toonMaterial } from '../../../art/style/materials';
import { createRipika } from '../../../art/models/ripika';
import { createBiscuit } from '../../../art/models/biscuit';
import { createBalloon, type BalloonHandle } from '../../../art/models/balloons';
import { createHat, hatDisplayScale, HAT_KINDS, HAT_STAND_SPACING } from '../../../art/models/hats';
import { createJetpack } from '../../../art/models/jetpack';
import { createPet, type PetHandle } from '../../../art/models/pets';
import {
  createCandyFloss,
  createIceCream,
  createStarToy,
  createStickerSheet,
  createSurpriseEgg,
} from '../../../art/models/shopItems';
import { COUNTER_TOP_Y, SHELF_Z } from './kiosk';
import { petKindsForShop, type ShopId } from './catalogue';

/**
 * What each of the seven shops actually *sells*, standing on its shelves.
 *
 * Everything in here is the shop's **detail** group, which is shown only while
 * the player is on that shop's deck (see `Shops.setVisibleDeck`). That is what
 * pays for a fully-modelled RiPika on the toy-shop shelf: from the garden you
 * are looking at the outside of a building, and none of this is rendered.
 *
 * Unit-local space throughout: +Z into the room, y = 0 on the deck, the counter
 * front at z ≈ 1.15 and the shelves at z ≈ −0.05.
 */

export interface Fitout {
  readonly detail: Group;
  readonly update: (dt: number, elapsed: number) => void;
  /** Only the candy floss stand has one — the rare rainbow floss. */
  readonly setRainbowVisible: ((visible: boolean) => void) | null;
}

const NO_UPDATE = (): void => {};

/**
 * Top of the shelf board. There is one, and nothing on it may be taller than
 * about 0.55 m — see the note on `SHELF_Y` in `kiosk.ts` for why.
 *
 * The counter top (`COUNTER_TOP_Y`) is the other place to stand things, and the
 * better one: it is in front of the name board rather than behind it, so
 * anything there is never occluded however tall it is.
 */
const SHELF_TOP = 0.765;
/** Front lip of the counter — for things that need to be in front of everything. */
const COUNTER_FRONT_Z = 1.45;

function place(object: Object3D, x: number, y: number, z: number, scale = 1, yaw = 0): Object3D {
  object.position.set(x, y, z);
  object.scale.setScalar(scale);
  object.rotation.y = yaw;
  return object;
}

/** A plain instanced-mesh helper: same geometry, per-instance colour. */
function colouredInstances(
  geometry: SphereGeometry | CylinderGeometry,
  colours: readonly number[],
  place3: (index: number, position: Vector3, scale: Vector3, rotation: Quaternion) => void,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, toonMaterial(0xffffff), colours.length);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  const colour = new Color();
  colours.forEach((hex, index) => {
    rotation.identity();
    scale.set(1, 1, 1);
    position.set(0, 0, 0);
    place3(index, position, scale, rotation);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, colour.setHex(hex));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function fitting(geometry: SphereGeometry | CylinderGeometry | TorusGeometry, colour: number): Mesh {
  const mesh = new Mesh(geometry, interiorMaterial(colour, 0.7));
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

// --------------------------------------------------------------------- toys

function toyShop(): Fitout {
  const detail = new Group();

  // The two named toys from the design document, at toy size on the shelf.
  const ripika = createRipika();
  detail.add(place(ripika.root, -0.6, SHELF_TOP, SHELF_Z, 0.4, 0.35));

  const biscuit = createBiscuit();
  detail.add(place(biscuit.root, 0.95, SHELF_TOP, SHELF_Z, 0.4, -0.4));

  // On the counter, where nothing can hide it: the impulse buy.
  const star = createStarToy(PALETTE.flowerYellow);
  detail.add(place(star.root, 1.25, COUNTER_TOP_Y, 1.1, 0.7, 0.2));

  // The jet pack, on the counter front and turned three-quarters on, so a child
  // walking up sees the tanks and the nozzles rather than a flat back plate.
  // Its origin is the point that straps to a back (`art/models/jetpack.ts`), so
  // it is lifted by its own `height` to stand the nozzles on the counter rather
  // than sinking half of it through the wood.
  const jetpack = createJetpack();
  detail.add(place(jetpack.root, -1.25, COUNTER_TOP_Y + jetpack.height, 1.1, 1, 0.7));
  // Firing gently on the stand: it is the one thing in the shop that *does*
  // something, and a rocket with no flame is a rucksack.
  jetpack.setThrust(0.55);

  return {
    detail,
    // Toys on a shelf breathe very slightly, which is the difference between a
    // toy shop and a display of ornaments.
    update: (dt, elapsed) => {
      ripika.body.rotation.z = Math.sin(elapsed * 1.1) * 0.05;
      biscuit.body.rotation.z = Math.sin(elapsed * 0.9 + 1) * 0.05;
      star.root.rotation.y = 0.2 + Math.sin(elapsed * 0.7) * 0.25;
      jetpack.root.rotation.y = 0.7 + Math.sin(elapsed * 0.5) * 0.3;
      jetpack.update?.(dt, elapsed);
    },
    setRainbowVisible: null,
  };
}

// ----------------------------------------------------------------- balloons

function balloonShop(): Fitout {
  const detail = new Group();

  // Their origin is the bottom of the string — the hand-hold point — so they
  // are tied to the counter top exactly where a hand would be.
  const balloons: BalloonHandle[] = [
    createBalloon('dalmatian'),
    createBalloon('corgi'),
    createBalloon('chicken'),
  ];
  // Tied to the *front* lip of the counter, not the back of it: a balloon on a
  // 95 cm string floats up to head height, and behind the counter that is
  // exactly where the shop's own name board is.
  balloons.forEach((balloon, index) => {
    detail.add(
      place(balloon.root, -0.7 + index * 0.7, COUNTER_TOP_Y + 0.06, COUNTER_FRONT_Z, 1, (index - 1) * 0.4),
    );
  });

  // The weight that stops three balloons walking off with the counter.
  const weight = fitting(new CylinderGeometry(0.18, 0.22, 0.14, 14), PALETTE.markerSky);
  weight.position.set(0, COUNTER_TOP_Y + 0.07, COUNTER_FRONT_Z);
  detail.add(weight);

  return {
    detail,
    update: (dt, elapsed) => {
      for (const balloon of balloons) balloon.update?.(dt, elapsed);
    },
    setRainbowVisible: null,
  };
}

// -------------------------------------------------------------- candy floss

function candyFlossShop(): Fitout {
  const detail = new Group();

  // The machine: a drum with a spinning head in the middle of a wide bowl.
  const bowl = fitting(new CylinderGeometry(0.42, 0.34, 0.22, 20), PALETTE.buildingWall);
  bowl.position.set(-0.9, COUNTER_TOP_Y + 0.11, 0.95);
  detail.add(bowl);

  const rim = fitting(new TorusGeometry(0.42, 0.045, 8, 22), PALETTE.blossomPink);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(-0.9, COUNTER_TOP_Y + 0.22, 0.95);
  detail.add(rim);

  const spinner = fitting(new CylinderGeometry(0.13, 0.13, 0.2, 12), PALETTE.markerPink);
  spinner.position.set(-0.9, COUNTER_TOP_Y + 0.24, 0.95);
  detail.add(spinner);

  const fluff = new Mesh(
    new SphereGeometry(0.2, 16, 12),
    toonMaterial(PALETTE.blossomPink, { transparent: true, opacity: 0.75, depthWrite: false }),
  );
  fluff.castShadow = false;
  fluff.receiveShadow = false;
  fluff.position.set(-0.9, COUNTER_TOP_Y + 0.3, 0.95);
  fluff.scale.set(1, 0.6, 1);
  detail.add(fluff);

  // Made-up flosses standing in a holder, plus the rare rainbow one.
  const pink = createCandyFloss('pink');
  detail.add(place(pink.root, 0.62, COUNTER_TOP_Y, 0.95, 1, 0.2));
  const blue = createCandyFloss('blue');
  detail.add(place(blue.root, 0.95, COUNTER_TOP_Y, 1.05, 1, -0.3));
  const rainbow = createCandyFloss('rainbow');
  detail.add(place(rainbow.root, 1.3, COUNTER_TOP_Y, 0.95, 1, 0.1));
  rainbow.root.visible = false;

  // Shelf stock: three more flosses in a row, so the shop looks stocked.
  const spare = [createCandyFloss('pink'), createCandyFloss('blue'), createCandyFloss('pink')];
  spare.forEach((floss, index) => {
    detail.add(place(floss.root, -0.8 + index * 0.8, SHELF_TOP, SHELF_Z, 0.85, index * 0.4));
  });

  return {
    detail,
    update: (_dt, elapsed) => {
      spinner.rotation.y = elapsed * 3.4;
      fluff.rotation.y = -elapsed * 1.4;
      fluff.scale.set(1 + Math.sin(elapsed * 2.6) * 0.06, 0.6, 1 + Math.cos(elapsed * 2.6) * 0.06);
      // The rainbow one shimmers while it lasts, so a child notices it is there.
      rainbow.root.rotation.y = Math.sin(elapsed * 1.8) * 0.5;
    },
    setRainbowVisible: (visible: boolean) => {
      rainbow.root.visible = visible;
    },
  };
}

// ---------------------------------------------------------------- ice cream

function iceCreamShop(): Fitout {
  const detail = new Group();

  // The freezer: five tubs of colourful scoops sunk into the counter top. Tubs
  // and scoops are one instanced mesh each, with per-instance colour.
  const tubColours = [PALETTE.buildingWall, PALETTE.buildingWall, PALETTE.buildingWall, PALETTE.buildingWall, PALETTE.buildingWall];
  const scoopColours = [
    PALETTE.markerPink,
    PALETTE.flowerYellow,
    PALETTE.markerMint,
    PALETTE.markerSky,
    PALETTE.markerLilac,
  ];
  const tubX = (index: number): number => -1.32 + index * 0.66;

  detail.add(
    colouredInstances(new CylinderGeometry(0.27, 0.24, 0.2, 16), tubColours, (index, position) => {
      position.set(tubX(index), COUNTER_TOP_Y + 0.02, 0.98);
    }),
  );
  detail.add(
    colouredInstances(new SphereGeometry(0.22, 16, 12), scoopColours, (index, position, scale) => {
      position.set(tubX(index), COUNTER_TOP_Y + 0.14, 0.98);
      scale.set(1, 0.66, 1);
    }),
  );

  // The famous triple-decker rainbow cone, on a little plinth at the end.
  const plinth = fitting(new CylinderGeometry(0.16, 0.2, 0.16, 14), PALETTE.markerMint);
  plinth.position.set(1.4, COUNTER_TOP_Y + 0.08, 1.0);
  detail.add(plinth);

  const triple = createIceCream([PALETTE.markerPink, PALETTE.flowerYellow, PALETTE.markerSky]);
  detail.add(place(triple.root, 1.4, COUNTER_TOP_Y + 0.16, 1.0, 1.25));

  // Two single cones on the shelf behind.
  const shelfCones = [
    createIceCream([PALETTE.markerLilac]),
    createIceCream([PALETTE.markerMint]),
  ];
  shelfCones.forEach((cone, index) => {
    detail.add(place(cone.root, -0.8 + index * 1.4, SHELF_TOP, SHELF_Z, 1, index * 0.6));
  });

  return {
    detail,
    update: (_dt, elapsed) => {
      // A slow turn on the plinth, like a cake in a bakery window.
      triple.root.rotation.y = elapsed * 0.6;
    },
    setRainbowVisible: null,
  };
}

// --------------------------------------------------------------------- hats

function hatShop(): Fitout {
  const detail = new Group();

  // Six stands: posts and bases instanced, hats parented on top of each.
  const positions = HAT_KINDS.map((_, index) => {
    const onCounter = index < 3;
    return {
      x: onCounter
        ? -0.1 + index * HAT_STAND_SPACING
        : -1.1 + (index - 3) * HAT_STAND_SPACING,
      y: onCounter ? COUNTER_TOP_Y : SHELF_TOP,
      z: onCounter ? 1.05 : SHELF_Z,
      height: onCounter ? 0.3 : 0.16,
    };
  });

  const posts = colouredInstances(
    new CylinderGeometry(0.035, 0.035, 1, 8),
    positions.map(() => PALETTE.woodDark),
    (index, position, scale) => {
      const slot = positions[index];
      if (!slot) return;
      position.set(slot.x, slot.y + slot.height / 2, slot.z);
      scale.set(1, slot.height, 1);
    },
  );
  detail.add(posts);

  const bases = colouredInstances(
    new CylinderGeometry(0.13, 0.15, 0.05, 12),
    positions.map(() => PALETTE.markerLilac),
    (index, position) => {
      const slot = positions[index];
      if (!slot) return;
      position.set(slot.x, slot.y + 0.025, slot.z);
    },
  );
  detail.add(bases);

  const hats = HAT_KINDS.map((kind, index) => {
    const slot = positions[index];
    const hat = createHat(kind);
    // Shown well under life size — the stands are `HAT_STAND_SPACING` apart and
    // a real sun hat is 2.1 m across, so at life size each brim would saw
    // through its neighbours. `hatDisplayScale` divides out how big the family
    // want hats *worn*, so the shop keeps the size it has always shown however
    // that changes; see `art/models/hats.ts`.
    if (slot) {
      const scale = hatDisplayScale(kind);
      place(hat.root, slot.x, slot.y + slot.height + 0.06, slot.z, scale, index * 0.5);
    }
    detail.add(hat.root);
    return hat;
  });

  return {
    detail,
    update: (_dt, elapsed) => {
      // Each hat turns slowly on its stand, out of step with its neighbours.
      hats.forEach((hat, index) => {
        hat.root.rotation.y = index * 0.5 + Math.sin(elapsed * 0.5 + index) * 0.6;
      });
    },
    setRainbowVisible: null,
  };
}

// ------------------------------------------------------------ stickers/pets

function stickerPetShop(): Fitout {
  const detail = new Group();

  // A rack of sticker sheets on the shelf.
  const rack = fitting(new CylinderGeometry(0.05, 0.05, 0.9, 8), PALETTE.woodDark);
  rack.rotation.z = Math.PI / 2;
  rack.position.set(-0.85, SHELF_TOP + 0.36, SHELF_Z - 0.1);
  detail.add(rack);

  const sheets = [
    createStickerSheet(PALETTE.blossomWhite, PALETTE.flowerYellow),
    createStickerSheet(PALETTE.stonePinkLight, PALETTE.markerPink),
    createStickerSheet(PALETTE.buildingWall, PALETTE.markerSky),
  ];
  sheets.forEach((sheet, index) => {
    detail.add(place(sheet.root, -1.2 + index * 0.36, SHELF_TOP, SHELF_Z, 1, (index - 1) * 0.12));
  });

  // The pen: a low ring of fence posts on the counter with pets inside it.
  const fenceCount = 10;
  const centreX = 0.85;
  const centreZ = 1.0;
  const radiusX = 0.62;
  const radiusZ = 0.4;
  const fence = colouredInstances(
    new CylinderGeometry(0.032, 0.032, 0.24, 6),
    new Array<number>(fenceCount).fill(PALETTE.woodLight),
    (index, position) => {
      const angle = (index / fenceCount) * TAU;
      position.set(centreX + Math.cos(angle) * radiusX, COUNTER_TOP_Y + 0.12, centreZ + Math.sin(angle) * radiusZ);
    },
  );
  detail.add(fence);

  const bedding = fitting(new CylinderGeometry(0.66, 0.62, 0.05, 20), PALETTE.grassLight);
  bedding.scale.set(1, 1, 0.66);
  bedding.position.set(centreX, COUNTER_TOP_Y + 0.02, centreZ);
  detail.add(bedding);

  // **What this shop sells, not what `pets.ts` can build.** Those were the same
  // list until RiPika became a `PetKind` while still being sold as `pet.ripika`
  // in the toy shop — at which point iterating `PET_KINDS` here put a fifth pet
  // in a pen sized for four, advertising stock this counter does not carry.
  const stocked = petKindsForShop('stickerPet');
  const pets: PetHandle[] = stocked.map((kind, index) => {
    const pet = createPet(kind);
    const angle = (index / stocked.length) * TAU + 0.6;
    place(
      pet.root,
      centreX + Math.cos(angle) * 0.26,
      COUNTER_TOP_Y + 0.04,
      centreZ + Math.sin(angle) * 0.16,
      0.62,
      -angle,
    );
    detail.add(pet.root);
    return pet;
  });

  return {
    detail,
    update: (_dt, elapsed) => {
      // Each pet hops on its own beat, and looks about between hops.
      pets.forEach((pet, index) => {
        const beat = elapsed * 0.9 + index * 1.7;
        const hop = Math.max(0, Math.sin(beat * 2)) ** 3;
        pet.setWalkPhase((beat * 0.5) % 1, hop);
        pet.head.rotation.y = Math.sin(beat * 0.7) * 0.5;
      });
    },
    setRainbowVisible: null,
  };
}

// ------------------------------------------------------------ surprise eggs

function surpriseEggShop(): Fitout {
  const detail = new Group();

  // The nest: a shallow basket of woven-looking rings.
  const basket = fitting(new CylinderGeometry(0.62, 0.46, 0.26, 20), PALETTE.wood);
  basket.position.set(0.6, COUNTER_TOP_Y + 0.13, 0.98);
  detail.add(basket);

  const basketRim = fitting(new TorusGeometry(0.62, 0.06, 8, 22), PALETTE.woodLight);
  basketRim.rotation.x = Math.PI / 2;
  basketRim.position.set(0.6, COUNTER_TOP_Y + 0.26, 0.98);
  detail.add(basketRim);

  // Six eggs in the nest as ONE instanced mesh with per-instance colour, and
  // their spots as a second. Six modelled eggs would be thirty draw calls for
  // six copies of the same 13 cm object.
  const shells = [
    PALETTE.stonePinkLight,
    PALETTE.markerLemon,
    PALETTE.markerMint,
    PALETTE.markerSky,
    PALETTE.markerLilac,
    PALETTE.blossomWhite,
  ];
  const eggAt = (index: number, position: Vector3): void => {
    const angle = (index / shells.length) * TAU;
    const ring = index % 2 === 0 ? 0.3 : 0.16;
    position.set(0.6 + Math.cos(angle) * ring, COUNTER_TOP_Y + 0.3, 0.98 + Math.sin(angle) * ring * 0.7);
  };

  const eggs = colouredInstances(new SphereGeometry(0.115, 16, 12), shells, (index, position, scale, rotation) => {
    eggAt(index, position);
    scale.set(1, 1.3, 1);
    rotation.setFromAxisAngle(new Vector3(0, 0, 1), (index % 3) * 0.16 - 0.16);
  });
  detail.add(eggs);

  const spotColours = shells.map(() => PALETTE.markerPink);
  const spots = colouredInstances(new SphereGeometry(0.032, 8, 6), spotColours, (index, position, scale) => {
    eggAt(index, position);
    position.z += 0.1;
    position.y += 0.04;
    scale.set(1, 1, 0.5);
  });
  detail.add(spots);

  // One big display egg on the shelf, with the shop's own spots.
  const display = createSurpriseEgg(PALETTE.stonePinkLight, PALETTE.markerLilac);
  detail.add(place(display.root, -0.9, SHELF_TOP, SHELF_Z, 1.3, 0.3));

  // A prize peeking out of a half-shell, so it is obvious what eggs are for.
  const star = createStarToy(PALETTE.markerLemon);
  detail.add(place(star.root, 0.5, SHELF_TOP, SHELF_Z, 0.6, -0.4));

  return {
    detail,
    update: (_dt, elapsed) => {
      // The display egg wobbles like something inside it is waking up.
      display.root.rotation.z = Math.sin(elapsed * 2.2) * 0.08;
      display.root.rotation.y = 0.3 + Math.sin(elapsed * 0.6) * 0.3;
      star.root.rotation.y = -0.4 + Math.sin(elapsed * 0.8) * 0.4;
    },
    setRainbowVisible: null,
  };
}

const BUILDERS: Readonly<Record<ShopId, () => Fitout>> = {
  toy: toyShop,
  balloon: balloonShop,
  candyFloss: candyFlossShop,
  iceCream: iceCreamShop,
  hat: hatShop,
  stickerPet: stickerPetShop,
  surpriseEgg: surpriseEggShop,
};

/** Builds the stock and displays for one shop. Falls back to an empty group. */
export function buildFitout(shopId: string): Fitout {
  const builder = BUILDERS[shopId as ShopId];
  if (!builder) return { detail: new Group(), update: NO_UPDATE, setRainbowVisible: null };
  return builder();
}
