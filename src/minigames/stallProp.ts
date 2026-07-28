import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
  for (const side of [-1, 1] as const) {
    const post = solid(new Mesh(new CylinderGeometry(0.12, 0.13, postHeight, 10), creamMaterial));
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
  for (let i = 0; i < stripes; i += 1) {
    const x = -halfWidth + (i + 0.5) * stripeWidth;
    const material = i % 2 === 0 ? accentMaterial : stripeMaterial;

    const cloth = solid(new Mesh(new BoxGeometry(stripeWidth, 0.11, awningDepth), material));
    cloth.position.set(x, 0, 0);
    awning.add(cloth);

    // The scalloped valance: a half-cylinder hanging off the front edge of each
    // stripe. This one detail is most of why the booth reads as "fairground".
    const scallop = solid(new Mesh(new CylinderGeometry(0.22, 0.22, stripeWidth * 0.96, 12, 1, false, 0, Math.PI), material));
    scallop.rotation.z = Math.PI / 2;
    scallop.position.set(x, -0.1, awningDepth / 2);
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
