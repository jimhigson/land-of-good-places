import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { hexToCss, PALETTE } from '../../core/palette';
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
 * **The hotel's five paintings.** Real pictures, painted once, hung everywhere.
 *
 * Jim, 7 August 2026: he wanted actual artwork on the walls rather than the
 * abstract discs-and-triangles {@link picture} composes out of geometry.
 *
 * ## Five, shared, and 256²
 *
 * ART_DIRECTION §7 caps the whole game at forty distinct textures, and this
 * round has already spent three (the lift dial's face, the television and the
 * Game Boy). So there are **five** canvases in total and every frame in the
 * hotel draws one of them — thirteen pictures, five textures. They are built
 * on first use and cached in {@link artworks}, so a hotel nobody visits pays
 * nothing and a hotel visited twice pays once.
 *
 * 256² because these are seen from across a room at an oblique angle under a
 * toon ramp. 512² would be four times the memory for detail the camera cannot
 * resolve, and it is the same reasoning behind everything else here being
 * chunky.
 *
 * ## Why these are canvases when `picture` is geometry
 *
 * §3's test for anything decorative is whether it *could* have been built as
 * geometry, and a painting is the one thing where the honest answer is no: a
 * painting is a flat image by definition, which is exactly what a texture is.
 * Drawing a rainbow, a cat and a ferris wheel out of primitives would be
 * thirty meshes per frame to imitate a picture.
 */
const artworks: (CanvasTexture | null)[] = [null, null, null, null, null];

/** How many there are. Callers index modulo this, so a hotel cannot run out. */
export const ARTWORK_COUNT = 5;

/** What each one is, for the card a child gets when she looks at it. */
export const ARTWORK_TITLES: readonly string[] = [
  'Rainbow Hill',
  'Somebody’s Cat',
  'The Big Wheel',
  'Flowers for You',
  'Little Boat',
];

