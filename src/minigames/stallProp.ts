import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../core/palette';
import { addOutline, decal, solid, toonMaterial } from '../art/style/materials';
// The stand distance lives with the coordinates rather than with the geometry:
// the NPC waypoint seeds need it and must not import anything that builds a
// mesh. See `stallPlacement.ts`.
export { STALL_STAND_DISTANCE } from './stallPlacement';
import { STALL_STAND_DISTANCE } from './stallPlacement';
import type { StallDefinition } from './types';

/**
 * A fun-fair stall: striped awning, counter, prizes on the shelf and a big
 * cheerful sign.
 *
 * Follows the park's asset contract (ART_DIRECTION.md §7): a fresh `Group` per
 * call, origin at the base and centred in X/Z, facing **+Z** — so the counter
 * you walk up to is the +Z side and the caller only ever sets `rotation.y`.
 *
 * The stripes are geometry rather than a texture on purpose. Eight chunky
 * boxes with a rounded scallop on the front edge cost one more draw call than a
 * painted canvas and read as *cloth* from the isometric camera, where a flat
 * striped plane reads as a sticker.
 */

/** Overall width of the booth, in metres. */
export const STALL_WIDTH = 4.2;
/** Front-to-back depth, from the back wall to the front of the counter. */
export const STALL_DEPTH = 2.6;

export interface StallProp {
  readonly root: Group;
  /** Total height in metres, sign bobble and all. */
  readonly height: number;
  update(elapsed: number): void;
  dispose(): void;
}

