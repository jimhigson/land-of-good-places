import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
} from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { Rng, TAU } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';

/**
 * The furniture that stops a hotel room being a rectangle with a statue in it.
 *
 * Jim, 6 August 2026, having played it: *"make it generally more interesting
 * using the visual look of the game than just rectangular rooms that are mostly
 * empty."* This is the hotel's answer to `world/building/dressing.ts`, which
 * does the same job for the castle's decks, and it is deliberately the same
 * shape of answer: a small kit of chunky props, placed by the room's own
 * dressing method, so "what is in the lobby" is answerable by reading one list.
 *
 * ## Three rules every prop here obeys
 *
 * 1. **Fronts face +Z.** Jim's ruling, and the asset contract's (§7): the
 *    camera sits at focus + (+X, +Y, +Z), so an unrotated prop faces it. A sofa
 *    you can only see the back of is furniture wasted.
 * 2. **Only the silhouette gets an outline** (§4) — the sofa's mass, the
 *    crystal shards, the picture frame. Outlining a cushion as well fills the
 *    prop with internal lines and it stops reading as one object.
 * 3. **Anything flat on the floor is a `decal`**, and lives in a fixed height
 *    ladder so nothing z-fights: mosaic plate 0.02, rugs 0.03, the rainbow ring
 *    0.04, `Hotel.paintArrow`'s chevrons 0.06. Add to the top of the ladder,
 *    never in between.
 *
 * ## Why crystal, and why primitives
 *
 * The tower outside is a cluster of faceted crystal prisms
 * (`art/models/hotelAssets.ts`), so the inside is dressed in the same mineral:
 * hexagonal shards growing out of pots and corners, and little self-lit
 * octahedra for every lamp and sconce. All of it is primitive composition,
 * which ART_DIRECTION §7 calls the *preferred* way to build a model — none of
 * these shapes is the continuous organic form that would send it to Blender.
 */

/** Height of a rug's top face. See the ladder in this file's header. */
const RUG_Y = 0.03;
/** Height of the rainbow ring's top face. */
const RING_Y = 0.04;

/**
 * The default crystal palette — the tower's own three pastel tones plus the
 * blush that ties them to the park's masonry.
 *
 * The **first entry is the tallest shard's colour**, so a floor that wants a
 * differently-coloured crystal (Floor 50's are sky blue) passes its own list
 * with the hero tone first rather than repeating this shape of code.
 */
const CRYSTAL_TONES: readonly number[] = [
  PALETTE.glassTint,
  PALETTE.markerLilac,
  PALETTE.bubbleSkin,
  PALETTE.stonePink,
];

/**
 * A knot of faceted crystal shards, growing out of the floor.
 *
 * Six-sided cones, because a cone with a handful of radial segments *is* a
 * crystal prism and a smooth one is a party hat. The tallest shard is gently
 * self-lit so the corner it stands in still reads after dark, when a room whose
 * only other light is a disco ball would otherwise go flat.
 *
 * `seed` is a plain number rather than a shared `Rng`: each cluster is then a
 * pure function of its own seed, so adding one to the lobby cannot silently
 * reshape the one in the suite (`core/mathUtils.ts`'s `candidateRng` header
 * tells the long version of that story).
 */
export function crystalCluster(
  seed: number,
  scale = 1,
  tones: readonly number[] = CRYSTAL_TONES,
): Group {
  const group = new Group();
  group.name = 'hotel.crystals';
  const rng = new Rng(seed);

  const count = rng.int(3, 4);
  for (let i = 0; i < count; i += 1) {
    const tall = i === 0;
    const height = (tall ? rng.range(1.5, 1.9) : rng.range(0.7, 1.2)) * scale;
    const radius = rng.range(0.2, 0.32) * scale;
    const colour = tall ? (tones[0] ?? PALETTE.glassTint) : rng.pick(tones);
    const shard = solid(
      new Mesh(
        new ConeGeometry(radius, height, 6),
        toonMaterial(
          colour,
          tall ? { emissive: colour, emissiveIntensity: 0.34 } : { emissive: colour, emissiveIntensity: 0.16 },
        ),
      ),
    );
    const angle = (i / count) * TAU + rng.range(-0.4, 0.4);
    const out = tall ? 0 : rng.range(0.24, 0.42) * scale;
    shard.position.set(Math.cos(angle) * out, height / 2, Math.sin(angle) * out);
    // Leaned about its own foot, so it grew rather than got stood up.
    shard.rotation.set(rng.range(-0.16, 0.16), rng.range(0, TAU), rng.range(-0.16, 0.16));
    addOutline(shard, 0.02);
    group.add(shard);
  }
  return group;
}