function artworkTexture(index: number): CanvasTexture {
  const slot = ((index % ARTWORK_COUNT) + ARTWORK_COUNT) % ARTWORK_COUNT;
  const cached = artworks[slot];
  if (cached) return cached;

  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const fill = (colour: number): void => {
    ctx.fillStyle = hexToCss(colour);
  };
  const disc = (x: number, y: number, r: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // Every one starts as paper, so a picture always reads as a picture.
  fill(PALETTE.blossomWhite);
  ctx.fillRect(0, 0, SIZE, SIZE);

  switch (slot) {
    case 0: {
      // A rainbow over a green hill — the game's own six bands.
      fill(PALETTE.skyDayBottom);
      ctx.fillRect(0, 0, SIZE, SIZE * 0.72);
      ctx.lineWidth = 15;
      ART.rainbow.forEach((colour, i) => {
        ctx.strokeStyle = hexToCss(colour);
        ctx.beginPath();
        ctx.arc(SIZE / 2, SIZE * 0.78, 40 + i * 15, Math.PI, 0);
        ctx.stroke();
      });
      fill(PALETTE.grass);
      ctx.beginPath();
      ctx.ellipse(SIZE / 2, SIZE * 0.95, SIZE * 0.62, SIZE * 0.24, 0, Math.PI, 0);
      ctx.fill();
      break;
    }
    case 1: {
      // A cat's face, filling the frame — a portrait, so it reads at a glance.
      fill(PALETTE.markerLemon);
      ctx.fillRect(0, 0, SIZE, SIZE);
      fill(ART.biscuitFur);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(SIZE / 2 + side * 62, 92);
        ctx.lineTo(SIZE / 2 + side * 86, 26);
        ctx.lineTo(SIZE / 2 + side * 24, 58);
        ctx.closePath();
        ctx.fill();
      }
      disc(SIZE / 2, SIZE * 0.56, 88);
      fill(PALETTE.eyeDark);
      disc(SIZE / 2 - 32, SIZE * 0.5, 13);
      disc(SIZE / 2 + 32, SIZE * 0.5, 13);
      fill(PALETTE.markerPink);
      disc(SIZE / 2, SIZE * 0.6, 11);
      ctx.strokeStyle = hexToCss(PALETTE.ink);
      ctx.lineWidth = 4;
      for (const side of [-1, 1]) {
        for (const dy of [-8, 6]) {
          ctx.beginPath();
          ctx.moveTo(SIZE / 2 + side * 26, SIZE * 0.62 + dy);
          ctx.lineTo(SIZE / 2 + side * 104, SIZE * 0.62 + dy * 2.2);
          ctx.stroke();
        }
      }
      break;
    }
    case 2: {
      // The big wheel against a sunset.
      fill(PALETTE.skySunsetBottom);
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = hexToCss(PALETTE.markerSky);
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE * 0.45, 84, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 6;
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(SIZE / 2, SIZE * 0.45);
        ctx.lineTo(SIZE / 2 + Math.cos(angle) * 84, SIZE * 0.45 + Math.sin(angle) * 84);
        ctx.stroke();
        fill(ART.rainbow[i % ART.rainbow.length] ?? PALETTE.markerPink);
        disc(SIZE / 2 + Math.cos(angle) * 84, SIZE * 0.45 + Math.sin(angle) * 84, 13);
      }
      fill(PALETTE.grassDark);
      ctx.fillRect(0, SIZE * 0.82, SIZE, SIZE * 0.18);
      break;
    }
    case 3: {
      // Flowers in a jug — the still life every hotel corridor has one of.
      fill(PALETTE.stonePinkLight);
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = hexToCss(PALETTE.leafDeep);
      ctx.lineWidth = 7;
      const blooms: readonly (readonly [number, number, number])[] = [
        [SIZE * 0.32, SIZE * 0.3, PALETTE.flowerRed],
        [SIZE * 0.5, SIZE * 0.22, PALETTE.flowerYellow],
        [SIZE * 0.68, SIZE * 0.32, PALETTE.markerLilac],
      ];
      for (const [x, y] of blooms) {
        ctx.beginPath();
        ctx.moveTo(SIZE / 2, SIZE * 0.66);
        ctx.quadraticCurveTo(SIZE / 2, y + 30, x, y);
        ctx.stroke();
      }
      for (const [x, y, colour] of blooms) {
        fill(colour);
        for (let i = 0; i < 6; i += 1) {
          const angle = (i / 6) * Math.PI * 2;
          disc(x + Math.cos(angle) * 20, y + Math.sin(angle) * 20, 15);
        }
        fill(PALETTE.markerLemon);
        disc(x, y, 13);
      }
      fill(PALETTE.buildingRoofDeep);
      ctx.beginPath();
      ctx.moveTo(SIZE * 0.38, SIZE * 0.66);
      ctx.lineTo(SIZE * 0.62, SIZE * 0.66);
      ctx.lineTo(SIZE * 0.58, SIZE * 0.94);
      ctx.lineTo(SIZE * 0.42, SIZE * 0.94);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default: {
      // A little boat — the one the ocean floor deserves.
      fill(PALETTE.skyDayBottom);
      ctx.fillRect(0, 0, SIZE, SIZE * 0.6);
      fill(PALETTE.waterTop);
      ctx.fillRect(0, SIZE * 0.6, SIZE, SIZE * 0.4);
      fill(PALETTE.flowerYellow);
      disc(SIZE * 0.8, SIZE * 0.18, 30);
      fill(PALETTE.blossomWhite);
      ctx.beginPath();
      ctx.moveTo(SIZE * 0.5, SIZE * 0.16);
      ctx.lineTo(SIZE * 0.5, SIZE * 0.58);
      ctx.lineTo(SIZE * 0.24, SIZE * 0.58);
      ctx.closePath();
      ctx.fill();
      fill(PALETTE.markerPink);
      ctx.beginPath();
      ctx.moveTo(SIZE * 0.53, SIZE * 0.2);
      ctx.lineTo(SIZE * 0.76, SIZE * 0.58);
      ctx.lineTo(SIZE * 0.53, SIZE * 0.58);
      ctx.closePath();
      ctx.fill();
      fill(PALETTE.flowerRed);
      ctx.beginPath();
      ctx.moveTo(SIZE * 0.2, SIZE * 0.6);
      ctx.lineTo(SIZE * 0.8, SIZE * 0.6);
      ctx.lineTo(SIZE * 0.68, SIZE * 0.74);
      ctx.lineTo(SIZE * 0.32, SIZE * 0.74);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  artworks[slot] = texture;
  return texture;
}

/**
 * A framed painting, front on **+Z** — one of the five {@link artworkTexture}s
 * in a chunky frame with a mount.
 *
 * The same construction as {@link picture} (which stays, because its abstract
 * shapes are right where a *pattern* is wanted) with the middle replaced by a
 * real image on a `decal` plane. `decal` rather than `solid` for the canvas
 * itself: a painting hangs flat against a wall, and a lit-from-the-side
 * painting reads as a poster peeling off.
 */
export function paintedPicture(width: number, height: number, art: number): Group {
  const group = new Group();
  group.name = 'hotel.artwork';

  const frame = solid(
    new Mesh(new BoxGeometry(width, height, 0.1), toonMaterial(PALETTE.woodLight)),
  );
  addOutline(frame, 0.016);
  group.add(frame);

  const mount = decal(
    new Mesh(new BoxGeometry(width - 0.14, height - 0.14, 0.06), toonMaterial(PALETTE.blossomWhite)),
  );
  mount.position.z = 0.04;
  group.add(mount);

  const canvasPlane = decal(
    new Mesh(
      new PlaneGeometry(width - 0.3, height - 0.3),
      toonMaterial(PALETTE.blossomWhite, {
        map: artworkTexture(art),
        // A gentle self-lift so a painting on a far wall is still legible at
        // dusk, in the same spirit as the mosaic floor's.
        emissive: PALETTE.blossomWhite,
        emissiveIntensity: 0.22,
      }),
    ),
  );
  canvasPlane.position.z = 0.075;
  group.add(canvasPlane);
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

/**
 * The sparkle on a mirror ball: facet glints that twinkle as it turns, and a
 * slow drift of motes falling through the light under it.
 *
 * Jim, 7 August 2026: the lobby's ball should be *"as sparkly as possible"*.
 * The five `SpotLight`s (`Hotel.hangDiscoBall`) are the beams going round the
 * room; this is the ball itself catching the light, which is the half a real
 * one does with its own surface.
 *
 * ## Two `InstancedMesh`es and not one particle system
 *
 * Ninety glints and forty motes is a hundred and thirty little objects, and as
 * separate `Mesh`es that is a hundred and thirty draw calls hanging in the
 * middle of the lobby. Instanced, it is two. This is the same idiom the
 * dodgems' arena and the park's own crowd use, and the reason it is worth
 * naming here is the second half of it: **nothing is allocated per frame.**
 * The matrix, the vectors and the quaternion below are built once and written
 * over, and every random the animation needs was drawn at construction into a
 * `Float32Array` of phases. A twinkle that allocated a `Vector3` per instance
 * per frame would be 7,800 objects a second for the garbage collector, in a
 * game that already has a note in ORDER-OF-WORK about exactly that
 * (the balloon strings).
 *
 * Glints are **not** lit and cast nothing: they are `decal`, self-lit chips of
 * colour. A glint that took the toon ramp would go dark on the side of the
 * ball facing away from the key light, which is precisely the half a mirror
 * ball is *most* interesting on.
 */
export interface DiscoSparkle {
  /** Add to the ball's rotating group — they turn with the facets. */
  readonly glints: InstancedMesh;
  /** Add to the room, at the ball's height — these drift on their own. */
  readonly motes: InstancedMesh;
  update(elapsed: number): void;
}

/** Chips of light on the ball's surface, and specks drifting below it. */
const SPARKLE_GLINTS = 90;
const SPARKLE_MOTES = 40;

export function createDiscoSparkle(ballRadius: number, seed: number): DiscoSparkle {
  const rng = new Rng(seed);
  const tones: readonly number[] = [
    PALETTE.blossomWhite,
    PALETTE.markerPink,
    PALETTE.markerSky,
    PALETTE.markerMint,
    PALETTE.markerLemon,
  ];

  // --- the glints ----------------------------------------------------------
  const glints = new InstancedMesh(
    new OctahedronGeometry(ballRadius * 0.085, 0),
    toonMaterial(PALETTE.blossomWhite, {
      emissive: PALETTE.blossomWhite,
      emissiveIntensity: 1,
    }),
    SPARKLE_GLINTS,
  );
  decal(glints);
  glints.name = 'hotel.disco.glints';

  // Where each one sits on the ball, and when it twinkles. Drawn once.
  const glintAt = new Float32Array(SPARKLE_GLINTS * 3);
  const glintPhase = new Float32Array(SPARKLE_GLINTS);
  const glintRate = new Float32Array(SPARKLE_GLINTS);
  const colour = new Color();
  for (let i = 0; i < SPARKLE_GLINTS; i += 1) {
    // Evenly over the sphere: `acos(1 - 2u)` rather than a uniform angle, or
    // they bunch at the poles and the ball's equator looks bald.
    const theta = rng.range(0, TAU);
    const phi = Math.acos(1 - 2 * rng.unit());
    const r = ballRadius * 1.015;
    glintAt[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    glintAt[i * 3 + 1] = Math.cos(phi) * r;
    glintAt[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    glintPhase[i] = rng.range(0, TAU);
    glintRate[i] = rng.range(1.7, 3.4);
    colour.setHex(rng.pick(tones));
    glints.setColorAt(i, colour);
  }
  if (glints.instanceColor) glints.instanceColor.needsUpdate = true;

  // --- the motes -----------------------------------------------------------
  const motes = new InstancedMesh(
    new SphereGeometry(0.055, 6, 5),
    toonMaterial(PALETTE.blossomWhite, {
      emissive: PALETTE.blossomWhite,
      emissiveIntensity: 0.85,
    }),
    SPARKLE_MOTES,
  );
  decal(motes);
  motes.name = 'hotel.disco.motes';

  const moteRadius = new Float32Array(SPARKLE_MOTES);
  const moteAngle = new Float32Array(SPARKLE_MOTES);
  const moteSpin = new Float32Array(SPARKLE_MOTES);
  const moteFall = new Float32Array(SPARKLE_MOTES);
  const moteDrop = new Float32Array(SPARKLE_MOTES);
  for (let i = 0; i < SPARKLE_MOTES; i += 1) {
    moteRadius[i] = rng.range(0.6, 4.6);
    moteAngle[i] = rng.range(0, TAU);
    moteSpin[i] = rng.range(0.06, 0.2) * (rng.chance(0.5) ? 1 : -1);
    // How long one mote takes to fall its whole run, and where in that run it
    // starts — so they are not a curtain descending in unison.
    moteFall[i] = rng.range(7, 15);
    moteDrop[i] = rng.range(0, 1);
    colour.setHex(rng.pick(tones));
    motes.setColorAt(i, colour);
  }
  if (motes.instanceColor) motes.instanceColor.needsUpdate = true;

  // Written over every frame, never replaced. See this function's header.
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  /** How far below the ball a mote has fallen by the end of its run. */
  const FALL = 5.2;

  return {
    glints,
    motes,
    update(elapsed: number): void {
      for (let i = 0; i < SPARKLE_GLINTS; i += 1) {
        // Twinkle: a sine sharpened by squaring, so each glint is dark most of
        // the time and briefly very bright — which is what catching the light
        // looks like, where a gentle pulse reads as a row of fairy lights.
        const wave = Math.sin(elapsed * glintRate[i]! + glintPhase[i]!);
        const bright = wave > 0 ? wave * wave : 0;
        const size = 0.25 + bright * 1.5;
        position.set(glintAt[i * 3]!, glintAt[i * 3 + 1]!, glintAt[i * 3 + 2]!);
        scale.setScalar(size);
        matrix.compose(position, quaternion, scale);
        glints.setMatrixAt(i, matrix);
      }
      glints.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < SPARKLE_MOTES; i += 1) {
        // A sawtooth down: reaches the floor, reappears at the ball. `%` on a
        // rising number is the whole particle system.
        const t = (moteDrop[i]! + elapsed / moteFall[i]!) % 1;
        const angle = moteAngle[i]! + elapsed * moteSpin[i]!;
        position.set(
          Math.cos(angle) * moteRadius[i]!,
          -t * FALL,
          Math.sin(angle) * moteRadius[i]!,
        );
        // Fading in and out at both ends of the fall, so nothing pops.
        const fade = Math.min(1, Math.min(t, 1 - t) * 6);
        scale.setScalar(0.25 + fade * 0.95);
        matrix.compose(position, quaternion, scale);
        motes.setMatrixAt(i, matrix);
      }
      motes.instanceMatrix.needsUpdate = true;
    },
  };
}

// ----------------------------------------------------- Floor 12, the garden

/**
 * A tuft of meadow: a low dome of leaves with a few flower heads poking out.
 *
 * The garden floor's smallest unit and the one it repeats most, so it is one
 * group of four or five squashed spheres rather than anything cleverer. Flower
 * heads are `decal` — they are little self-lit dots of colour, and a shadow
 * from a 6 cm daisy is a shadow nobody has ever seen.
 */
export function flowerTuft(seed: number, scale = 1): Group {
  const group = new Group();
  group.name = 'hotel.tuft';
  const rng = new Rng(seed);

  const leaves = toonMaterial(rng.pick([PALETTE.leafMid, PALETTE.leafLight, PALETTE.grass]));
  for (let i = 0; i < 3; i += 1) {
    const r = rng.range(0.22, 0.34) * scale;
    const dome = solid(new Mesh(new SphereGeometry(r, 12, 8), leaves));
    dome.scale.set(1.15, 0.72, 1.05);
    dome.position.set(rng.range(-0.22, 0.22) * scale, r * 0.6, rng.range(-0.22, 0.22) * scale);
    group.add(dome);
  }

  const blooms: readonly number[] = [
    PALETTE.flowerYellow,
    PALETTE.blossomPink,
    PALETTE.flowerRed,
    PALETTE.markerLilac,
  ];
  for (let i = 0; i < rng.int(2, 4); i += 1) {
    const colour = rng.pick(blooms);
    const head = decal(
      new Mesh(
        new SphereGeometry(0.09 * scale, 10, 8),
        toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.3 }),
      ),
    );
    head.position.set(
      rng.range(-0.3, 0.3) * scale,
      rng.range(0.34, 0.52) * scale,
      rng.range(-0.3, 0.3) * scale,
    );
    group.add(head);
  }
  return group;
}

/**
 * A clipped hedge with flowers growing along the top of it, front on +Z.
 *
 * The garden floor's answer to the other rooms' crystal clusters: the thing
 * that fills a corner and gives the eye something with a *shape* in it. Its
 * footprint is registered by the caller as a rectangle, the way the buffet's
 * is — you walk along a hedge, you do not walk round a single fat disc of it.
 */
export function hedge(width: number, seed: number): Group {
  const group = new Group();
  group.name = 'hotel.hedge';
  const rng = new Rng(seed);

  const body = solid(
    new Mesh(new BoxGeometry(width, 0.78, 0.62), toonMaterial(PALETTE.leafDeep)),
  );
  body.position.y = 0.39;
  addOutline(body, 0.02);
  group.add(body);

  // Bobbly top — a straight-edged box is a wall painted green.
  const bobbles = Math.max(2, Math.round(width / 0.55));
  for (let i = 0; i < bobbles; i += 1) {
    const dome = solid(
      new Mesh(new SphereGeometry(rng.range(0.26, 0.34), 12, 8), toonMaterial(PALETTE.leafMid)),
    );
    dome.scale.set(1.1, 0.66, 1);
    dome.position.set(-width / 2 + ((i + 0.5) / bobbles) * width, 0.8, rng.range(-0.08, 0.08));
    group.add(dome);
  }
  return group;
}

/**
 * A rose arch: two posts, a curved top, and blossom growing over it.
 *
 * The one prop on the garden floor taller than a grown-up, and the reason the
 * room reads as a garden the moment the lift doors open rather than as a green
 * room. You walk **through** it — the footprint the caller registers is the two
 * posts, never the span.
 */
export function trellisArch(width: number, height: number, seed: number): Group {
  const group = new Group();
  group.name = 'hotel.arch';
  const rng = new Rng(seed);
  const timber = toonMaterial(PALETTE.woodLight);

  for (const side of [-1, 1]) {
    const post = solid(new Mesh(new CylinderGeometry(0.09, 0.11, height, 8), timber));
    post.position.set((side * width) / 2, height / 2, 0);
    addOutline(post, 0.018);
    group.add(post);
  }

  // The curve, as a shallow ring segment — chunky, flat, and one draw call.
  const arch = solid(
    new Mesh(new CylinderGeometry(width / 2 + 0.1, width / 2 + 0.1, 0.18, 14, 1, true), timber),
  );
  arch.rotation.x = Math.PI / 2;
  arch.rotation.z = Math.PI / 2;
  arch.position.y = height;
  arch.scale.set(1, 1, 0.42);
  group.add(arch);

  for (let i = 0; i < 7; i += 1) {
    const t = (i + 0.5) / 7;
    const angle = Math.PI * t;
    const tuft = flowerTuft(seed + i * 31, 0.62);
    tuft.position.set(
      -Math.cos(angle) * (width / 2 + 0.1),
      height + Math.sin(angle) * 0.42 - 0.1,
      rng.range(-0.12, 0.12),
    );
    group.add(tuft);
  }
  return group;
}

/**
 * A little pond, inlaid in the floor: water, a foam rim and two lily pads.
 *
 * Flat floor inlay in the same height ladder as the rugs (see this file's
 * header), so a child walks straight over it — a pond you can fall into is a
 * pond that needs a whole swimming system behind it, and this is scenery.
 */
export function lilyPond(radius: number, seed: number): Group {
  const group = new Group();
  group.name = 'hotel.pond';
  const rng = new Rng(seed);

  const rim = decal(
    new Mesh(new CylinderGeometry(radius, radius, 0.04, 32), toonMaterial(PALETTE.stonePinkLight)),
  );
  rim.position.y = RUG_Y - 0.02;
  group.add(rim);

  const water = decal(
    new Mesh(
      new CylinderGeometry(radius - 0.26, radius - 0.26, 0.04, 32),
      toonMaterial(PALETTE.waterTop, { emissive: PALETTE.waterTop, emissiveIntensity: 0.32 }),
    ),
  );
  water.position.y = RUG_Y;
  group.add(water);

  for (let i = 0; i < 3; i += 1) {
    const pad = decal(
      new Mesh(new CylinderGeometry(0.3, 0.3, 0.04, 12), toonMaterial(PALETTE.leafMid)),
    );
    const angle = rng.range(0, TAU);
    const out = rng.range(0, radius - 0.7);
    pad.position.set(Math.cos(angle) * out, RUG_Y + 0.01, Math.sin(angle) * out);
    group.add(pad);
  }
  return group;
}

// ------------------------------------------------------ Floor 33, the ocean

/**
 * A chunky flat fish, nose on **+X**, front face on **+Z**.
 *
 * Traced as one `Shape` for the same reason `flatStar` and `floorChevron` are:
 * it is the shape this floor repeats most, it is genuinely flat, and one
 * outline is one draw call where a body-plus-two-fins assembly would be three.
 * Nose on +X rather than +Z because a fish is drawn side-on — you see a fish by
 * looking at its flank, which is exactly what the camera does to anything hung
 * on the north wall.
 */
export function fishShape(length: number, colour: number): Mesh {
  const h = length * 0.42;
  const shape = new Shape();
  shape.moveTo(length * 0.5, 0);
  shape.quadraticCurveTo(length * 0.1, h, -length * 0.18, h * 0.52);
  shape.lineTo(-length * 0.5, h * 0.86);
  shape.lineTo(-length * 0.34, 0);
  shape.lineTo(-length * 0.5, -h * 0.86);
  shape.lineTo(-length * 0.18, -h * 0.52);
  shape.quadraticCurveTo(length * 0.1, -h, length * 0.5, 0);
  shape.closePath();
  return decal(
    new Mesh(
      new ShapeGeometry(shape),
      toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.36 }),
    ),
  );
}

