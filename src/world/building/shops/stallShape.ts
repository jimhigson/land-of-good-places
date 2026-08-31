import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { PALETTE } from '../../../core/palette';
import { toonMaterial } from '../../../art/style/materials';
import { interiorMaterial } from '../parts';
import { CASTLE_CEILING_CLEAR } from '../castleFabric';
import {
  MARKET_PITCH_X,
  MARKET_STALL,
  SHOP_RECESS_DEPTH,
  SHOP_SCALE_XZ,
  shopHasForecourt,
  shopScaleY,
  type ShopUnitDefinition,
} from '../layout';
import type { AssetHandle } from '../../../art/style/asset';
import { createBiscuit } from '../../../art/models/biscuit';
import { createHat } from '../../../art/models/hats';
import {
  createCandyFloss,
  createIceCream,
  createStarToy,
  createSurpriseEgg,
} from '../../../art/models/shopItems';
import type { ShopId } from './catalogue';

/**
 * # What makes one stall different from the next (#444)
 *
 * Jim, looking at the market: *"the shopping hall now has stalls that are all
 * identical, whereas before they were different — they were better before."*
 *
 * He was right, and the cause is worth writing down because it was a side
 * effect rather than a decision. When the shops stood along walls each one was
 * placed by hand — its own position, its own wall, its own facing, some with a
 * sunken forecourt — and that hand-placement was doing all the work of telling
 * them apart. The market re-lay (#403/#380) replaced seven hand-placed shops
 * with seven cells of one grid, which is a better *layout* and it silently
 * deleted the only thing that made them look unlike each other. What was left
 * was one shell, seven times, differing by an accent colour.
 *
 * This module is the replacement, and it is deliberately **not** a re-run of
 * the old accident. Three rules govern it:
 *
 * 1. **The difference says what the shop sells.** The balloon stall has no
 *    canopy at all — it has a bouquet of giant balloons on a post, so it reads
 *    as balloons from the far end of the aisle. The ice cream stall wears a
 *    striped barrel vault like the roof of a van, the candy floss stall a
 *    fairground parasol, the pet stall a picket rail and bunting. That matters
 *    more than variety for its own sake: a child is not looking for "the
 *    different one", she is looking for ice cream.
 * 2. **It is derived from the shop's identity, never from a seed.** {@link
 *    STALL_STYLES} is a table keyed by `ShopId`, the exact sibling of
 *    `fitouts.ts`'s `BUILDERS`. So "the stripy one is ice cream" is still true
 *    tomorrow, on every machine, forever — which a seeded pick could not
 *    promise.
 * 3. **Silhouette, not detail** (ART_DIRECTION.md §1). Every difference here is
 *    a change to the outline: the shape of the roof, whether there are posts,
 *    what stands on top. None of it is surface decoration, because surface
 *    decoration is invisible at the distance this has to work at.
 *
 * ## The two constraints that shape every number below
 *
 * **Sideways: the aisle.** A stall's floor footprint is `MARKET_STALL` square
 * and `check:shop-spacing` proves the aisle and the queue room against it, so
 * nothing here that a child could walk into may leave {@link FOOTPRINT_HALF}.
 * Canopies may overhang it — she walks *under* an awning, not into it — but
 * only out to {@link CANOPY_HALF}, which is set by the neighbouring stall's
 * canopy rather than by taste.
 *
 * **Upwards: the ceiling.** The mall's clear height is
 * {@link CASTLE_CEILING_CLEAR}, and the old shared awning already reached to
 * within 30 cm of it — which is why the topper hook `ShopUnits` reserved for
 * "a giant themed topper per shop" was never usable. So every canopy here tops
 * out at {@link CANOPY_TOP}, well under the old one, and the headroom that buys
 * is spent on the emblem. **The emblem is then scaled to fill exactly the gap
 * between the canopy it stands on and the ceiling** — see {@link addEmblem} —
 * rather than being given a size that would have to be re-tuned by hand every
 * time a roof moved. One owner: the roof says where its own top is, the ceiling
 * says where the limit is, and the emblem is what fits between them.
 *
 * That last point is CLAUDE.md's "no second mesh positioned by a formula that
 * has to track another surface's shape", applied here: a canopy builder returns
 * its own {@link Canopy.perch} and the posts and the emblem read it. Change a
 * roof's pitch and its finial and its legs follow, because none of them carries
 * a copy of where the roof is.
 */