/**
 * One small self-lit crystal — every lamp, sconce and bedside light here.
 *
 * An octahedron rather than a sphere: eight flat faces each take their own
 * toon band, which is what says "cut gem" without a specular highlight this
 * park has no lighting model for (§2 — metalness is never above 0).
 */
export function glowCrystal(colour: number, radius = 0.16): Mesh {
  return decal(
    new Mesh(
      new OctahedronGeometry(radius, 0),
      toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.95 }),
    ),
  );
}

/**
 * A wall sconce: a stubby bracket with a glowing crystal in it.
 *
 * Built facing **+Z**, i.e. mounted on a wall that is behind it, so the caller
 * puts it against the north wall with no rotation and against the west wall
 * with `rotation.y = Math.PI / 2`.
 */
export function sconce(colour: number = PALETTE.liftFrame): Group {
  const group = new Group();
  group.name = 'hotel.sconce';

  const bracket = solid(
    new Mesh(new BoxGeometry(0.22, 0.5, 0.24), toonMaterial(PALETTE.stonePinkDark)),
  );
  bracket.position.z = 0.1;
  addOutline(bracket, 0.016);
  group.add(bracket);

  const cup = solid(
    new Mesh(new CylinderGeometry(0.2, 0.11, 0.16, 8), toonMaterial(PALETTE.buildingTrim)),
  );
  cup.position.set(0, 0.28, 0.24);
  group.add(cup);

  const light = glowCrystal(colour, 0.17);
  light.position.set(0, 0.44, 0.24);
  group.add(light);
  return group;
}

/**
 * A flat rug. `accent` draws an inner panel, so it reads as woven rather than
 * as a coloured hole in the floor.
 */
export function rug(width: number, depth: number, colour: number, accent: number): Group {
  const group = new Group();
  group.name = 'hotel.rug';

  const base = decal(new Mesh(new BoxGeometry(width, 0.04, depth), toonMaterial(colour)));
  base.position.y = RUG_Y - 0.02;
  group.add(base);

  const inner = decal(
    new Mesh(new BoxGeometry(width - 0.7, 0.04, depth - 0.7), toonMaterial(accent)),
  );
  inner.position.y = RUG_Y;
  group.add(inner);
  return group;
}

/** A round rug — the same thing in discs, for under a statue or a disco ball. */
export function roundRug(radius: number, colour: number, accent: number): Group {
  const group = new Group();
  group.name = 'hotel.rug.round';

  const base = decal(new Mesh(new CylinderGeometry(radius, radius, 0.04, 28), toonMaterial(colour)));
  base.position.y = RUG_Y - 0.02;
  group.add(base);

  const inner = decal(
    new Mesh(new CylinderGeometry(radius - 0.45, radius - 0.45, 0.04, 24), toonMaterial(accent)),
  );
  inner.position.y = RUG_Y;
  group.add(inner);
  return group;
}

/**
 * Concentric rainbow bands inlaid in the floor — the ring the giant RiPika
 * stands in the middle of.
 *
 * `RingGeometry` rather than six stacked discs: a ring is genuinely an annulus,
 * and drawing it as one avoids six coplanar surfaces fighting each other for
 * the same depth. Colours are `ART.rainbow`, the park's own six bands, so the
 * lobby floor and the hop ring are unmistakably the same rainbow.
 */