/**
 * A brass-ish ring hung round a window, front on **+Z** — a porthole.
 *
 * **It is a frame and nothing else.** The glass is the room's own declared
 * window (`layout.ts`'s `WindowWall`, built by `Hotel.glazeWall`), and this
 * goes round it. That split is deliberate and it is CLAUDE.md's hood-face rule
 * in a different costume: a second self-lit disc floated in front of the real
 * pane would be a surface whose position has to independently agree with the
 * pane's, for ever, and the moment somebody edits `at` by half a metre the
 * porthole is a brass ring round a bit of wall.
 */
export function porthole(radius: number, colour: number = PALETTE.liftFrame): Group {
  const group = new Group();
  group.name = 'hotel.porthole';

  const ring = solid(new Mesh(new CylinderGeometry(radius, radius, 0.14, 20, 1, true), toonMaterial(colour)));
  ring.rotation.x = Math.PI / 2;
  addOutline(ring, 0.018);
  group.add(ring);

  // Four rivets, at the compass points. It is the detail that says *ship*.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * TAU + Math.PI / 4;
    const rivet = decal(
      new Mesh(new SphereGeometry(0.055, 8, 6), toonMaterial(PALETTE.stonePinkDark)),
    );
    rivet.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.05);
    group.add(rivet);
  }
  return group;
}

