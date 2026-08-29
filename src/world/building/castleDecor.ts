import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INTERIOR_HALF_X, INTERIOR_HALF_Z, PLAYER_RADIUS } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { decal, solid, toonMaterial } from '../../art/style/materials';
import { createPet } from '../../art/models/pets';
import { TALLEST_CHILD_HEIGHT } from '../../art/models/kid';
import {
  castleArmsTexture,
  castleBannerTexture,
  castlePaintingTexture,
  castleRugTexture,
  type CastleDevice,
  type CastlePainting,
} from '../../core/textures';
import { softMaterial } from './parts';
import { BEAM_UNDERSIDE, CASTLE_CEILING_CLEAR } from './castleFabric';
import { CASTLE_HEARTH, castleTorchAnchors, type WallAnchor } from './castleLighting';
import { DECK_ROUNDEL, keepOutsFor } from './dressing';
import {
  deckIsSolid,
  INTERIOR_DOOR_MAX_X,
  INTERIOR_DOOR_MIN_X,
  TOP_DECK,
} from './layout';

/**
 * **The castle's cloth, paint and jokes** (issue #376).
 *
 * Jim, having looked at the merged interior: *"Castle is better but still feels
 * very sparse. There needs to be more interesting stuff in there since it feels
 * like mostly empty rooms right now."*
 *
 * `castleFabric.ts` owns the room's surfaces and `castleLighting.ts` owns its
 * fire. This owns everything else that needs no Blender: banners, a coat of
 * arms, a portcullis, rugs, framed paintings, a mouse hole, a cat, and the
 * corner clutter without which a castle is a lobby.
 *
 * ## The standard the previous engineer set, and it is the right one
 *
 * *Eleri will remember the mouse longer than the throne.* So the ordering here
 * is not "furniture first, jokes if there is time" — the cat, the mouse hole
 * and the portrait hung 4° off level are the **point**, and the banners are
 * there because they fill a third of the frame that nothing else uses.
 *
 * ## Three rules everything in this file obeys
 *
 * 1. **No colliders.** Indoor collision is height-blind: a collider on deck 0
 *    walls off that square metre on all five storeys. Placement is the whole of
 *    the protection, and it is enforced by `check:castle`. *(Issue #377's
 *    space-per-floor split removes this constraint by construction — see
 *    `HANDOFF-castle-interior-376.md` for which of these will want a collider
 *    pass once it lands.)*
 * 2. **Nothing looms.** The ceiling is {@link CASTLE_CEILING_CLEAR} (3.30 m),
 *    {@link BEAM_UNDERSIDE} (3.08 m) within 0.40 m of a wall, and the tallest
 *    child in the game is 2.97 m. There is no headroom to spend.
 * 3. **One list of wall positions**, {@link castleTorchAnchors}, shared with the
 *    torches. Banners are hung on the **midpoints between** consecutive torches
 *    rather than on their own sweep round the perimeter, so a torch and a
 *    banner cannot end up in the same place however the spacing changes.
 */

/** Everything this file adds to one storey, so the check can find it. */
export function castleDecorGroupName(deck: number): string {
  return `castle-decor-${deck}`;
}

export function dressCastle(deck: number, floor: Group): void {
  if (deck >= TOP_DECK) return;

  const group = new Group();
  group.name = castleDecorGroupName(deck);
  const rng = new Rng(0xd3c0 + deck * 977);

  const anchors = castleTorchAnchors(deck);
  const banner = bannerRun(deck, anchors);
  if (banner) group.add(banner);

  group.add(roundelRug(deck));
  group.add(paintings(deck, anchors, rng));

  const clutter = cornerClutter(deck, rng);
  if (clutter) group.add(clutter);

  if (deck === 0) {
    group.add(coatOfArms());
    group.add(portcullis());
    group.add(hearthside());
  }

  const hole = mouseHole(deck, anchors);
  if (hole) group.add(hole);

  floor.add(group);
}

// -------------------------------------------------------------- heraldry