export function rainbowRing(innerRadius: number, band: number): Group {
  const group = new Group();
  group.name = 'hotel.rainbowRing';
  ART.rainbow.forEach((colour, index) => {
    const inner = innerRadius + index * band;
    const ring = decal(
      new Mesh(new RingGeometry(inner, inner + band * 0.94, 44), toonMaterial(colour)),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = RING_Y;
    group.add(ring);
  });
  return group;
}

/**
 * A chunky sofa, seat at 0.44 m, facing **+Z**.
 *
 * Deliberately not a `MovingPlatform`: a child who can stand on the lobby sofa
 * can stand on its back and walk out over the wall, and nothing here is worth
 * that. It is scenery you walk round, which is also why it registers no
 * collision — the hotel's interiors only wall off the room itself.
 */
export function sofa(width: number, colour: number, cushion: number): Group {
  const group = new Group();
  group.name = 'hotel.sofa';
  const body = toonMaterial(colour);

  const plinth = solid(new Mesh(new BoxGeometry(width, 0.3, 0.95), body));
  plinth.position.y = 0.15;
  addOutline(plinth, 0.018);
  group.add(plinth);

  const seat = solid(new Mesh(new BoxGeometry(width - 0.3, 0.2, 0.85), toonMaterial(cushion)));
  seat.position.set(0, 0.4, 0.03);
  group.add(seat);

  const back = solid(new Mesh(new BoxGeometry(width, 0.62, 0.26), body));
  back.position.set(0, 0.61, -0.35);
  addOutline(back, 0.018);
  group.add(back);

  for (const side of [-1, 1]) {
    const arm = solid(new Mesh(new BoxGeometry(0.26, 0.34, 0.95), body));
    arm.position.set(side * (width / 2 - 0.13), 0.47, 0);
    addOutline(arm, 0.018);
    group.add(arm);
  }

  // Two squashed pillows, because a straight line of upholstery reads as a
  // bench and this is meant to look sat-in.
  for (const side of [-1, 1]) {
    const pillow = solid(
      new Mesh(new SphereGeometry(0.22, 14, 10), toonMaterial(PALETTE.blossomWhite)),
    );
    pillow.scale.set(1.15, 0.72, 0.5);
    pillow.position.set(side * (width / 2 - 0.55), 0.62, -0.19);
    group.add(pillow);
  }
  return group;
}

/**
 * A framed picture, front on **+Z**, origin at the middle of the frame.
 *
 * The picture itself is *geometry*, not a canvas: three or four flat chunky
 * shapes standing a centimetre proud of the mount. ART_DIRECTION §3's rule for
 * painted things is that a texture should look like something that could have
 * been built as geometry — at which point, for four discs and a triangle, it is
 * cheaper and truer to simply build them. It also keeps the game's canvas
 * budget (§7: under 40 distinct textures) for the things that genuinely need
 * one.
 */
export function picture(width: number, height: number, seed: number): Group {
  const group = new Group();
  group.name = 'hotel.picture';
  const rng = new Rng(seed);

  const frame = solid(
    new Mesh(new BoxGeometry(width, height, 0.1), toonMaterial(PALETTE.woodLight)),
  );
  addOutline(frame, 0.016);
  group.add(frame);

  const mount = decal(
    new Mesh(
      new BoxGeometry(width - 0.16, height - 0.16, 0.06),
      toonMaterial(PALETTE.blossomWhite),
    ),
  );
  mount.position.z = 0.04;
  group.add(mount);

  const inks = [
    PALETTE.markerPink,
    PALETTE.markerMint,
    PALETTE.markerSky,
    PALETTE.markerLemon,
    PALETTE.markerLilac,
  ];
  const shapes = rng.int(3, 4);
  for (let i = 0; i < shapes; i += 1) {
    const r = rng.range(0.1, 0.2) * Math.min(width, height);
    const colour = inks[i % inks.length] ?? PALETTE.markerPink;
    // A disc or a triangle, both as **thin cylinders** — 18 sides or 3. A
    // `ConeGeometry` triangle would have been a spike sticking half a metre out
    // of the picture towards the viewer: a cone's radius runs perpendicular to
    // its axis, so tipping one flat does not flatten it (the same trap
    // `sunburst` fell into). A three-sided cylinder is a triangle with a
    // thickness you choose.
    const shape = decal(
      new Mesh(new CylinderGeometry(r, r, 0.04, rng.chance(0.5) ? 18 : 3), toonMaterial(colour)),
    );
    shape.rotation.x = Math.PI / 2;
    shape.position.set(
      rng.range(-1, 1) * (width / 2 - r - 0.2),
      rng.range(-1, 1) * (height / 2 - r - 0.2),
      0.08,
    );
    group.add(shape);
  }
  return group;
}

/**
 * A pot with crystal growing out of it — the hotel's houseplant.
 *
 * Jim asked for "crystal planters/clusters in corners", and a crystal in a pot
 * is the version of that which can stand in the middle of a room as well as in
 * a corner without looking like scenery that fell over.
 */
export function crystalPlanter(
  seed: number,
  potColour: number = PALETTE.stonePink,
  tones: readonly number[] = CRYSTAL_TONES,
): Group {
  const group = new Group();
  group.name = 'hotel.planter';

  const pot = solid(
    new Mesh(new CylinderGeometry(0.42, 0.34, 0.62, 12), toonMaterial(potColour)),
  );
  pot.position.y = 0.31;
  addOutline(pot, 0.018);
  group.add(pot);

  const rim = solid(
    new Mesh(new CylinderGeometry(0.46, 0.46, 0.12, 12), toonMaterial(PALETTE.stonePinkDark)),
  );
  rim.position.y = 0.6;
  group.add(rim);

  const cluster = crystalCluster(seed, 0.62, tones);
  cluster.position.y = 0.58;
  group.add(cluster);
  return group;
}

/**
 * A tall faceted crystal column, floor to near the wall line.
 *
 * The lobby's theme is "grand crystal welcome", and a column is the one prop
 * that says *grand* on its own: it is the only thing in the hotel taller than
 * a grown-up that a child can walk between. Six radial segments, exactly like
 * the shards and the tower outside — a smooth cylinder would read as a pipe.
 */
export function crystalColumn(height: number, colour: number = PALETTE.glassTint): Group {
  const group = new Group();
  group.name = 'hotel.column';

  const shaft = solid(
    new Mesh(
      new CylinderGeometry(0.36, 0.44, height, 6),
      toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.22 }),
    ),
  );
  shaft.position.y = height / 2;
  addOutline(shaft, 0.022);
  group.add(shaft);

  for (const [y, r, h, tone] of [
    [0.16, 0.6, 0.32, PALETTE.markerLilac],
    [height - 0.16, 0.58, 0.32, PALETTE.markerLilac],
  ] as const) {
    const collar = solid(new Mesh(new CylinderGeometry(r, r, h, 6), toonMaterial(tone)));
    collar.position.y = y;
    addOutline(collar, 0.02);
    group.add(collar);
  }
  return group;
}