// --------------------------------------------------------------- the envelope

/**
 * Half a stall's floor footprint, in **unit-local** metres.
 *
 * `MARKET_STALL` is world metres and the stall's group is scaled by
 * `SHOP_SCALE_XZ`, so this divides one by the other rather than writing 1.75
 * down. Nothing standing on the floor may reach past it, because past it is
 * the aisle `check:shop-spacing` measures.
 */
const FOOTPRINT_HALF = MARKET_STALL / 2 / SHOP_SCALE_XZ;

/**
 * How far a canopy may overhang, unit-local.
 *
 * Wider than the footprint on purpose — an awning that stops at the counter's
 * own edge does not read as an awning. The limit is the **neighbour**: stalls
 * stand `MARKET_PITCH_X` apart along a row, so this is that pitch less a gap
 * you can still see daylight through, halved, and taken back out of the stall
 * group's own scale. It comes out at the 2.4 the one shared awning used to be,
 * which is the point — nothing got smaller, it got different — and it now
 * *stays* right if the aisle ever widens.
 */
const CANOPY_GAP = 1.4;
const CANOPY_HALF = (MARKET_PITCH_X - CANOPY_GAP) / 2 / SHOP_SCALE_XZ;

/**
 * The top of every canopy, unit-local.
 *
 * Deliberately **lower** than the 2.99 m the shared awning used to reach. The
 * old height was chosen when a stall's tallest part was its own roof; now the
 * roof carries something, and the something is the part a child reads from
 * across the hall. Handing the last 60 cm of headroom to the emblem instead of
 * to the roof is the single change that makes these seven tell apart.
 */
const CANOPY_TOP = 2.45;

/** How much air is left between the tallest emblem and the slab above. */
const CEILING_MARGIN = 0.2;

/** The counter, unchanged from the shared kiosk — see `kiosk.ts`. */
const COUNTER_Z = 1.15;
const COUNTER_DEPTH = 0.7;
const COUNTER_TOP_Y = 1.02;
const COUNTER_FRONT_Z = COUNTER_Z + COUNTER_DEPTH / 2;

/**
 * Half the counter's width, unit-local — and the **one owner** of that number.
 *
 * `kiosk.ts` builds the box, `ShopUnits.registerCounter` builds the collision
 * segment that has to land on its ends, and the placeholder unit draws a third
 * copy. All three used to write `3.5` and `1.75` out separately, which is this
 * repo's most-repeated bug in miniature. They import this instead.
 */
export const COUNTER_HALF_WIDTH = 1.65;

/**
 * The ceiling, in this stall's own local metres.
 *
 * Not simply `CASTLE_CEILING_CLEAR`: a stall's stage group is scaled on Y by
 * `shopScaleY`, and sunk by `SHOP_RECESS_DEPTH` where it has a forecourt. No
 * stall on the mall has one today (the ground deck can never carry a hole), so
 * this returns 3.3 for all seven — but it returns it by asking, so a stall that
 * ever gains a forecourt does not quietly grow through the slab.
 */
function ceilingLocalY(unit: ShopUnitDefinition): number {
  const recess = shopHasForecourt(unit) ? SHOP_RECESS_DEPTH : 0;
  return (CASTLE_CEILING_CLEAR + recess) / shopScaleY(unit);
}

// ------------------------------------------------------------------ the table