/**
 * Which heraldry a storey flies.
 *
 * **One per storey, not one per banner**, and that is a draw-call decision made
 * on purpose. A distinct texture is a distinct material is a distinct mesh, so
 * three heraldries on a floor is three instanced meshes instead of one. The
 * castle already alternates its wall and floor colours per storey (the family's
 * "layer cake"), so a storey having its own arms is consistent with the world
 * rather than a compromise dressed up as one — and a child sees one storey at a
 * time anyway, because the cutaway hides the rest.
 */
function storeyHeraldry(deck: number): { field: number; device: CastleDevice } {
  const arms: readonly { field: number; device: CastleDevice }[] = [
    { field: PALETTE.markerPink, device: 'dragon' },
    { field: PALETTE.buildingTrimDeep, device: 'star' },
    { field: PALETTE.markerLilac, device: 'heart' },
    { field: PALETTE.markerSky, device: 'dragon' },
  ];
  return arms[deck % arms.length] ?? { field: PALETTE.markerPink, device: 'dragon' };
}

const BANNER_WIDTH = 1.7;
const BANNER_STANDOFF = 0.07;

/**
 * How far a banner's **bottom** hangs above the floor.
 *
 * Head height is not the constraint here — the banner is flat against a wall,
 * so a child cannot walk into it — but a cloth that reaches the skirting hides
 * the coursing the room's masonry story is told in, and at the 38° camera the
 * bottom metre of a wall is the part you see most of. So it stops at chest
 * height, which is also where a real banner's fringe would be.
 *
 * **1.35 m at first, and a rendered frame said no.** At that height and 1.15 m
 * wide the banners read as bunting — small bright flags floating near the top
 * of a big wall rather than heraldry hanging down it. Both numbers grew
 * together, because a banner's *proportion* is most of what identifies it: a
 * short wide one is a flag, a long narrow one is a banner.
 */
const BANNER_BOTTOM = 0.95;
/** Just under the timber, so a banner reads as hung *from* the wall-plate. */
const BANNER_TOP = BEAM_UNDERSIDE - 0.06;

/**
 * The banners, hung between the torches.
 *
 * ## Why the midpoints, and not a second sweep round the wall
 *
 * The obvious implementation is another loop round the perimeter at some other
 * spacing. It is also how a banner ends up growing out of a torch: the two
 * loops agree today and diverge the first time either spacing is tuned, and
 * nothing would say so — it is the bridge pair's failure, which is this repo's
 * most expensive recurring bug.
 *
 * So the banners are **derived from the torch list**: group the anchors by
 * which wall they are on, walk each wall in order, and hang a banner halfway
 * between neighbouring torches, every other gap. A banner is then *defined* as
 * "between two torches" and cannot be anywhere else. Gaps wider than one
 * spacing are skipped, because a wide gap is a door or a shop front — the
 * anchor list already refused those, and the hole it left is not somewhere to
 * hang cloth either.
 */
function bannerRun(deck: number, anchors: readonly WallAnchor[]): InstancedMesh | null {
  const spots = betweenNeighbours(anchors);
  if (spots.length === 0) return null;

  const { field, device } = storeyHeraldry(deck);
  const banners = new InstancedMesh(
    new PlaneGeometry(BANNER_WIDTH, BANNER_TOP - BANNER_BOTTOM),
    toonMaterial(PALETTE.blossomWhite, {
      map: castleBannerTexture(field, device),
      // The banner is cloth on a wall, not a light: it catches the room's
      // shading like everything else. `transparent` is off, so it also writes
      // depth and cannot be seen through by the soot marks behind it.
    }),
    spots.length,
  );
  banners.name = `castle-banner-${deck}`;
  banners.castShadow = false;
  banners.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const unit = new Vector3(1, 1, 1);
  const position = new Vector3();
  spots.forEach((spot, index) => {
    rotation.setFromAxisAngle(axis, spot.yaw);
    position.set(
      spot.x + spot.out.x * BANNER_STANDOFF,
      (BANNER_TOP + BANNER_BOTTOM) / 2,
      spot.z + spot.out.z * BANNER_STANDOFF,
    );
    matrix.compose(position, rotation, unit);
    banners.setMatrixAt(index, matrix);
  });
  banners.instanceMatrix.needsUpdate = true;
  return banners;
}