/**
 * A chunky flat five-point star, front on **+Z**.
 *
 * A real ten-vertex outline through `Shape`, not a texture: it is the single
 * shape Floor 50 repeats most, ART_DIRECTION §7 puts primitive composition
 * first, and the "yours" door already wears a solid star — so the corridor's
 * stars and the door's are unmistakably the same star.
 */
export function flatStar(radius: number, colour: number, lit = true): Mesh {
  const shape = new Shape();
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * TAU - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.44;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return decal(
    new Mesh(
      new ShapeGeometry(shape),
      toonMaterial(colour, lit ? { emissive: colour, emissiveIntensity: 0.55 } : {}),
    ),
  );
}

/**
 * One floor chevron — a real arrow, pointing along **+Z** before it is yawed.
 *
 * It used to be a `BoxGeometry(0.7, 0.04, 0.28)`, and QA's note on 6 August was
 * that from the play camera it read as "plain rectangles": a rectangle rotated
 * to lie along a direction says *there is a line here*, not *go that way*. This
 * is the notched chevron every wayfinding arrow in the world is, traced as one
 * `Shape` — six points, a flat fill, no texture — so it reads as a direction at
 * the one camera angle this game has.
 *
 * The tip is authored at **−Y** so that laying the shape flat (`rotation.x =
 * −π/2`, which is also what turns its +Z normal into +Y up) leaves it pointing
 * at +Z, ready for an ordinary yaw. The yaw has to be applied *after* that
 * tip-down rotation, hence `YXZ` — with the default `XYZ` order the arrow is
 * yawed in its own upright frame first and every chevron comes out pointing
 * the same way.
 */