export function createStallProp(definition: StallDefinition): StallProp {
  const root = new Group();
  root.name = `stall:${definition.id}`;

  const accent = definition.accent;
  const stripe = definition.stripe;

  const creamMaterial = toonMaterial(PALETTE.buildingWall);
  const woodMaterial = toonMaterial(PALETTE.wood);
  const accentMaterial = toonMaterial(accent);
  const stripeMaterial = toonMaterial(stripe);
  const boardMaterial = toonMaterial(PALETTE.woodLight);

  const halfWidth = STALL_WIDTH / 2;

  // --- floor pad ------------------------------------------------------------
  // Unlit like the anchor plots: a lit material turns the pad into a dark slab
  // at dusk, exactly when it most needs to say "stand here".
  const pad = decal(
    new Mesh(
      new CylinderGeometry(2.1, 2.1, 0.02, 34),
      new MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    ),
  );
  pad.position.set(0, 0.06, STALL_STAND_DISTANCE * 0.55);
  root.add(pad);

  // --- back wall and side panels -------------------------------------------
  const back = solid(new Mesh(new RoundedBoxGeometry(STALL_WIDTH, 2.5, 0.18, 3, 0.07), creamMaterial));
  back.position.set(0, 1.25, -1.1);
  root.add(back);
  addOutline(back, 0.02);

  for (const side of [-1, 1] as const) {
    const panel = solid(
      new Mesh(new RoundedBoxGeometry(0.18, 2.3, 1.9, 3, 0.07), creamMaterial),
    );
    panel.position.set(side * (halfWidth - 0.09), 1.15, -0.2);
    root.add(panel);
  }

  // --- counter --------------------------------------------------------------
  const counter = solid(
    new Mesh(new RoundedBoxGeometry(STALL_WIDTH - 0.3, 1.05, 0.72, 4, 0.1), woodMaterial),
  );
  counter.position.set(0, 0.52, 1.02);
  root.add(counter);
  addOutline(counter, 0.02);

  const counterTop = solid(
    new Mesh(new RoundedBoxGeometry(STALL_WIDTH - 0.1, 0.14, 0.92, 3, 0.06), boardMaterial),
  );
  counterTop.position.set(0, 1.08, 1.02);
  root.add(counterTop);

  // A skirt of alternating colour under the counter lip, so the front of the
  // booth is never a plain slab of wood.
  const skirtCount = 8;
  const skirtWidth = (STALL_WIDTH - 0.3) / skirtCount;
  for (let i = 0; i < skirtCount; i += 1) {
    const swatch = solid(
      new Mesh(
        new BoxGeometry(skirtWidth, 0.5, 0.06),
        i % 2 === 0 ? accentMaterial : stripeMaterial,
      ),
    );
    swatch.position.set(-halfWidth + 0.15 + (i + 0.5) * skirtWidth, 0.72, 1.4);
    root.add(swatch);
  }

  // --- corner posts, candy-striped ------------------------------------------
  const postHeight = 2.75;
  // **Open-ended: a post has no caps, because neither can ever be seen.** The
  // foot stands on the ground, so a closed bottom disc lies in the ground's own
  // plane — and its outline hull's copy, drawn `BackSide`, faces *up* into it
  // (`check:coplanar`: terrain|post outline, 0.05 m² at a 7.9 mm stand-off on
  // seeds 4 and 9, wherever a stall is seated on ground that happens to lie
  // flat under its feet). The top disc is inside the knob: at the post's top
  // the faceted knob's section is at least 0.138 m in radius (inscribed, 12
  // sides) against the post's 0.12 — 0.136 with its outline. A hidden face is
  // deleted, never nudged (ART_DIRECTION §7) —
  // the same fix the rail race's trestle trunk took for its foot.
  for (const side of [-1, 1] as const) {
    const post = solid(
      new Mesh(new CylinderGeometry(0.12, 0.13, postHeight, 10, 1, true), creamMaterial),
    );
    post.position.set(side * (halfWidth - 0.12), postHeight / 2, 1.25);
    root.add(post);
    addOutline(post, 0.016);

    // Barber-pole rings rather than a spiral texture: five rings is cheaper
    // than a canvas and reads the same at gameplay distance.
    for (let i = 0; i < 5; i += 1) {
      const ring = decal(
        new Mesh(new TorusGeometry(0.135, 0.045, 6, 14), i % 2 === 0 ? accentMaterial : stripeMaterial),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(side * (halfWidth - 0.12), 0.35 + i * 0.52, 1.25);
      root.add(ring);
    }

    const knob = solid(new Mesh(new SphereGeometry(0.16, 12, 9), accentMaterial));
    knob.position.set(side * (halfWidth - 0.12), postHeight + 0.08, 1.25);
    knob.scale.set(1, 1.15, 1);
    root.add(knob);
  }

  // --- striped awning -------------------------------------------------------
  const awning = new Group();
  awning.position.set(0, 2.72, 0.15);
  awning.rotation.x = -0.22;
  root.add(awning);

  const stripes = 9;
  const stripeWidth = STALL_WIDTH / stripes;
  const awningDepth = 1.85;
  // One scallop shape for every stripe of this booth — see `scallopGeometry`.
  const scallopShape = scallopGeometry(stripeWidth * SCALLOP_LENGTH_OF_STRIPE);
  for (let i = 0; i < stripes; i += 1) {
    const x = -halfWidth + (i + 0.5) * stripeWidth;
    const material = i % 2 === 0 ? accentMaterial : stripeMaterial;

    const cloth = solid(new Mesh(new BoxGeometry(stripeWidth, AWNING_CLOTH_THICKNESS, awningDepth), material));
    cloth.position.set(x, 0, 0);
    awning.add(cloth);

    // The scalloped valance: a half-cylinder hanging off the front edge of each
    // stripe. This one detail is most of why the booth reads as "fairground".
    const scallop = solid(new Mesh(scallopShape, material));
    scallop.position.set(x, -SCALLOP_DROP, awningDepth / 2);
    awning.add(scallop);
  }

  // NO SIGN BOARD. Every stall used to be crowned with a painted board on two
  // struts saying what game it was; the family had all of them taken out of the
  // park on 28 July 2026 because they are hard to read at the camera's one
  // fixed angle. The struts went with the board rather than being left holding
  // nothing. What the stall is called arrives on its sign card the moment a
  // child selects the booth — see `minigames/stalls.ts`'s `interactZones`, which
  // reads the same four fields off the same {@link StallDefinition} the board
  // used to be painted from.

  // --- bunting between the posts -------------------------------------------
  const bunting = new Group();
  root.add(bunting);
  const flags = 9;
  const flagMeshes: Mesh[] = [];
  for (let i = 0; i < flags; i += 1) {
    const t = (i + 0.5) / flags;
    const x = -halfWidth + t * STALL_WIDTH;
    // A sag curve, so the string hangs rather than being pinned in a line.
    const sag = Math.sin(t * Math.PI) * 0.28;
    const flag = decal(
      new Mesh(
        new ConeGeometry(0.13, 0.32, 3),
        i % 3 === 0 ? accentMaterial : i % 3 === 1 ? stripeMaterial : toonMaterial(PALETTE.markerLemon),
      ),
    );
    flag.position.set(x, 2.05 - sag, 1.42);
    flag.rotation.x = Math.PI;
    flag.userData.baseY = flag.position.y;
    flag.userData.phase = i * 0.7;
    bunting.add(flag);
    flagMeshes.push(flag);
  }

  // --- prizes on the shelf ---------------------------------------------------
  const prizeColours = [PALETTE.markerLemon, PALETTE.markerMint, PALETTE.markerLilac];
  prizeColours.forEach((colour, index) => {
    const prize = solid(new Mesh(new SphereGeometry(0.19, 14, 11), toonMaterial(colour)));
    prize.scale.set(1, 0.88, 1);
    prize.position.set(-0.9 + index * 0.9, 1.29, 1.02);
    root.add(prize);
    addOutline(prize, 0.014);

    const ear = decal(new Mesh(new SphereGeometry(0.075, 10, 8), toonMaterial(colour)));
    ear.position.set(-0.9 + index * 0.9 - 0.11, 1.45, 0.99);
    ear.scale.set(0.7, 1.3, 0.7);
    root.add(ear);
  });

  return {
    root,
    height: 4.4,
    update(elapsed: number): void {
      // The flags flutter out of step with each other — nothing in this park is
      // ever quite still. (The board that used to sway beside them is gone; see
      // the note where it was built.)
      for (const flag of flagMeshes) {
        const phase = flag.userData.phase as number;
        flag.rotation.z = Math.sin(elapsed * 2.3 + phase) * 0.22;
        flag.position.y = (flag.userData.baseY as number) + Math.sin(elapsed * 3.1 + phase) * 0.025;
      }
    },
    dispose(): void {
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
    },
  };
}

/** Thickness of one awning stripe's cloth slab. */
const AWNING_CLOTH_THICKNESS = 0.11;
/** Radius of the half-cylinder scallop on the front edge of each stripe. */
const SCALLOP_RADIUS = 0.22;
/** How far the scallop's axis sits below the middle of its cloth. */
const SCALLOP_DROP = 0.1;
/** The scallop's length as a share of its stripe's width — a hair short, so neighbours read as separate. */
const SCALLOP_LENGTH_OF_STRIPE = 0.96;
/** Facets round the scallop's half-circle. */
const SCALLOP_SEGMENTS = 12;

/**
 * **The scallop on the front edge of an awning stripe, with the part of its
 * end caps that is buried inside the cloth cut away.**
 *
 * The scallop is a half-cylinder lying along the stripe, a hair shorter than
 * it ({@link SCALLOP_LENGTH_OF_STRIPE}), with its axis on the cloth's front
 * edge. So a good part of each end cap is *inside* the cloth slab, standing
 * 9 mm in from the slab's own end face and pointing the same way.
 * `check:coplanar` reported those as a seam on every stall in the park — 0.19
 * m² of shared plane on the dodgems — and `ART_DIRECTION.md` §7 says the cure
 * is to delete the face nobody can see, not to hold the two apart. The tube
 * itself is untouched and the cap keeps every part of itself that is outside
 * the cloth: in front of it, under it and above it. Nothing on screen changes.
 *
 * Built in the stripe's own frame, axis along X, origin on the axis: the tube
 * is the upper half (`y >= 0`), and the cloth occupies
 * `SCALLOP_DROP ± AWNING_CLOTH_THICKNESS / 2` in Y and everything behind the
 * axis (`z <= 0`) in Z. The caps are cut into convex pieces along the cloth's
 * top, bottom and front planes, so neighbouring pieces share whole edges and
 * leave no T-junction inside the cap.
 */
function scallopGeometry(length: number): BufferGeometry {
  // The tube: an open half-cylinder, stood on its side the way the old mesh
  // was turned with `rotation.z = PI / 2` — baked in here instead.
  const tube = new CylinderGeometry(
    SCALLOP_RADIUS,
    SCALLOP_RADIUS,
    length,
    SCALLOP_SEGMENTS,
    1,
    true,
    0,
    Math.PI,
  )
    .rotateZ(Math.PI / 2)
    .toNonIndexed();

  // After that turn a rim point at angle t is (y, z) = (R sin t, R cos t).
  const rim: [number, number][] = [];
  for (let k = 0; k <= SCALLOP_SEGMENTS; k += 1) {
    const t = (k / SCALLOP_SEGMENTS) * Math.PI;
    rim.push([SCALLOP_RADIUS * Math.sin(t), SCALLOP_RADIUS * Math.cos(t)]);
  }
  /** The whole half-disc three.js would have capped the tube with. */
  const halfDisc: [number, number][] = [[0, 0], ...rim];

  const clothBottom = SCALLOP_DROP - AWNING_CLOTH_THICKNESS / 2;
  const clothTop = SCALLOP_DROP + AWNING_CLOTH_THICKNESS / 2;
  // A half-plane is `a·y + b·z <= c`.
  type HalfPlane = readonly [a: number, b: number, c: number];
  const inFront: HalfPlane = [0, -1, 0];
  const behind: HalfPlane = [0, 1, 0];
  const belowCloth: HalfPlane = [1, 0, clothBottom];
  const aboveBottom: HalfPlane = [-1, 0, -clothBottom];
  const belowTop: HalfPlane = [1, 0, clothTop];
  const aboveCloth: HalfPlane = [-1, 0, -clothTop];
  const pieces = [
    // In front of the cloth: all of it shows, cut at the cloth's two planes
    // only so its edges meet the pieces behind it vertex for vertex.
    clip(halfDisc, [inFront, belowCloth]),
    clip(halfDisc, [inFront, aboveBottom, belowTop]),
    clip(halfDisc, [inFront, aboveCloth]),
    // Behind the front edge: only what hangs below the cloth, and what rises
    // above it. The band between is inside the slab, and is what goes.
    clip(halfDisc, [behind, belowCloth]),
    clip(halfDisc, [behind, aboveCloth]),
  ];

  const capPositions: number[] = [];
  for (const side of [-1, 1] as const) {
    const x = (side * length) / 2;
    for (const piece of pieces) {
      for (let i = 1; i + 1 < piece.length; i += 1) {
        type Corner = [number, number];
        const corners = [piece[0], piece[i], piece[i + 1]] as [Corner, Corner, Corner];
        // Wind each triangle to face out along this end's own X.
        const [[y0, z0], [y1, z1], [y2, z2]] = corners;
        const facingX = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0);
        if (Math.abs(facingX) < 1e-12) continue;
        const ordered: Corner[] = Math.sign(facingX) === side ? corners : [corners[0], corners[2], corners[1]];
        for (const [y, z] of ordered) capPositions.push(x, y, z);
      }
    }
  }
  const caps = new BufferGeometry();
  const vertexCount = capPositions.length / 3;
  caps.setAttribute('position', new BufferAttribute(new Float32Array(capPositions), 3));
  const capNormals = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v += 1) capNormals[v * 3] = Math.sign(capPositions[v * 3] as number);
  caps.setAttribute('normal', new BufferAttribute(capNormals, 3));
  caps.setAttribute('uv', new BufferAttribute(new Float32Array(vertexCount * 2), 2));

  const merged = mergeGeometries([tube, caps]);
  if (!merged) throw new Error('stallProp: the scallop tube and caps would not merge');
  tube.dispose();
  caps.dispose();
  return merged;
}

/**
 * Sutherland–Hodgman: a convex polygon in (y, z), kept to the side of each
 * half-plane `a·y + b·z <= c`.
 */
function clip(
  polygon: readonly [number, number][],
  planes: readonly (readonly [number, number, number])[],
): [number, number][] {
  let out: [number, number][] = [...polygon];
  for (const [a, b, c] of planes) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i += 1) {
      const p = input[i] as [number, number];
      const q = input[(i + 1) % input.length] as [number, number];
      const dp = a * p[0] + b * p[1] - c;
      const dq = a * q[0] + b * q[1] - c;
      if (dp <= 0) out.push(p);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}