/**
 * Midpoints between neighbouring anchors on the same wall, every other gap.
 *
 * Neighbours only: a pair whose gap is more than half again the typical one has
 * something between them that the anchor sweep refused — a doorway, a shop —
 * and nothing hangs across that.
 */
function betweenNeighbours(anchors: readonly WallAnchor[]): WallAnchor[] {
  const walls = new Map<number, WallAnchor[]>();
  for (const anchor of anchors) {
    const list = walls.get(anchor.yaw);
    if (list) list.push(anchor);
    else walls.set(anchor.yaw, [anchor]);
  }

  const spots: WallAnchor[] = [];
  for (const list of walls.values()) {
    // Along the wall: whichever of x or z actually varies on this face.
    const along = (a: WallAnchor): number => (a.out.x === 0 ? a.x : a.z);
    const sorted = [...list].sort((a, b) => along(a) - along(b));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const next = sorted[i];
      if (previous && next) gaps.push(Math.abs(along(next) - along(previous)));
    }
    if (gaps.length === 0) continue;
    const typical = Math.min(...gaps);

    let taken = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const next = sorted[i];
      if (!previous || !next) continue;
      if (Math.abs(along(next) - along(previous)) > typical * 1.5) continue;
      taken += 1;
      if (taken % 2 === 0) continue;
      spots.push({
        x: (previous.x + next.x) / 2,
        z: (previous.z + next.z) / 2,
        yaw: previous.yaw,
        out: previous.out,
      });
    }
  }
  return spots;
}

/**
 * The coat of arms over the front door.
 *
 * The first thing a child sees on the way in, and the thing that says whose
 * castle this is. Painted on a shield-shaped alpha texture rather than an
 * extruded shield outline, so the silhouette costs two triangles: a shield read
 * at four metres from a 38° camera is its outline and its charge, and neither
 * of those is geometry.
 *
 * Centred on the doorway by **measuring the doorway**, not by a typed 0 — the
 * opening is `INTERIOR_DOOR_MIN_X…MAX_X` and it has been moved before.
 */
function coatOfArms(): Mesh {
  const { field, device } = storeyHeraldry(0);
  const size = 1.7;
  const arms = new Mesh(
    new PlaneGeometry(size, size),
    toonMaterial(PALETTE.blossomWhite, {
      map: castleArmsTexture(field, device),
      transparent: true,
    }),
  );
  arms.name = 'castle-arms';
  decal(arms);
  arms.renderOrder = 1;
  arms.position.set(
    (INTERIOR_DOOR_MIN_X + INTERIOR_DOOR_MAX_X) / 2,
    // Above a doorway a child walks through, below the timber.
    BEAM_UNDERSIDE - size / 2 - 0.12,
    INTERIOR_HALF_Z - 0.28,
  );
  arms.rotation.y = Math.PI;
  return arms;
}

/**
 * The portcullis over the front door — **its teeth only, and that is the
 * design, not a cut corner.**
 *
 * A portcullis you can lower is a portcullis a child can be crushed by, and a
 * portcullis hanging halfway is a thing 2.97 m of hatted child walks into. What
 * is left is the 33 cm between a tall child's hat and the ceiling, so the
 * grille hangs in exactly that band: the bars and their points show under the
 * lintel, the way a raised portcullis's do, and the rest is understood.
 *
 * It reads correctly for the same reason the wall-plate does — a castle's parts
 * are recognised from the fragment of them this camera can see.
 */