export function floorChevron(colour: number, width = 1.05, length = 0.62): Mesh {
  const halfW = width / 2;
  const nose = length / 2;
  const thickness = length * 0.62;
  const shape = new Shape();
  shape.moveTo(0, -nose);
  shape.lineTo(halfW, nose - thickness);
  shape.lineTo(halfW, nose);
  shape.lineTo(0, -nose + thickness);
  shape.lineTo(-halfW, nose);
  shape.lineTo(-halfW, nose - thickness);
  shape.closePath();

  const arrow = decal(
    new Mesh(
      new ShapeGeometry(shape),
      toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.4 }),
    ),
  );
  arrow.rotation.order = 'YXZ';
  return arrow;
}

/**
 * A cloud: three squashed spheres in a row, floating.
 *
 * Rooms here are open-topped, which is normally just how the iso camera gets
 * to look in — on Floor 50 it is also the reason a cloud can hang *above* the
 * wall line and be seen. `decal`, because a cloud that cast a shadow across
 * the corridor would be a cloud a child tries to walk under.
 */
export function cloud(seed: number, scale = 1): Group {
  const group = new Group();
  group.name = 'hotel.cloud';
  const rng = new Rng(seed);
  const material = toonMaterial(PALETTE.blossomWhite, {
    emissive: PALETTE.blossomWhite,
    emissiveIntensity: 0.3,
  });
  for (const [dx, dy, r] of [
    [-0.72, -0.06, 0.5],
    [0, 0.12, 0.68],
    [0.74, -0.04, 0.52],
  ] as const) {
    const puff = decal(new Mesh(new SphereGeometry(r * scale, 14, 10), material));
    puff.scale.set(1, 0.7, 0.86);
    puff.position.set(dx * scale, dy * scale + rng.range(-0.05, 0.05), rng.range(-0.1, 0.1));
    group.add(puff);
  }
  return group;
}

/**
 * A sun inlaid in the floor: two discs and a ring of chunky triangular rays.
 *
 * Floor 1's theme is "a sunny morning", and this is the thing that says so
 * from the lift doors. It is flat floor inlay in the same ladder as the rugs
 * (see this file's header) rather than a picture of a sun: sunlight on the
 * floor of a breakfast room is a shape the room could genuinely have, which
 * is §3's test for anything decorative.
 */
export function sunburst(radius: number): Group {
  const group = new Group();
  group.name = 'hotel.sunburst';

  // All twelve rays as **one flat `Shape`** — a twelve-point star.
  //
  // They were twelve `ConeGeometry(r, h, 3)` wedges first, which is wrong
  // twice over: a cone's radius runs perpendicular to its axis in *both*
  // directions, so laying one flat leaves it standing a third of a metre proud
  // of the floor rather than inlaid in it — and it cost twelve draw calls to
  // do that. One outline traced round alternating radii is genuinely flat,
  // genuinely one draw call, and is the same construction `flatStar` uses.
  const points = 12;
  const shape = new Shape();
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (i / (points * 2)) * TAU;
    const r = i % 2 === 0 ? radius : radius * 0.66;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const rays = decal(new Mesh(new ShapeGeometry(shape), toonMaterial(PALETTE.flowerYellow)));
  rays.rotation.x = -Math.PI / 2;
  rays.position.y = RUG_Y - 0.008;
  group.add(rays);

  const disc = decal(
    new Mesh(
      new CylinderGeometry(radius * 0.72, radius * 0.72, 0.04, 40),
      toonMaterial(PALETTE.markerLemon),
    ),
  );
  disc.position.y = RUG_Y - 0.004;
  group.add(disc);

  const core = decal(
    new Mesh(
      new CylinderGeometry(radius * 0.4, radius * 0.4, 0.04, 32),
      toonMaterial(PALETTE.flowerYellow),
    ),
  );
  core.position.y = RUG_Y + 0.004;
  group.add(core);
  return group;
}

