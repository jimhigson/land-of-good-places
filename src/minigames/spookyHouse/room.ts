import {
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { createFacePatch } from '../../art/style/faces';

/**
 * The little room the Spooky House opens into.
 *
 * "A dim cosy room" — dim comes from colour temperature, not from actually
 * turning the lights down: `MeshToonMaterial` needs enough light hitting it for
 * the four-band ramp to read at all (ARCHITECTURE.md's "do not darken the first
 * band" applies here just as much as out in the park), so cosiness is a deep
 * plum-purple palette and one warm lantern rather than low lux. Nothing here is
 * meant to be looked at for long — the big face is the point — so it stays
 * simple: a floor, a back wall the face sits on, two short side walls, a rug,
 * a hanging lantern, and a pair of grinning jack-o-lanterns for company.
 */

export interface SpookyRoom {
  readonly root: Group;
  /** The lantern glows a little brighter/dimmer over time — call every frame. */
  update(elapsed: number): void;
  dispose(): void;
}

export function createSpookyRoom(): SpookyRoom {
  const root = new Group();
  root.name = 'spookyHouse:room';

  const wallMaterial = toonMaterial(PALETTE.markerLilac);
  const wallDarkMaterial = toonMaterial(0x6a4f8a);
  const floorMaterial = toonMaterial(0x3f2f52);
  const rugMaterial = toonMaterial(PALETTE.markerMint);
  const trimMaterial = toonMaterial(PALETTE.markerMint);

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