function portcullis(): InstancedMesh {
  // **Both of these numbers were set by `check:castle` going red**, and both
  // failures were real. The grille first hung to 2.84 m at the spike tips —
  // 13 cm into a hatted child — because the shaft was placed in the safe band
  // and the points were then hung *below* it, which is two steps that each look
  // right on their own. And it stood flush with the wall, where the ceiling is
  // BEAM_UNDERSIDE rather than the full 3.30 m, so it reached into the timber.
  //
  // So the whole assembly, points included, lives inside `[bottom, top]`, and
  // it hangs in the door reveal rather than on the wall face — which is also
  // where a real portcullis drops.
  const bottom = TALLEST_CHILD_HEIGHT + 0.05;
  const top = CASTLE_CEILING_CLEAR;
  const span = INTERIOR_DOOR_MAX_X - INTERIOR_DOOR_MIN_X;
  const bars = 9;
  const POINT_HEIGHT = 0.16;

  const shaft = new BoxGeometry(0.09, top - bottom - POINT_HEIGHT, 0.09);
  shaft.translate(0, POINT_HEIGHT / 2, 0);
  const point = new CylinderGeometry(0, 0.075, POINT_HEIGHT, 4);
  point.rotateX(Math.PI);
  point.translate(0, -(top - bottom - POINT_HEIGHT) / 2, 0);
  const geometry = mergeGeometries([shaft, point], false) ?? shaft;

  const grille = new InstancedMesh(geometry, softMaterial(PALETTE.ink, 0.7), bars);
  grille.name = 'castle-portcullis';
  grille.castShadow = false;
  grille.receiveShadow = true;

  const matrix = new Matrix4();
  const identity = new Quaternion();
  const unit = new Vector3(1, 1, 1);
  const position = new Vector3();
  for (let i = 0; i < bars; i += 1) {
    const x = INTERIOR_DOOR_MIN_X + (span * (i + 0.5)) / bars;
    position.set(x, (top + bottom) / 2, INTERIOR_HALF_Z - PORTCULLIS_INSET);
    matrix.compose(position, identity, unit);
    grille.setMatrixAt(i, matrix);
  }
  grille.instanceMatrix.needsUpdate = true;
  return grille;
}

// ------------------------------------------------------------------- floor

/**
 * The big round rug, laid on the roundel that is already there.
 *
 * **It costs no new placement rule at all**, which is why it is on the list
 * above several better-looking ideas: the roundel is a keep-out `dressing.ts`
 * already publishes, so a rug the size of it is guaranteed to be somewhere
 * nothing else stands. Reusing an existing constraint beats adding a correct
 * new one.
 *
 * 4 cm proud of the slab and `decal`: it is paint on the floor, not furniture,
 * and `check:castle` exempts it from the walkable-route assertion **by
 * measuring how tall it is** rather than by knowing what it is called.
 */
function roundelRug(deck: number): Mesh {
  const rug = new Mesh(
    new CircleGeometry(DECK_ROUNDEL.radius * 0.92, 44),
    toonMaterial(PALETTE.blossomWhite, { map: castleRugTexture() }),
  );
  rug.name = `castle-rug-${deck}`;
  decal(rug);
  rug.receiveShadow = true;
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(DECK_ROUNDEL.x, 0.055, DECK_ROUNDEL.z);
  return rug;
}

// ---------------------------------------------------------------- pictures

const PICTURE_WIDTH = 1.25;
const PICTURE_HEIGHT = 1.5;
const FRAME_EDGE = 0.11;

/**
 * Framed paintings on the wall, one of which is **4° off level**.
 *
 * The wonky one is the whole reason this function exists. Hung straight, three
 * pictures are furniture; one of them crooked is a joke a six-year-old gets
 * instantly and an adult notices second. It only works with neighbours to be
 * crooked *against*, so the straight ones are load-bearing too.
 *
 * The tilt is a **roll about the picture's own facing**, applied after the yaw
 * that puts it on its wall — so it tilts in the plane of the wall on all four
 * walls, rather than leaning out of one of them.
 */