/**
 * The suite's rainbow rug: a cream middle inside the park's six bands.
 *
 * Reuses {@link rainbowRing} rather than restating it, so the lobby's inlaid
 * rainbow and Eleri's bedroom rug can never drift into two different rainbows.
 */
export function rainbowRug(innerRadius: number, band: number): Group {
  const group = new Group();
  group.name = 'hotel.rainbowRug';
  const middle = decal(
    new Mesh(
      new CylinderGeometry(innerRadius + 0.02, innerRadius + 0.02, 0.04, 32),
      toonMaterial(ART.cream),
    ),
  );
  middle.position.y = RUG_Y;
  group.add(middle);
  group.add(rainbowRing(innerRadius, band));
  return group;
}

/** The flat top of a buffet counter, metres — the reception desk's own height. */
export const BUFFET_TOP = 1.02;

/**
 * A long buffet counter, serving side on **+Z**.
 *
 * Built in the reception desk's language rather than by repeating the desk
 * itself: `createReceptionDesk` bows toward its customer and carries a key
 * board on its back, neither of which a twelve-metre run of hot food should
 * inherit. What it *does* borrow is the one number that matters — the counter
 * top at `RECEPTION_COUNTER_TOP`, so a child who has learnt to reach reception
 * can reach the cereal — and the violet-front / crystal-top colour pairing, so
 * the two obviously belong to the same hotel.
 */
export function buffetCounter(length: number): Group {
  const group = new Group();
  group.name = 'hotel.buffet';

  const front = solid(
    new Mesh(new BoxGeometry(length, 0.86, 0.72), toonMaterial(PALETTE.flowerViolet)),
  );
  front.position.y = 0.43;
  addOutline(front, 0.02);
  group.add(front);

  const top = solid(
    new Mesh(new BoxGeometry(length + 0.24, 0.16, 0.94), toonMaterial(PALETTE.glassTint)),
  );
  top.position.y = BUFFET_TOP - 0.08;
  addOutline(top, 0.02);
  group.add(top);

  // The tray rail — two chunky rods along the customer's side. It is the one
  // detail that says "buffet" rather than "wall with food on it".
  for (const y of [0.62, 0.84]) {
    const rail = solid(
      new Mesh(new CylinderGeometry(0.05, 0.05, length - 0.4, 8), toonMaterial(PALETTE.liftFrame)),
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, y, 0.5);
    group.add(rail);
  }
  return group;
}

/** A bedside table with a crystal lamp on it. Front on +Z. */
export function bedsideTable(): Group {
  const group = new Group();
  group.name = 'hotel.bedside';

  const box = solid(new Mesh(new BoxGeometry(0.56, 0.5, 0.5), toonMaterial(PALETTE.woodLight)));
  box.position.y = 0.25;
  addOutline(box, 0.018);
  group.add(box);

  const drawer = decal(
    new Mesh(new BoxGeometry(0.42, 0.16, 0.04), toonMaterial(PALETTE.wood)),
  );
  drawer.position.set(0, 0.3, 0.26);
  group.add(drawer);

  const stem = solid(
    new Mesh(new CylinderGeometry(0.05, 0.07, 0.18, 8), toonMaterial(PALETTE.liftFrame)),
  );
  stem.position.y = 0.59;
  group.add(stem);

  const lamp = glowCrystal(PALETTE.markerLemon, 0.19);
  lamp.position.y = 0.82;
  group.add(lamp);
  return group;
}