/** The shape of the thing over the counter. One per trade. */
export type CanopyKind =
  /** A pitched cottage roof — the toy shop's little wooden house. */
  | 'gable'
  /** No roof at all: a post and a bouquet of giant balloons. */
  | 'bouquet'
  /** A round fairground parasol on a centre pole. */
  | 'parasol'
  /** A striped barrel vault, like the roof of an ice cream van. */
  | 'barrel'
  /** A flat plank on tall legs — a hatter's shady verandah. */
  | 'plank'
  /** Two poles and a swag of triangular flags. */
  | 'bunting'
  /** A deep header with a sawtooth valance hanging off it. */
  | 'sawtooth';

/** How the front of the counter is dressed — what a child sees at eye height. */
export type SkirtKind = 'planks' | 'scallops' | 'picket' | 'plain';

/** The legs, if any. Derived from the canopy: it says how tall they must be. */
export type PostKind = 'square' | 'round' | 'none';

/** The giant thing on top, and the whole reason the canopies came down. */
export type EmblemKind = 'teddy' | 'floss' | 'cone' | 'crown' | 'star' | 'egg' | 'none';

export interface StallStyle {
  readonly canopy: CanopyKind;
  readonly skirt: SkirtKind;
  readonly post: PostKind;
  readonly emblem: EmblemKind;
  /**
   * The stall's second colour — the stripe, the scallops, the ridge cap.
   *
   * Its accent is already its own (`SHOP_UNITS`); this is what the accent is
   * striped *against*, and it is the difference between "a pink stall" and "the
   * pink-and-cream stripy one".
   */
  readonly trim: number;
}

/**
 * Seven trades, seven silhouettes.
 *
 * Read this table as the answer to "what would this shop's stall look like at a
 * real market?", not as a spread of the options above. Two stalls sharing a
 * canopy kind would have been fine if the trades wanted it; none of them did.
 */
export const STALL_STYLES: Readonly<Record<ShopId, StallStyle>> = {
  // A toy shop is a toy shop: a little house with a bear on the roof. The one
  // stall whose emblem is a character rather than a piece of stock, because
  // "the one with the teddy on top" is how a six-year-old will name it.
  toy: { canopy: 'gable', skirt: 'planks', post: 'square', emblem: 'teddy', trim: PALETTE.blossomWhite },
  // No canopy. The balloons *are* the roof, and they are the only thing in the
  // market visible over the top of every other stall.
  balloon: { canopy: 'bouquet', skirt: 'scallops', post: 'none', emblem: 'none', trim: PALETTE.markerLemon },
  // A parasol, because a floss cart at a fair has one, with its own floss for a
  // finial on the pole that holds it up.
  candyFloss: { canopy: 'parasol', skirt: 'scallops', post: 'none', emblem: 'floss', trim: PALETTE.buildingWall },
  // Mint-and-cream barrel stripes and a cone on the ridge: an ice cream van's
  // roof, which is a shape children already know.
  iceCream: { canopy: 'barrel', skirt: 'planks', post: 'round', emblem: 'cone', trim: PALETTE.blossomWhite },
  // Tall legs and a flat plank, so the hats hang in shade under an open frame —
  // the airiest of the seven, and a giant crown on the corner.
  hat: { canopy: 'plank', skirt: 'plain', post: 'round', emblem: 'crown', trim: PALETTE.woodDark },
  // A picket rail for the pen and party bunting overhead: the stall that reads
  // as animals rather than as a shop.
  stickerPet: { canopy: 'bunting', skirt: 'picket', post: 'square', emblem: 'star', trim: PALETTE.markerSky },
  // A spiky sawtooth valance — the one jagged outline in the market — under a
  // giant spotted egg.
  surpriseEgg: { canopy: 'sawtooth', skirt: 'planks', post: 'square', emblem: 'egg', trim: PALETTE.markerLemon },
};

// -------------------------------------------------------------------- helpers

/**
 * Stall dressing receives shadow but never casts one, exactly as the kiosk it
 * belongs to does — see the note on `shopMesh` in `ShopUnits.ts`.
 */
function fitting(geometry: BufferGeometry, material: Material): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

type Place = (index: number, position: Vector3, scale: Vector3, rotation: Quaternion) => void;