function paintings(deck: number, anchors: readonly WallAnchor[], rng: Rng): Group {
  const group = new Group();
  group.name = `castle-paintings-${deck}`;

  // Hung between torches, like the banners, and from the same list — a picture
  // over a torch would be a picture on fire.
  const spots = betweenNeighbours(anchors).filter((_, index) => index % 3 === 1);
  const subjects: readonly CastlePainting[] = ['lady', 'dragon', 'knight'];

  spots.slice(0, 3).forEach((spot, index) => {
    const subject = subjects[index % subjects.length] ?? 'lady';
    const picture = new Group();
    picture.name = `castle-painting-${deck}-${subject}`;

    const frame = new Mesh(
      frameGeometry(),
      softMaterial(index === 1 ? PALETTE.woodDark : PALETTE.liftFrame, 0.7),
    );
    solid(frame);
    frame.castShadow = false;
    picture.add(frame);

    const canvasQuad = new Mesh(
      new PlaneGeometry(PICTURE_WIDTH, PICTURE_HEIGHT),
      toonMaterial(PALETTE.blossomWhite, { map: castlePaintingTexture(subject) }),
    );
    decal(canvasQuad);
    canvasQuad.position.z = 0.035;
    picture.add(canvasQuad);

    picture.position.set(
      spot.x + spot.out.x * 0.06,
      1.02 + PICTURE_HEIGHT / 2,
      spot.z + spot.out.z * 0.06,
    );
    picture.rotation.y = spot.yaw;
    // **The joke is the 4°.** One picture, always the same one, always the
    // same angle: a tilt that changed on reload would read as a rendering
    // fault rather than as somebody having knocked it.
    if (index === 1) picture.rotation.z = (4 * Math.PI) / 180;
    else picture.rotation.z = rng.range(-0.004, 0.004);

    group.add(picture);
  });

  return group;
}

function frameGeometry(): BufferGeometry {
  const w = PICTURE_WIDTH + FRAME_EDGE * 2;
  const h = PICTURE_HEIGHT + FRAME_EDGE * 2;
  const parts: BufferGeometry[] = [];
  for (const [dx, dy, sx, sy] of [
    [0, (h - FRAME_EDGE) / 2, w, FRAME_EDGE],
    [0, -(h - FRAME_EDGE) / 2, w, FRAME_EDGE],
    [-(w - FRAME_EDGE) / 2, 0, FRAME_EDGE, h],
    [(w - FRAME_EDGE) / 2, 0, FRAME_EDGE, h],
  ] as const) {
    const bar = new BoxGeometry(sx, sy, 0.08);
    bar.translate(dx, dy, 0);
    parts.push(bar);
  }
  const backing = new BoxGeometry(PICTURE_WIDTH, PICTURE_HEIGHT, 0.05);
  parts.push(backing);
  const first = parts[0];
  if (!first) throw new Error('castleDecor: the picture frame built nothing.');
  return mergeGeometries(parts, false) ?? first;
}

// --------------------------------------------------------- the mouse hole

/**
 * A mouse hole in the skirting, with a mouse looking out of it.
 *
 * The smallest thing in the room and, on the previous engineer's standard, the
 * one most likely to be remembered. It reuses `pets.ts`'s mouse — a character
 * Eleri already knows from the pet parade — so it costs no asset, no
 * commission and no new file.
 *
 * ## Why the pet is scaled by a wrapper group and not by `root.scale`
 *
 * Every pet is built to a standard {@link createPet} render height of 1.46 m,
 * which is right for a creature walking beside a child and absurd for one
 * living in the skirting. The asset contract reserves `root.scale` for
 * gameplay squash-and-stretch, so it is a **parent group** that carries the
 * scale: the handle's own root is left exactly as the contract says it should
 * be, and `check:assets` — which asserts precisely that — stays true of it.
 */