/**
 * A frond of seaweed: three tapering blades leaning off a common foot.
 *
 * The ocean floor's crystal cluster — the corner-filler with a silhouette.
 * Leaned about their own feet exactly the way `crystalCluster`'s shards are,
 * because "grew here" and "was stood up here" look completely different and
 * only one of them is right for a plant.
 */
export function seaweed(seed: number, scale = 1): Group {
  const group = new Group();
  group.name = 'hotel.seaweed';
  const rng = new Rng(seed);
  const greens: readonly number[] = [PALETTE.leafBlue, PALETTE.markerMint, PALETTE.buildingTrimDeep];

  for (let i = 0; i < rng.int(3, 4); i += 1) {
    const height = rng.range(0.9, 1.7) * scale;
    const colour = rng.pick(greens);
    const blade = solid(
      new Mesh(
        new ConeGeometry(rng.range(0.13, 0.2) * scale, height, 5),
        toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.2 }),
      ),
    );
    const angle = rng.range(0, TAU);
    blade.position.set(Math.cos(angle) * 0.2 * scale, height / 2, Math.sin(angle) * 0.2 * scale);
    blade.rotation.set(rng.range(-0.3, 0.3), rng.range(0, TAU), rng.range(-0.3, 0.3));
    addOutline(blade, 0.018);
    group.add(blade);
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
