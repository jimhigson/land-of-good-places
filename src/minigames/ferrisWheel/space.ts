import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { Rng, TAU, clamp01 } from '../../core/mathUtils';
import { decal, disposeTree, toonMaterial } from '../../art/style/materials';

/**
 * The space show: stars, the Moon, planets, and the whole Earth below.
 *
 * This is the payoff of the whole ride and it is family canon — every item in
 * here was asked for by name, so nothing in this file is decoration that can be
 * dropped to save a draw call.
 *
 * **Everything is at a made-up distance.** Real astronomical scale gives you a
 * black rectangle with three dots in it. The Earth is three hundred metres
 * across and eight hundred metres down; the Moon is a five-metre ball sixty
 * metres away; the planets drift past close enough to look like the toys they
 * are. What matters is the picture through the window, and the picture wants
 * everything at once.
 *
 * **Stars are unlit and pre-aimed.** They are a single instanced quad each
 * turned to face the gondola once at build time, not billboarded per frame —
 * the camera in this ride barely turns, and 240 quads that never need a matrix
 * rewrite are 240 quads the phone never has to think about. Twinkling is done
 * in the instance colour instead, which is one buffer upload for the lot.
 */

/** How many stars. Enough to read as "sky", few enough to stay tidy. */
const STAR_COUNT = 320;

/** Radius of the shell the stars sit on. Well beyond everything else. */
const STAR_SHELL = 620;

/**
 * The Earth: radius, and how far below and in front of the gondola it hangs.
 *
 * Placed by the *angle it subtends*, not by anything physical. The camera looks
 * a few degrees below level with a 62° field of view, so the planet's centre
 * sits about 42° below the sight line and its limb about 20° below — which puts
 * the curve of the Earth across the bottom third of the window and leaves the
 * top two thirds for stars. Drop it any further and the whole planet falls out
 * of the bottom of the frame, which is exactly what the first attempt did.
 */
const EARTH_RADIUS = 300;
const EARTH_DROP = 535;
const EARTH_PUSH = 594;

interface Planet {
  readonly root: Group;
  /** Where it drifts from and to, and how long it takes. */
  readonly from: Vector3;
  readonly to: Vector3;
  readonly spin: number;
  readonly offset: number;
  readonly period: number;
}