function instanced(
  geometry: BufferGeometry,
  material: Material,
  count: number,
  place: Place,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  for (let index = 0; index < count; index += 1) {
    position.set(0, 0, 0);
    scale.set(1, 1, 1);
    rotation.identity();
    place(index, position, scale, rotation);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** The same, with a colour per instance — for the balloons and the bunting. */
function colouredInstances(
  geometry: BufferGeometry,
  colours: readonly number[],
  place: Place,
): InstancedMesh {
  const mesh = instanced(geometry, toonMaterial(0xffffff), colours.length, place);
  const colour = new Color();
  colours.forEach((hex, index) => mesh.setColorAt(index, colour.setHex(hex)));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// -------------------------------------------------------------------- canopies

interface Canopy {
  readonly group: Group;
  /**
   * The canopy's own highest surface: where the emblem stands, and nothing
   * else's business to work out. A finial positioned by a constant is a second
   * definition of the roofline, and it goes stale the first time the roof does.
   */
  readonly perch: Vector3;
  /**
   * How high the legs have to reach to meet this canopy — `null` where the
   * canopy carries its own support (a parasol's pole, a bouquet's post) and
   * corner posts would only clutter the outline.
   */
  readonly eaveY: number | null;
}

/** A pitched cottage roof: two slabs meeting at a ridge, with a cream cap. */
function gableCanopy(accent: Material, trim: Material): Canopy {
  const group = new Group();
  const ridgeY = 2.3;
  const ridgeZ = 0.5;
  const eaveY = 1.98;
  const overhang = 1.14;

  const slabRun = Math.hypot(overhang, ridgeY - eaveY);
  const pitch = Math.atan2(ridgeY - eaveY, overhang);
  for (const side of [1, -1]) {
    const slab = fitting(new BoxGeometry(CANOPY_HALF * 2, 0.12, slabRun), accent);
    slab.position.set(0, (ridgeY + eaveY) / 2, ridgeZ + (side * overhang) / 2);
    slab.rotation.x = side * pitch;
    group.add(slab);
  }

  const cap = fitting(new BoxGeometry(CANOPY_HALF * 2 + 0.1, 0.15, 0.26), trim);
  cap.position.set(0, ridgeY + 0.06, ridgeZ);
  group.add(cap);

  return { group, perch: new Vector3(0.62, ridgeY + 0.135, ridgeZ), eaveY };
}

/**
 * No canopy: a slim post off to one side, and seven big balloons tied to it.
 *
 * The one stall you can see over the top of every other one, which is exactly
 * what a balloon seller wants and what "the difference should say what the shop
 * sells" means in practice.
 */
function bouquetCanopy(accent: Material, ceiling: number): Canopy {
  const group = new Group();
  const postX = 1.32;
  const postZ = 0.3;
  const postTop = 2.0;

  const post = fitting(new CylinderGeometry(0.07, 0.08, postTop, 10), accent);
  post.position.set(postX, postTop / 2, postZ);
  group.add(post);

  // Seven balloons on a rough dome above the post, filling the headroom the
  // missing roof frees up. The top of the tallest is the ceiling margin, so the
  // bouquet grows and shrinks with the storey rather than with a typed number.
  const colours = [
    PALETTE.markerPink,
    PALETTE.markerLemon,
    PALETTE.markerMint,
    PALETTE.markerSky,
    PALETTE.markerLilac,
    PALETTE.blossomPink,
    PALETTE.flowerViolet,
  ];
  const radius = 0.28;
  const crown = ceiling - CEILING_MARGIN - radius * 1.15;
  const spot = (index: number): Vector3 => {
    // A fan rather than a ring: from the front of the stall the near balloons
    // must not hide the far ones, so they climb as they go back.
    const angle = (index / colours.length) * Math.PI * 2 + 0.4;
    const spread = index === 0 ? 0 : 0.62;
    return new Vector3(
      postX + Math.cos(angle) * spread,
      crown - (index === 0 ? 0 : 0.34 + Math.sin(angle * 1.7) * 0.16),
      postZ + Math.sin(angle) * spread * 0.55,
    );
  };

  group.add(
    colouredInstances(new SphereGeometry(radius, 14, 10), colours, (index, position, scale) => {
      position.copy(spot(index));
      scale.set(1, 1.15, 1);
    }),
  );

  // A string each, from the post's top to the balloon's own knot: length and
  // lean both come out of the two endpoints, so nothing here is hand-aimed.
  const anchor = new Vector3(postX, postTop, postZ);
  group.add(
    instanced(
      new CylinderGeometry(0.012, 0.012, 1, 5),
      interiorMaterial(PALETTE.blossomWhite, 0.8),
      colours.length,
      (index, position, scale, rotation) => {
        const centre = spot(index);
        const knot = centre.setY(centre.y - radius * 1.15);
        const span = knot.clone().sub(anchor);
        position.copy(anchor).addScaledVector(span, 0.5);
        scale.set(1, span.length(), 1);
        rotation.setFromUnitVectors(new Vector3(0, 1, 0), span.clone().normalize());
      },
    ),
  );

  return { group, perch: new Vector3(postX, postTop, postZ), eaveY: null };
}

/** A round fairground parasol on a centre pole, scalloped round its rim. */
function parasolCanopy(accent: Material, trim: Material): Canopy {
  const group = new Group();
  const poleZ = 0.34;
  const rimY = 2.18;
  const apexY = CANOPY_TOP;
  // Short of `CANOPY_HALF`, and not for the neighbour's sake: a parasol is
  // round, so its rim comes forward as far as it goes sideways, and at the full
  // width it would hang over the very spot a child stands to be served
  // (`SHOP_STAND_Z`). She would walk into it head-first. A gable or a plank can
  // use the whole width because neither reaches that far forward.
  const radius = CANOPY_HALF * 0.85;

  const pole = fitting(new CylinderGeometry(0.075, 0.09, apexY, 10), trim);
  pole.position.set(0, apexY / 2, poleZ);
  group.add(pole);

  const shade = fitting(new ConeGeometry(radius, apexY - rimY, 18), accent);
  shade.position.set(0, (apexY + rimY) / 2, poleZ);
  group.add(shade);

  // The scallops sit on the rim circle the cone actually has, so widening the
  // parasol moves them with it.
  const scallops = 14;
  group.add(
    instanced(
      new SphereGeometry(0.2, 10, 8),
      interiorMaterial(PALETTE.blossomWhite, 0.7),
      scallops,
      (index, position, scale) => {
        const angle = (index / scallops) * Math.PI * 2;
        position.set(Math.cos(angle) * radius, rimY, poleZ + Math.sin(angle) * radius);
        scale.set(1, 0.75, 1);
      },
    ),
  );

  return { group, perch: new Vector3(0, apexY, poleZ), eaveY: null };
}

/**
 * A barrel vault in bold stripes — an ice cream van's roof.
 *
 * Built as slats laid round an arc rather than as a half-cylinder with a
 * striped texture: this is a park of painted wooden toys, and a stripe you can
 * see the thickness of is the chunky version of one (ART_DIRECTION.md §1).
 */
function barrelCanopy(accent: Material, trim: Material): Canopy {
  const group = new Group();
  const slats = 11;
  const radius = 0.56;
  const axisY = CANOPY_TOP - radius - 0.07;
  const axisZ = 0.5;
  // Stops short of the full half-circle at both ends: a vault that reached the
  // counter top would shut the stock in a tunnel from a camera at 38°.
  const from = 0.13 * Math.PI;
  const to = 0.87 * Math.PI;
  const angleAt = (index: number): number => from + ((to - from) * (index + 0.5)) / slats;
  const slatDepth = ((to - from) * radius) / slats + 0.03;

  const slatGeometry = new BoxGeometry(CANOPY_HALF * 2, 0.13, slatDepth);
  // One instanced mesh per stripe colour: every other slat, counted off the
  // same `angleAt` both share, so the two colours cannot drift out of step.
  const stripe = (parity: number, material: Material): InstancedMesh =>
    instanced(
      slatGeometry,
      material,
      Math.ceil((slats - parity) / 2),
      (index, position, _scale, rotation) => {
        const angle = angleAt(index * 2 + parity);
        position.set(0, axisY + Math.sin(angle) * radius, axisZ + Math.cos(angle) * radius);
        rotation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2 - angle);
      },
    );
  group.add(stripe(0, accent));
  group.add(stripe(1, trim));

  return { group, perch: new Vector3(-0.78, axisY + radius + 0.065, axisZ), eaveY: axisY - radius * 0.4 };
}

/** A flat plank on tall legs: the open, airy one. */
function plankCanopy(accent: Material, trim: Material): Canopy {
  const group = new Group();
  const eaveY = CANOPY_TOP - 0.16;

  const board = fitting(new BoxGeometry(CANOPY_HALF * 2, 0.16, 2.5), accent);
  board.position.set(0, eaveY + 0.08, 0.5);
  group.add(board);

  // A lip along the front edge only, so the flat roof has an edge to catch the
  // light instead of reading as a floating slab.
  const lip = fitting(new BoxGeometry(CANOPY_HALF * 2, 0.2, 0.14), trim);
  lip.position.set(0, eaveY + 0.02, 1.72);
  group.add(lip);

  return { group, perch: new Vector3(1.1, eaveY + 0.16, 0.5), eaveY };
}

/** Two poles and a swag of triangular flags. */
function buntingCanopy(accent: Material, trimColour: number): Canopy {
  const group = new Group();
  const poleX = FOOTPRINT_HALF - 0.14;
  const poleZ = 0.55;
  const poleTop = CANOPY_TOP;

  group.add(
    instanced(new BoxGeometry(0.14, poleTop, 0.14), accent, 2, (index, position) => {
      position.set(index === 0 ? -poleX : poleX, poleTop / 2, poleZ);
    }),
  );

  // The swag: one parabola, and both the cord and the flags read it. Two curves
  // that had to agree would be the exact bug CLAUDE.md keeps a section about.
  const sag = 0.34;
  const flags = 9;
  const at = (t: number): Vector3 =>
    new Vector3(-poleX + t * poleX * 2, poleTop - 0.06 - sag * 4 * t * (1 - t), poleZ);

  group.add(
    instanced(
      new BoxGeometry(0.05, 1, 0.05),
      interiorMaterial(PALETTE.woodDark, 0.75),
      flags + 1,
      (index, position, scale, rotation) => {
        const a = at(index / (flags + 1));
        const b = at((index + 1) / (flags + 1));
        const span = b.clone().sub(a);
        position.copy(a).addScaledVector(span, 0.5);
        scale.set(1, span.length(), 1);
        rotation.setFromUnitVectors(new Vector3(0, 1, 0), span.clone().normalize());
      },
    ),
  );

  // Flags hang point-down off the same curve, alternating the stall's accent
  // with its trim so the swag reads as party bunting rather than as a fringe.
  const flagColours = Array.from({ length: flags }, (_, index) =>
    index % 2 === 0 ? PALETTE.markerLemon : trimColour,
  );
  group.add(
    colouredInstances(
      new ConeGeometry(0.19, 0.44, 3),
      flagColours,
      (index, position, _scale, rotation) => {
        const point = at((index + 0.5) / flags);
        position.set(point.x, point.y - 0.24, point.z);
        rotation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
      },
    ),
  );

  return { group, perch: new Vector3(-poleX, poleTop, poleZ), eaveY: null };
}

/** A deep header with a spiky sawtooth valance: the one jagged outline. */
function sawtoothCanopy(accent: Material, trim: Material): Canopy {
  const group = new Group();
  const headerY = CANOPY_TOP - 0.12;
  const headerZ = 0.62;

  const header = fitting(new BoxGeometry(CANOPY_HALF * 2, 0.24, 1.5), accent);
  header.position.set(0, headerY, headerZ);
  group.add(header);

  // Teeth hanging off the header's own front lip. Their number comes from its
  // width, so a wider header grows more teeth rather than stretching nine.
  const toothWidth = 0.42;
  const teeth = Math.round((CANOPY_HALF * 2) / toothWidth);
  group.add(
    instanced(
      new BoxGeometry(toothWidth * 0.72, toothWidth * 0.72, 0.14),
      trim,
      teeth,
      (index, position, _scale, rotation) => {
        position.set(
          -CANOPY_HALF + toothWidth * (index + 0.5),
          headerY - 0.12,
          headerZ + 0.75,
        );
        rotation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
      },
    ),
  );

  return { group, perch: new Vector3(0, headerY + 0.12, headerZ), eaveY: headerY - 0.12 };
}

function buildCanopy(style: StallStyle, accent: Material, trim: Material, ceiling: number): Canopy {
  switch (style.canopy) {
    case 'gable':
      return gableCanopy(accent, trim);
    case 'bouquet':
      return bouquetCanopy(accent, ceiling);
    case 'parasol':
      return parasolCanopy(accent, trim);
    case 'barrel':
      return barrelCanopy(accent, trim);
    case 'plank':
      return plankCanopy(accent, trim);
    case 'bunting':
      return buntingCanopy(accent, style.trim);
    case 'sawtooth':
      return sawtoothCanopy(accent, trim);
  }
}

// ----------------------------------------------------------------------- legs

/**
 * Four corner posts, as tall as the canopy says they need to be.
 *
 * Inside {@link FOOTPRINT_HALF} in both axes: a post is a thing a child can
 * walk into, so unlike the canopy it may not overhang the aisle.
 */
function buildPosts(style: StallStyle, canopy: Canopy, material: Material): Mesh | InstancedMesh | null {
  if (style.post === 'none' || canopy.eaveY === null) return null;
  const height = canopy.eaveY;
  const x = FOOTPRINT_HALF - 0.13;
  const z = [COUNTER_FRONT_Z - 0.16, -0.35];
  const geometry =
    style.post === 'square'
      ? new BoxGeometry(0.17, height, 0.17)
      : new CylinderGeometry(0.085, 0.095, height, 10);
  return instanced(geometry, material, 4, (index, position) => {
    position.set(index % 2 === 0 ? -x : x, height / 2, z[index < 2 ? 0 : 1] ?? 0);
  });
}

// --------------------------------------------------------------------- skirts

/**
 * The counter's front face, which is the part of a stall a six-year-old is
 * actually eye-to-eye with. Everything here is flush against that face and
 * inside the footprint.
 */
function buildSkirt(style: StallStyle, accent: Material, trim: Material): Group {
  const group = new Group();
  const faceZ = COUNTER_FRONT_Z + 0.04;

  if (style.skirt === 'planks') {
    // Alternating vertical planks: two instanced meshes, one per colour.
    const count = 11;
    const width = (COUNTER_HALF_WIDTH * 2) / count;
    const geometry = new BoxGeometry(width * 0.8, 0.82, 0.07);
    const stripe = (parity: number, material: Material): InstancedMesh =>
      instanced(geometry, material, Math.ceil((count - parity) / 2), (index, position) => {
        position.set(-COUNTER_HALF_WIDTH + width * (index * 2 + parity + 0.5), 0.47, faceZ);
      });
    group.add(stripe(0, trim));
    group.add(stripe(1, accent));
    return group;
  }

  if (style.skirt === 'scallops') {
    const count = 9;
    const width = (COUNTER_HALF_WIDTH * 2) / count;
    group.add(
      instanced(
        new SphereGeometry(width * 0.52, 10, 8),
        trim,
        count,
        (index, position, scale) => {
          position.set(-COUNTER_HALF_WIDTH + width * (index + 0.5), 0.16, faceZ - 0.02);
          scale.set(1, 1, 0.4);
        },
      ),
    );
    return group;
  }

  if (style.skirt === 'picket') {
    // A low pen rail standing proud of the counter top, plus its pales below.
    const count = 13;
    const width = (COUNTER_HALF_WIDTH * 2) / count;
    group.add(
      instanced(new BoxGeometry(width * 0.42, 0.2, 0.07), trim, count, (index, position) => {
        position.set(-COUNTER_HALF_WIDTH + width * (index + 0.5), COUNTER_TOP_Y + 0.14, faceZ - 0.02);
      }),
    );
    const rail = fitting(new BoxGeometry(COUNTER_HALF_WIDTH * 2, 0.07, 0.1), trim);
    rail.position.set(0, COUNTER_TOP_Y + 0.22, faceZ - 0.02);
    group.add(rail);
    return group;
  }

  return group;
}

// -------------------------------------------------------------------- emblems

/**
 * The giant thing on top — built from the shop's **own stock**, not from a
 * lookalike.
 *
 * Every one of these is the same factory `fitouts.ts` puts on the counter, so
 * the sign over the ice cream stall cannot end up being a different ice cream
 * from the ones in the tubs: there is one model and it is used twice. The
 * scale is not authored either — an `AssetHandle` knows its own `height`, and
 * the emblem is sized to stand from its canopy's perch to just under the
 * ceiling, so it fills whatever headroom that particular roof leaves.
 */
function emblemAsset(kind: EmblemKind): AssetHandle | null {
  switch (kind) {
    case 'teddy':
      return createBiscuit();
    case 'floss':
      return createCandyFloss('pink');
    case 'cone':
      return createIceCream([PALETTE.markerPink, PALETTE.flowerYellow, PALETTE.markerSky]);
    case 'crown':
      return createHat('crown');
    case 'star':
      return createStarToy(PALETTE.markerLemon);
    case 'egg':
      return createSurpriseEgg(PALETTE.stonePinkLight, PALETTE.markerLilac);
    case 'none':
      return null;
  }
}

/** How far each emblem is turned off square. Nothing is plumb (§4). */
const EMBLEM_YAW: Readonly<Record<EmblemKind, number>> = {
  teddy: 0.34,
  floss: -0.2,
  cone: 0.25,
  crown: 0.4,
  star: -0.3,
  egg: 0.18,
  none: 0,
};

function addEmblem(style: StallStyle, canopy: Canopy, ceiling: number, into: Group): void {
  const asset = emblemAsset(style.emblem);
  if (!asset) return;
  const headroom = ceiling - CEILING_MARGIN - canopy.perch.y;
  if (headroom <= 0) return;
  asset.root.scale.setScalar(headroom / asset.height);
  asset.root.position.copy(canopy.perch);
  asset.root.rotation.y = EMBLEM_YAW[style.emblem];
  asset.root.name = `stall-emblem:${style.emblem}`;
  into.add(asset.root);
}

// ------------------------------------------------------------------- assembly

/**
 * Everything about a stall that is not the counter and the shelves: its skirt,
 * its legs, its canopy and its emblem.
 *
 * `kiosk.ts` owns what all seven share; this owns what makes each one itself.
 * Splitting it that way is what stops the family resemblance being an accident:
 * the counter, its pale top plank and the shelving behind are built once for
 * everybody, so seven very different roofs still sit on one recognisable shop.
 */
export function buildStallDress(unit: ShopUnitDefinition): Group {
  const style = STALL_STYLES[unit.id as ShopId] ?? STALL_STYLES.toy;
  const group = new Group();
  group.name = `stall-dress:${unit.id}`;

  const accent = interiorMaterial(unit.accent, 0.66);
  const trim = interiorMaterial(style.trim, 0.68);
  const ceiling = ceilingLocalY(unit);

  group.add(buildSkirt(style, accent, trim));

  const canopy = buildCanopy(style, accent, trim, ceiling);
  group.add(canopy.group);

  const posts = buildPosts(style, canopy, interiorMaterial(PALETTE.woodDark, 0.74));
  if (posts) group.add(posts);

  addEmblem(style, canopy, ceiling, group);

  return group;
}
