import {
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { ART } from '../../art/style/artPalette';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { createFacePatch, css } from '../../art/style/faces';

/**
 * The little room the Spooky House opens into.
 *
 * "A dim cosy room" — dim comes from colour temperature, not from actually
 * turning the lights down: `MeshToonMaterial` needs enough light hitting it for
 * the four-band ramp to read at all (ARCHITECTURE.md's "do not darken the first
 * band" applies here just as much as out in the park), so cosiness comes from
 * a deep dark-green-on-dark-grey palette (see the palette note below — this
 * used to be plum-purple, reworked after Jim's PR #294 feedback) and one warm
 * lantern, rather than from low lux. Nothing here is
 * meant to be looked at for long — the big face is the point — so it stays
 * simple: a floor, a single back wall the face sits on (a wide `CylinderGeometry`
 * arc, not two separate side walls — the camera's frame never reaches far
 * enough round to see a seam, so one arc covers it), a rug, a hanging lantern,
 * and a pair of grinning jack-o-lanterns for company.
 *
 * The room's palette was reworked after Jim's PR #294 preview note: "the
 * background should also be generally dark and spooky artwork in it such as
 * spider webs, dark green on dark grey". `ART.statueStoneDark` (already the
 * park's one "dark grey" — see its own doc comment for why it is warm, not
 * neutral) is the walls; `ART.spookyGreen` is the rug and trim; the floor
 * takes `PALETTE.ink` itself, the one colour in the whole game the rulebook
 * calls "the darkest value anywhere" — nothing here goes past it. Two
 * corner cobwebs (`createCobwebTexture`) are the "spooky artwork": the same
 * painted-canvas-decal technique every face and marking in this park already
 * uses (ART_DIRECTION.md §3/§7), not a new one.
 */

export interface SpookyRoom {
  readonly root: Group;
  /** The lantern glows a little brighter/dimmer over time — call every frame. */
  update(elapsed: number): void;
  dispose(): void;
}

let cobwebTextureCache: CanvasTexture | null = null;

/**
 * A simple corner cobweb, painted the same way `art/style/faces.ts` paints a
 * face: flat ink-tinted lines on a transparent canvas, cached and reused
 * (`ART_DIRECTION.md` §7's "canvas-drawn only, cached by key" — this is one
 * texture shared by both corners, mirrored in `createCobwebMesh` rather than
 * painted twice). Radial threads from the corner plus a few connecting arcs —
 * enough to read as a web at gameplay distance, nothing fussier: this is
 * "fun-spooky, not scary-scary" set dressing (GAME_DESIGN.md), so the web is
 * a friendly cartoon prop, not a photoreal texture.
 */
function createCobwebTexture(): CanvasTexture {
  if (cobwebTextureCache) return cobwebTextureCache;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint the cobweb.');

  // Anchored at the top-left corner of the canvas — the mesh gets tucked into
  // an actual room corner, so the web should visibly spring from one.
  const originX = 0;
  const originY = 0;
  const reach = size * 1.32;

  ctx.strokeStyle = css(ART.cream);
  ctx.globalAlpha = 0.62;
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.012;

  // Radial threads.
  const strandCount = 6;
  const strandAngle = Math.PI / 2 / (strandCount - 1);
  for (let i = 0; i < strandCount; i += 1) {
    const angle = i * strandAngle;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(originX + Math.cos(angle) * reach, originY + Math.sin(angle) * reach);
    ctx.stroke();
  }

  // Connecting arcs, evenly spaced out from the corner, linking the strands
  // into a proper web rather than a spray of lines.
  const ringCount = 4;
  for (let r = 1; r <= ringCount; r += 1) {
    const radius = (reach / (ringCount + 0.6)) * r;
    ctx.beginPath();
    ctx.arc(originX, originY, radius, 0, Math.PI / 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  cobwebTextureCache = texture;
  return texture;
}

/**
 * One corner cobweb decal. `mirror` flips it so the same texture (drawn
 * anchored at its own top-left) can dress both top corners of the back wall
 * without a second canvas.
 */
function createCobwebMesh(mirror: boolean): Mesh {
  const material = toonMaterial(0xffffff, { map: createCobwebTexture(), transparent: true, depthWrite: false });
  material.alphaTest = 0.02;
  const mesh = decal(new Mesh(new PlaneGeometry(2.1, 2.1), material));
  mesh.name = 'spookyHouse:cobweb';
  mesh.renderOrder = 2;
  if (mirror) mesh.scale.x = -1;
  return mesh;
}

export function createSpookyRoom(): SpookyRoom {
  const root = new Group();
  root.name = 'spookyHouse:room';

  // `DoubleSide`: the room's camera sits inside this cylinder's radius, looking
  // at the *concave* face of an open arc (`CylinderGeometry`'s side normals
  // point radially outward, away from the axis — correct for something you
  // walk around, wrong for something you stand inside). `FrontSide` (the
  // default) culled every triangle here, which is exactly the "mesh present,
  // wound the wrong way for this camera" trap CLAUDE.md's hood-face writeup
  // describes — see `BallPit.ts`'s open-ended cylinder wall and
  // `SlideRide.ts`'s chute for the same shape of fix already established in
  // this codebase.
  const wallMaterial = toonMaterial(ART.statueStoneDark, { side: DoubleSide });
  const wallDarkMaterial = toonMaterial(0x645766); // ART.statueStoneDark mixed 50/50 toward PALETTE.ink — a shadow step, never past ink itself.
  const floorMaterial = toonMaterial(PALETTE.ink); // the darkest surface in the room takes the darkest colour the game allows.
  const rugMaterial = toonMaterial(ART.spookyGreen);
  const trimMaterial = toonMaterial(ART.spookyGreen);

  // --- floor + rug -----------------------------------------------------------
  const floor = solid(new Mesh(new CylinderGeometry(9, 9, 0.3, 28), floorMaterial));
  floor.position.y = -0.15;
  root.add(floor);

  const rug = decal(new Mesh(new CylinderGeometry(3.6, 3.6, 0.05, 28), rugMaterial));
  rug.position.y = 0.02;
  rug.scale.set(1, 1, 0.72);
  root.add(rug);
  const rugRing = decal(new Mesh(new TorusGeometry(3.6, 0.14, 8, 28), trimMaterial));
  rugRing.rotation.x = Math.PI / 2;
  rugRing.position.y = 0.03;
  rugRing.scale.set(1, 0.72, 1);
  root.add(rugRing);

  // --- back wall (the face lives on this one) --------------------------------
  const back = solid(new Mesh(new CylinderGeometry(9, 9, 8, 28, 1, true, -Math.PI * 0.42, Math.PI * 0.84), wallMaterial));
  back.position.set(0, 3.85, 0.6);
  back.rotation.y = Math.PI;
  root.add(back);

  // A soft picture-frame moulding around where the face sits, so the face reads
  // as "the thing on the wall" rather than melting into it.
  const frame = decal(new Mesh(new TorusGeometry(3.05, 0.22, 10, 6, Math.PI * 1.98), wallDarkMaterial));
  frame.position.set(0, 4.1, -5.55);
  root.add(frame);

  // --- spider webs, tucked into the wall/ceiling corners either side of the
  // face — the "spooky artwork" half of Jim's PR #294 note.
  const cobwebLeft = createCobwebMesh(false);
  cobwebLeft.position.set(-3.35, 7.05, -4.55);
  cobwebLeft.rotation.z = 0.18;
  root.add(cobwebLeft);

  const cobwebRight = createCobwebMesh(true);
  cobwebRight.position.set(3.35, 7.05, -4.55);
  cobwebRight.rotation.z = -0.18;
  root.add(cobwebRight);

  // --- ceiling -----------------------------------------------------------------
  const ceiling = solid(new Mesh(new CylinderGeometry(9, 9, 0.3, 28), wallDarkMaterial));
  ceiling.position.y = 7.7;
  root.add(ceiling);

  // --- hanging lantern ---------------------------------------------------------
  const lanternGroup = new Group();
  lanternGroup.position.set(0, 5.6, -1.6);
  root.add(lanternGroup);

  const cord = solid(new Mesh(new CylinderGeometry(0.03, 0.03, 1.9, 6), wallDarkMaterial));
  cord.position.y = 1.05;
  lanternGroup.add(cord);

  const hood = solid(new Mesh(new ConeGeometry(0.42, 0.34, 10, 1, true), trimMaterial));
  lanternGroup.add(hood);

  const glassMaterial = toonMaterial(PALETTE.markerLemon, { emissive: PALETTE.markerLemon, emissiveIntensity: 0.9 });
  const glass = solid(new Mesh(new SphereGeometry(0.34, 14, 10), glassMaterial));
  glass.position.y = -0.22;
  lanternGroup.add(glass);

  const glow = decal(
    new Mesh(
      new CircleGeometry(1.4, 20),
      new MeshBasicMaterial({
        color: PALETTE.markerLemon,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    ),
  );
  glow.position.set(0, -0.2, 0.01);
  lanternGroup.add(glow);

  const lanternLight = new PointLight(PALETTE.markerLemon, 3.2, 11, 2);
  lanternLight.position.set(0, -0.15, 0.3);
  lanternGroup.add(lanternLight);

  // --- two grinning jack-o-lanterns, one either side --------------------------
  const rng = new Rng(0x5c00c1);
  for (const side of [-1, 1] as const) {
    const pumpkin = new Group();
    pumpkin.position.set(side * 3.35, 0.42, -3.6);
    root.add(pumpkin);

    const body = solid(
      new Mesh(new SphereGeometry(0.42, 16, 12), toonMaterial(PALETTE.markerLemon)),
    );
    body.scale.set(1, 0.86, 1);
    pumpkin.add(body);
    addOutline(body, 0.012);

    for (let i = 0; i < 6; i += 1) {
      const rib = decal(
        new Mesh(new TorusGeometry(0.42, 0.02, 5, 10, Math.PI), toonMaterial(0xf2c94c)),
      );
      rib.rotation.y = (i / 6) * Math.PI * 2;
      rib.rotation.x = Math.PI / 2;
      pumpkin.add(rib);
    }

    const stem = solid(new Mesh(new CylinderGeometry(0.05, 0.07, 0.18, 6), toonMaterial(PALETTE.leafMid)));
    stem.position.y = 0.46;
    pumpkin.add(stem);

    // A tiny grinning face patch — same painted-face technique as every
    // character in the park, just at a much smaller size.
    const face = createFacePatch({
      radius: 0.42,
      size: 256,
      eyeY: 0.42,
      eyeGap: 0.4,
      eyeW: 0.1,
      eyeH: 0.13,
      mouth: 'grin',
      mouthW: 0.16,
      mouthDrop: 0.22,
      blush: null,
      spreadX: 1.5,
      spreadY: 1.5,
    });
    face.setExpression(rng.chance(0.5) ? 'happy' : 'neutral');
    pumpkin.add(face.mesh);
  }

  return {
    root,
    update(elapsed: number): void {
      // A gentle candle-flicker rather than a steady bulb.
      lanternLight.intensity = 2.9 + Math.sin(elapsed * 5.3) * 0.25 + Math.sin(elapsed * 11.1) * 0.12;
    },
    dispose(): void {
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
    },
  };
}