function mouseHole(deck: number, anchors: readonly WallAnchor[]): Group | null {
  // The mouse lives on the ground floor's quietest wall: the one furthest from
  // the door. Picked from the anchor list so it is always on a real wall.
  const spot = anchors.find((a) => a.out.z === 1 && a.x < -8);
  if (!spot || deck !== 0) return null;

  const group = new Group();
  group.name = `castle-mousehole-${deck}`;
  group.position.set(spot.x, 0, spot.z);
  group.rotation.y = spot.yaw;

  const HOLE_HEIGHT = 0.44;
  const arch = new Mesh(
    // A rounded-top hole: a half-disc over a rectangle, which is one circle
    // and one box rather than a bespoke shape.
    holeGeometry(HOLE_HEIGHT),
    toonMaterial(PALETTE.ink),
  );
  arch.name = 'castle-mousehole-arch';
  decal(arch);
  arch.position.z = 0.02;
  group.add(arch);

  const mouse = createPet('mouse');
  const sizer = new Group();
  sizer.name = 'castle-mousehole-sizer';
  // Two thirds of the hole's height, so it plainly fits in the doorway it is
  // standing in rather than filling it.
  sizer.scale.setScalar((HOLE_HEIGHT * 0.66) / mouse.height);
  sizer.add(mouse.root);
  sizer.position.set(0.02, 0, 0.12);
  // Turned a little out of the hole, which is what makes it read as *peeking*
  // rather than as a mouse parked in a doorway.
  sizer.rotation.y = 0.5;
  group.add(sizer);

  return group;
}

function holeGeometry(height: number): BufferGeometry {
  const width = height * 0.72;
  const box = new BoxGeometry(width, height * 0.6, 0.02);
  box.translate(0, height * 0.3, 0);
  const top = new CylinderGeometry(width / 2, width / 2, 0.02, 14, 1, false, 0, Math.PI);
  top.rotateX(Math.PI / 2);
  top.rotateZ(Math.PI);
  top.translate(0, height * 0.6, 0);
  return mergeGeometries([box, top], false) ?? box;
}

// ------------------------------------------------------------- the hearth

/**
 * What is arranged round the fire: a cat asleep, and the wood to keep it going.
 *
 * The cat is `pets.ts`'s kitten, laid on its side. Same argument as the mouse —
 * a character she already knows, no new asset — and it is placed at
 * {@link CASTLE_HEARTH}, which is the fire's own constant, so it cannot end up
 * asleep in front of a hearth that has moved.
 */
function hearthside(): Group {
  const group = new Group();
  group.name = 'castle-hearthside';

  const cat = createPet('kitten');
  const sizer = new Group();
  sizer.name = 'castle-cat-sizer';
  // A cat curled on a flagstone is about half a metre of cat.
  sizer.scale.setScalar(0.52 / cat.height);
  sizer.add(cat.root);
  // Laid over onto its side. A pet is built standing and there is no sleeping
  // pose in `pets.ts`; tipping it 78° is what a sleeping toy cat looks like,
  // and it is one rotation rather than a new model.
  sizer.rotation.set((78 * Math.PI) / 180, 0.9, 0);
  sizer.position.set(CASTLE_HEARTH.x + 1.9, 0.19, CASTLE_HEARTH.z + 1.5);
  group.add(sizer);

  // The woodpile, stacked against the wall beside the fire.
  const logs = new InstancedMesh(
    new CylinderGeometry(0.11, 0.1, 0.9, 7),
    softMaterial(PALETTE.bark, 0.8),
    18,
  );
  logs.name = 'castle-woodpile';
  logs.castShadow = false;
  logs.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const unit = new Vector3(1, 1, 1);
  const position = new Vector3();
  const along = new Vector3(0, 0, 1);
  const rng = new Rng(0x1065);
  let index = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i < 6; i += 1) {
      if (index >= logs.count) break;
      rotation.setFromAxisAngle(along, Math.PI / 2 + rng.range(-0.05, 0.05));
      position.set(
        CASTLE_HEARTH.x - 2.9 + (i - 2.5) * 0.235 + row * 0.11,
        0.11 + row * 0.2,
        CASTLE_HEARTH.z + 0.1,
      );
      matrix.compose(position, rotation, unit);
      logs.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  logs.instanceMatrix.needsUpdate = true;
  group.add(logs);

  return group;
}