export interface SpaceShow {
  readonly root: Group;
  /**
   * How much of space is showing, 0..1.
   *
   * Below about 0.5 nothing here is visible at all: the stars come out as the
   * sky darkens, and the Earth arrives from behind the cloud band.
   */
  setDepth(depth: number): void;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export function createSpaceShow(): SpaceShow {
  const root = new Group();
  root.name = 'ferris:space';
  root.visible = false;

  const rng = new Rng(0x5ce7a5);

  // --- stars -----------------------------------------------------------------
  const starMaterial = new MeshBasicMaterial({ toneMapped: false, transparent: true });
  const stars = new InstancedMesh(starGeometry(), starMaterial, STAR_COUNT);
  stars.name = 'stars';
  stars.frustumCulled = false;
  root.add(stars);

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const twinkle: { phase: number; rate: number; size: number; tint: Color }[] = [];
  const starColour = new Color();
  const up = new Vector3(0, 1, 0);
  const aim = new Vector3();

  const starTints = [ART.shine, PALETTE.markerLemon, PALETTE.markerSky, PALETTE.markerPink];

  for (let i = 0; i < STAR_COUNT; i += 1) {
    // Biased towards the upper half of the sphere: below the gondola is where
    // the Earth is, and a star behind the Earth is a wasted star.
    const theta = rng.range(0, TAU);
    const y = rng.range(-0.25, 1);
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    position.set(
      Math.cos(theta) * radial * STAR_SHELL,
      y * STAR_SHELL,
      Math.sin(theta) * radial * STAR_SHELL,
    );
    aim.copy(position).normalize();
    quaternion.setFromUnitVectors(up, aim);
    // Sized in metres on a 620-metre shell: a five-metre sparkle is about half
    // a degree across, which is the smallest a star can be and still twinkle
    // rather than flicker on a phone.
    const size = rng.range(3.4, 11);
    scale.setScalar(size);
    matrix.compose(position, quaternion, scale);
    stars.setMatrixAt(i, matrix);
    twinkle.push({
      phase: rng.range(0, TAU),
      rate: rng.range(0.6, 2.4),
      size,
      tint: new Color(rng.pick(starTints)),
    });
  }
  stars.instanceMatrix.needsUpdate = true;

  // --- the Moon ---------------------------------------------------------------
  const moon = new Group();
  moon.name = 'moon';
  moon.position.set(-46, 26, -96);
  root.add(moon);

  const moonBall = decal(new Mesh(new SphereGeometry(9, 26, 20), toonMaterial(PALETTE.moon)));
  moon.add(moonBall);

  // Craters: pale dishes laid on the surface, each pushed out past it so it
  // cannot half-sink and leave a jagged intersection (ART_DIRECTION §5).
  const craterMaterial = toonMaterial(PALETTE.stonePinkLight);
  for (let i = 0; i < 7; i += 1) {
    const crater = decal(new Mesh(new SphereGeometry(rng.range(1.1, 2.4), 14, 10), craterMaterial));
    const theta = rng.range(0, TAU);
    const phi = Math.acos(rng.range(-0.4, 0.9));
    crater.position.set(
      Math.sin(phi) * Math.cos(theta) * 8.6,
      Math.cos(phi) * 8.6,
      Math.sin(phi) * Math.sin(theta) * 8.6,
    );
    crater.scale.set(1, 0.35, 1);
    crater.lookAt(0, 0, 0);
    crater.rotateX(Math.PI / 2);
    moon.add(crater);
  }

  // --- the whole Earth --------------------------------------------------------
  const earth = new Group();
  earth.name = 'earth';
  earth.position.set(0, -EARTH_DROP, -EARTH_PUSH);
  earth.rotation.z = 0.22;
  root.add(earth);

  const ocean = decal(
    new Mesh(new SphereGeometry(EARTH_RADIUS, 48, 36), toonMaterial(PALETTE.waterDeep)),
  );
  earth.add(ocean);

  // Continents and clouds are blobs stuck on the ball, in the same way every
  // marking in this park is: a separate mesh that protrudes past the surface.
  const landMaterial = toonMaterial(PALETTE.grass);
  const cloudMaterial = toonMaterial(PALETTE.blossomWhite);
  for (let i = 0; i < 16; i += 1) {
    const land = i < 9;
    const blob = decal(
      new Mesh(
        new SphereGeometry(rng.range(38, 88), 20, 14),
        land ? landMaterial : cloudMaterial,
      ),
    );
    const theta = rng.range(0, TAU);
    const phi = Math.acos(rng.range(-1, 1));
    const shell = EARTH_RADIUS * (land ? 0.995 : 1.02);
    blob.position.set(
      Math.sin(phi) * Math.cos(theta) * shell,
      Math.cos(phi) * shell,
      Math.sin(phi) * Math.sin(theta) * shell,
    );
    blob.scale.set(1, rng.range(0.45, 0.8), rng.range(0.6, 1.1));
    blob.lookAt(0, 0, 0);
    blob.rotateX(Math.PI / 2);
    earth.add(blob);
  }

  // A soft rim of atmosphere. Unlit and drawn behind everything, so the planet
  // has a blue edge the way it does in every photograph a child has ever seen.
  const halo = decal(
    new Mesh(
      new SphereGeometry(EARTH_RADIUS * 1.045, 40, 28),
      new MeshBasicMaterial({
        color: PALETTE.skyDayBottom,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    ),
  );
  earth.add(halo);

  // --- planets ----------------------------------------------------------------
  const planets: Planet[] = [];
  const planetColours = [PALETTE.markerLilac, PALETTE.flowerYellow, PALETTE.markerMint];

  planetColours.forEach((colour, index) => {
    const planet = new Group();
    planet.name = `planet:${index}`;
    root.add(planet);

    const radius = [6.5, 4.4, 5.2][index] ?? 5;
    const ball = decal(new Mesh(new SphereGeometry(radius, 26, 20), toonMaterial(colour)));
    ball.scale.set(1, 0.94, 1);
    planet.add(ball);

    // Each one gets a marking, so three balls are three planets.
    if (index === 0) {
      const ring = decal(
        new Mesh(
          new RingGeometry(radius * 1.4, radius * 2.1, 40),
          new MeshBasicMaterial({
            color: PALETTE.markerPink,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            side: 2,
          }),
        ),
      );
      ring.rotation.set(Math.PI / 2 - 0.42, 0, 0.2);
      planet.add(ring);
    } else if (index === 1) {
      const stripeMaterial = toonMaterial(PALETTE.markerPink);
      for (const y of [-0.42, 0, 0.44]) {
        const stripe = decal(new Mesh(new SphereGeometry(radius * 1.005, 24, 6), stripeMaterial));
        stripe.scale.set(1, 0.13, 1);
        stripe.position.y = y * radius;
        planet.add(stripe);
      }
    } else {
      const spotMaterial = toonMaterial(PALETTE.markerSky);
      for (let i = 0; i < 5; i += 1) {
        const spot = decal(new Mesh(new SphereGeometry(radius * 0.3, 14, 10), spotMaterial));
        const theta = rng.range(0, TAU);
        const phi = Math.acos(rng.range(-0.7, 0.7));
        spot.position.set(
          Math.sin(phi) * Math.cos(theta) * radius,
          Math.cos(phi) * radius,
          Math.sin(phi) * Math.sin(theta) * radius,
        );
        spot.scale.set(1, 0.4, 1);
        spot.lookAt(0, 0, 0);
        spot.rotateX(Math.PI / 2);
        planet.add(spot);
      }
    }

    planets.push({
      root: planet,
      from: new Vector3([64, -52, 40][index] ?? 0, [22, 9, 34][index] ?? 0, -150 - index * 40),
      to: new Vector3([-58, 60, -46][index] ?? 0, [8, 26, 14][index] ?? 0, -80 - index * 30),
      spin: [0.16, -0.24, 0.12][index] ?? 0.1,
      offset: [0.1, 0.45, 0.72][index] ?? 0,
      period: [150, 190, 168][index] ?? 160,
    });
  });

  let depth = 0;

  return {
    root,

    setDepth(next: number): void {
      depth = clamp01(next);
      root.visible = depth > 0.001;
      starMaterial.opacity = clamp01((depth - 0.08) / 0.5);
      halo.material.opacity = 0.3 * depth;
    },

    update(_dt: number, elapsed: number): void {
      if (!root.visible) return;

      // Twinkle. One instance-colour upload for the whole sky.
      for (let i = 0; i < STAR_COUNT; i += 1) {
        const star = twinkle[i];
        if (!star) continue;
        const pulse = 0.55 + 0.45 * Math.sin(elapsed * star.rate + star.phase);
        starColour.copy(star.tint).multiplyScalar(0.45 + pulse * 0.75);
        stars.setColorAt(i, starColour);
      }
      if (stars.instanceColor) stars.instanceColor.needsUpdate = true;

      moon.rotation.y = elapsed * 0.02;
      earth.rotation.y = elapsed * 0.012;

      for (const planet of planets) {
        // A long slow slide across the window, looping. Never a straight line
        // through the middle: they pass by, they do not fly at you.
        const t = ((elapsed / planet.period) + planet.offset) % 1;
        const eased = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
        planet.root.position.lerpVectors(planet.from, planet.to, eased);
        planet.root.position.y += Math.sin(t * Math.PI * 4) * 4;
        planet.root.rotation.y = elapsed * planet.spin;
        planet.root.rotation.z = Math.sin(elapsed * 0.1 + planet.offset) * 0.15;
      }
    },

    dispose(): void {
      disposeTree(root);
      stars.dispose();
    },
  };
}

/**
 * One star: a four-pointed sparkle, built as a lozenge rather than a dot.
 *
 * A circle at this size is a pixel of noise; a pointed star is unmistakably a
 * star even when it is three pixels across on a phone.
 */
function starGeometry(): SphereGeometry {
  // A sphere squashed to nothing on one axis is a cheap diamond — and it comes
  // with the normals and UVs already right, which a hand-built quad does not.
  const geometry = new SphereGeometry(0.12, 4, 2);
  geometry.scale(1, 0.35, 1);
  return geometry;
}
