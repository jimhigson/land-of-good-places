import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { PALETTE } from '../../core/palette';
import { pinkStoneTexture, signTexture, woodTexture } from '../../core/textures';
import { toonMaterial } from '../../art/style/materials';
import { terrainHeight } from '../terrain';
import { markAsSign } from '../signs';
import { gameStore } from '../../state';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import { buildPawPrint } from './catBus';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_STOP_X,
  ENTRANCE_STOP_Z,
} from './layout';

/**
 * The park entrance: a gated arch in the boundary wall with the park's own
 * name over it, and a little bus stop with a shelter just inside — always
 * present, whether or not the cat bus is mid-arrival. See `Garden.ts`'s
 * `buildBoundaryWall` for the matching gap left in the wall itself, and
 * `paths.ts`'s `spur-entrance` route for the path that leads up to it.
 */
export class Entrance implements GameSystem {
  readonly name = 'entrance';
  readonly group = new Group();

  private readonly signBoard: Mesh;
  private readonly signFace: Mesh;
  private lastParkName = '';
  private readonly unsubscribe: () => void;

  constructor(collision: CollisionWorld) {
    this.group.name = 'entrance';

    const stoneMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(2, 1) });
    const capMaterial = toonMaterial(PALETTE.stonePinkLight);

    // --- the gate arch ---------------------------------------------------
    const halfWidth = 4.3;
    const postHeight = 3.3;
    const postGeometry = new CylinderGeometry(0.42, 0.5, postHeight, 12);
    // The posts sit either side of the gate along the wall's own tangent —
    // perpendicular to the radius out to `ENTRANCE_GATE_X/Z` — so the arch
    // reads as a gap cut straight through the ring, whatever angle it is at.
    const tangentX = -Math.sin(ENTRANCE_ANGLE);
    const tangentZ = Math.cos(ENTRANCE_ANGLE);

    for (const side of [-1, 1] as const) {
      const x = ENTRANCE_GATE_X + side * halfWidth * tangentX;
      const z = ENTRANCE_GATE_Z + side * halfWidth * tangentZ;
      const ground = terrainHeight(x, z);

      const post = new Mesh(postGeometry, stoneMaterial);
      post.position.set(x, ground + postHeight / 2, z);
      post.castShadow = true;
      post.receiveShadow = true;
      this.group.add(post);

      const cap = new Mesh(new SphereGeometry(0.62, 14, 10), capMaterial);
      cap.position.set(x, ground + postHeight + 0.15, z);
      cap.scale.set(1, 0.75, 1);
      cap.castShadow = true;
      this.group.add(cap);

      // Nudged back towards the gate centre from the post's own position.
      const pawA = buildPawPrint(toonMaterial(PALETTE.stonePinkDark));
      pawA.position.set(x - side * 0.46 * tangentX, ground + postHeight * 0.55, z - side * 0.46 * tangentZ);
      pawA.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      pawA.scale.setScalar(1.6);
      this.group.add(pawA);

      collision.addCircle(x, z, 0.55);
    }

    // A curved crossbar joining the two posts, following the wall's own
    // pink-stone material family so the gate reads as part of the boundary,
    // not a separate prop dropped in front of it.
    const crossbar = new Mesh(new TorusGeometry(halfWidth, 0.28, 10, 24, Math.PI), capMaterial);
    const archGround = terrainHeight(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
    crossbar.position.set(ENTRANCE_GATE_X, archGround + postHeight + 0.15, ENTRANCE_GATE_Z);
    crossbar.rotation.z = Math.PI;
    crossbar.rotation.y = Math.PI / 2;
    crossbar.castShadow = true;
    this.group.add(crossbar);

    // --- the hanging name sign --------------------------------------------
    this.signBoard = new Mesh(
      new BoxGeometry(2.9, 1.5, 0.12),
      new MeshStandardMaterial({ color: PALETTE.signBoard, roughness: 0.85 }),
    );
    this.signBoard.name = 'entrance-sign';
    this.signBoard.position.set(ENTRANCE_GATE_X, archGround + postHeight - 0.55, ENTRANCE_GATE_Z);
    this.signBoard.rotation.y = Math.PI; // faces inward, towards the park and the default camera
    this.signBoard.castShadow = true;
    this.signBoard.userData.baseY = this.signBoard.position.y;
    markAsSign(this.signBoard, 2.9, 1.5);
    this.group.add(this.signBoard);

    this.signFace = new Mesh(
      new PlaneGeometry(2.7, 1.32),
      new MeshBasicMaterial({ toneMapped: false }),
    );
    this.signFace.position.z = 0.07;
    this.signBoard.add(this.signFace);
    this.refreshSign(gameStore.get().parkName);
    this.unsubscribe = gameStore.subscribe((state) => this.refreshSign(state.parkName));

    // --- the bus stop shelter ----------------------------------------------
    // Set back on the eastern verge of the entrance road, so the cat bus's
    // curb-side door opens directly onto it.
    const shelterX = ENTRANCE_STOP_X + 3.5;
    const shelterZ = ENTRANCE_STOP_Z;
    const shelterGround = terrainHeight(shelterX, shelterZ);
    const woodMaterial = toonMaterial(0xffffff, { map: woodTexture(2, 1) });

    const shelterPostGeometry = new CylinderGeometry(0.14, 0.16, 2.3, 8);
    for (const dz of [-1, 1] as const) {
      const post = new Mesh(shelterPostGeometry, woodMaterial);
      post.position.set(shelterX, shelterGround + 1.15, shelterZ + dz * 0.9);
      post.castShadow = true;
      post.receiveShadow = true;
      this.group.add(post);
      collision.addCircle(post.position.x, post.position.z, 0.2);
    }

    const canopy = new Mesh(
      new BoxGeometry(1.6, 0.14, 2.3),
      toonMaterial(PALETTE.buildingTrim),
    );
    canopy.position.set(shelterX + 0.3, shelterGround + 2.3, shelterZ);
    canopy.rotation.z = 0.1;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    this.group.add(canopy);

    const bench = new Mesh(new BoxGeometry(1.4, 0.42, 0.5), woodMaterial);
    bench.position.set(shelterX, shelterGround + 0.21, shelterZ);
    bench.castShadow = true;
    bench.receiveShadow = true;
    this.group.add(bench);

    const stopSignPost = new Mesh(new CylinderGeometry(0.07, 0.08, 1.9, 8), woodMaterial);
    stopSignPost.position.set(shelterX - 0.9, shelterGround + 0.95, shelterZ + 1.3);
    stopSignPost.castShadow = true;
    this.group.add(stopSignPost);
    collision.addCircle(stopSignPost.position.x, stopSignPost.position.z, 0.18);

    const stopSignBoard = new Mesh(
      new BoxGeometry(0.6, 0.6, 0.06),
      new MeshBasicMaterial({
        map: signTexture({
          title: 'Bus Stop',
          glyph: '🚌',
          accent: PALETTE.markerLemon,
        }),
        toneMapped: false,
      }),
    );
    stopSignBoard.position.set(0, 0.75, 0.04);
    stopSignPost.add(stopSignBoard);

    const pawB = buildPawPrint(toonMaterial(PALETTE.stonePinkDark));
    pawB.position.set(shelterX, shelterGround + 0.02, shelterZ - 1.1);
    pawB.rotation.x = -Math.PI / 2;
    pawB.scale.setScalar(2.1);
    this.group.add(pawB);
  }

  /** Signs sway gently, same as every other sign in the park (`AnchorPlots.ts`). */
  update({ elapsed }: FrameContext): void {
    this.signBoard.rotation.z = Math.sin(elapsed * 1.05) * 0.03;
    this.signBoard.position.y = (this.signBoard.userData.baseY as number) + Math.sin(elapsed * 1.5) * 0.03;
  }

  dispose(): void {
    this.unsubscribe();
  }

  private refreshSign(parkName: string): void {
    if (parkName === this.lastParkName) return;
    this.lastParkName = parkName;
    const material = this.signFace.material as MeshBasicMaterial;
    material.map?.dispose();
    material.map = signTexture({
      title: parkName,
      subtitle: 'welcome!',
      glyph: '🐾',
      accent: PALETTE.markerPink,
    });
    material.needsUpdate = true;
  }
}