// ------------------------------------------------------------------ corners

/**
 * Crates in the corners — **a castle with tidy corners is a lobby.**
 *
 * Placed by the same seeded rejection sample `dressing.ts` uses for benches,
 * and for the same reason: five storeys, a plan that moves, and anything
 * hand-placed goes stale the first time a shaft shifts a metre. It only ever
 * offers corners, because clutter in the middle of a hall is not clutter, it is
 * an obstacle course.
 */
function cornerClutter(deck: number, rng: Rng): InstancedMesh | null {
  const blocked = keepOutsFor(deck);
  const spots: { x: number; z: number; yaw: number; size: number }[] = [];
  const wanted = 9;

  for (let attempt = 0; attempt < 600 && spots.length < wanted; attempt += 1) {
    // Corners: near a wall in **both** axes, which is what makes it a corner
    // rather than merely a wall.
    const x = (rng.range(0, 1) < 0.5 ? -1 : 1) * rng.range(INTERIOR_HALF_X - 7, INTERIOR_HALF_X - 2);
    const z = (rng.range(0, 1) < 0.5 ? -1 : 1) * rng.range(INTERIOR_HALF_Z - 7, INTERIOR_HALF_Z - 2);
    if (!deckIsSolid(deck, x, z)) continue;
    if (!deckIsSolid(deck, x + 1.2, z) || !deckIsSolid(deck, x - 1.2, z)) continue;
    if (!deckIsSolid(deck, x, z + 1.2) || !deckIsSolid(deck, x, z - 1.2)) continue;
    // `+ 0.8` here let a crate land 6 cm inside a shop's queue radius, which
    // `check:castle` caught: the builder tested a *point* while the check
    // measures the crate's real box, and a crate's half-diagonal is 0.65 m.
    // So the builder now clears what the checker demands, plus the crate.
    if (blocked.some((k) => Math.hypot(x - k.x, z - k.z) < k.radius + PLAYER_RADIUS + 1.1)) {
      continue;
    }
    if (spots.some((s) => Math.hypot(x - s.x, z - s.z) < 1.4)) continue;
    spots.push({ x, z, yaw: rng.range(-0.5, 0.5), size: rng.range(0.62, 0.92) });
  }
  if (spots.length === 0) return null;

  const crates = new InstancedMesh(crateGeometry(), softMaterial(PALETTE.wood, 0.8), spots.length);
  crates.name = `castle-crates-${deck}`;
  crates.castShadow = false;
  crates.receiveShadow = true;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const scale = new Vector3();
  const position = new Vector3();
  spots.forEach((spot, index) => {
    rotation.setFromAxisAngle(axis, spot.yaw);
    position.set(spot.x, 0, spot.z);
    scale.set(spot.size, spot.size, spot.size);
    matrix.compose(position, rotation, scale);
    crates.setMatrixAt(index, matrix);
  });
  crates.instanceMatrix.needsUpdate = true;
  return crates;
}

/**
 * How far into the room the grille hangs.
 *
 * Clear of the 0.40 m band in which the timber wall-plate, not the slab, is the
 * ceiling — see {@link portcullis}. A tenth of a metre of margin on top,
 * because the plate's width is not a constant this module can import.
 */
const PORTCULLIS_INSET = 0.7;

/** A crate: a box with battens across it, so it is not a plain cube. */
function crateGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)];
  for (const z of [-0.51, 0.51]) {
    const batten = new BoxGeometry(1.04, 0.14, 0.05);
    batten.translate(0, 0.5, z);
    parts.push(batten);
  }
  for (const x of [-0.51, 0.51]) {
    const batten = new BoxGeometry(0.05, 0.14, 1.04);
    batten.translate(x, 0.5, 0);
    parts.push(batten);
  }
  const first = parts[0];
  if (!first) throw new Error('castleDecor: the crate built nothing.');
  return mergeGeometries(parts, false) ?? first;
}
