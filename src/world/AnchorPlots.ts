import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { TAU } from '../core/mathUtils';
import { signTexture } from '../core/textures';
import { terrainHeight } from './terrain';
import { ANCHORS, anchorGroupName, type AnchorDefinition, type AnchorId } from './anchors';
import { createFerrisWheelProp, type FerrisWheelProp } from '../minigames/ferrisWheel/wheelProp';
import { markAsSign } from './signs';
import type { FrameContext, GameSystem } from '../core/types';
import type { CollisionWorld } from './Collision';

/**
 * The reserved building plots.
 *
 * Each anchor gets an empty `Group` (named `anchor:<id>`) that later steps fill
 * with the real ride or building, plus a placeholder: a marked-out area of
 * ground, bunting posts and a cute "coming soon" sign.
 *
 * To build a feature here:
 * ```ts
 * const plot = anchorPlots.getGroup('ferrisWheel');
 * plot.add(myFerrisWheel);            // local space, origin at the plot centre
 * anchorPlots.setPlaceholderVisible('ferrisWheel', false);
 * ```
 * The group sits at the plot centre with its origin on the ground, so children
 * can be authored around (0, 0, 0).
 */
export class AnchorPlots implements GameSystem {
  readonly name = 'anchorPlots';
  readonly group = new Group();

  private readonly contentGroups = new Map<AnchorId, Group>();
  private readonly placeholders = new Map<AnchorId, Group>();
  private readonly signs: Mesh[] = [];
  /** The one plot that has been built on. Null until the wheel goes up. */
  private ferrisWheel: FerrisWheelProp | null = null;

  constructor(collision: CollisionWorld) {
    this.group.name = 'anchor-plots';

    for (const anchor of ANCHORS) {
      const [x, z] = anchor.position;
      const ground = terrainHeight(x, z);

      // The group later steps build into.
      const content = new Group();
      content.name = anchorGroupName(anchor.id);
      content.position.set(x, ground, z);
      content.userData.anchor = anchor;
      this.group.add(content);
      this.contentGroups.set(anchor.id, content);

      // The temporary decoration, kept separate so it can be hidden in one call.
      const placeholder = buildPlaceholder(anchor, collision);
      content.add(placeholder);
      this.placeholders.set(anchor.id, placeholder);

      const sign = placeholder.getObjectByName('sign-face');
      if (sign instanceof Mesh) this.signs.push(sign);

      // The Space Ferris Wheel is built. The wheel goes up on its plot, the
      // "coming soon" dressing comes down, and the sign that stood at the
      // entrance is replaced by the ride's own ticket kiosk — which the
      // mini-game framework builds from the row in `minigames/stalls.ts`, at
      // this same entrance point. See `minigames/ferrisWheel/`.
      if (anchor.id === 'ferrisWheel') {
        this.ferrisWheel = createFerrisWheelProp(anchor, collision);
        content.add(this.ferrisWheel.root);
        placeholder.visible = false;
      }
    }
  }

  /** The group to add real content to. Origin is the plot centre, on the ground. */
  getGroup(id: AnchorId): Group {
    const group = this.contentGroups.get(id);
    if (!group) throw new Error(`Unknown anchor: ${id}`);
    return group;
  }

  /** Hide the "coming soon" dressing once the real thing exists. */
  setPlaceholderVisible(id: AnchorId, visible: boolean): void {
    const placeholder = this.placeholders.get(id);
    if (placeholder) placeholder.visible = visible;
  }

  update({ dt, elapsed }: FrameContext): void {
    this.ferrisWheel?.update(dt, elapsed);

    // Signs sway very slightly, as if on a breezy afternoon.
    for (let i = 0; i < this.signs.length; i += 1) {
      const sign = this.signs[i];
      if (!sign) continue;
      sign.rotation.z = Math.sin(elapsed * 1.1 + i * 1.7) * 0.035;
      sign.position.y = sign.userData.baseY + Math.sin(elapsed * 1.6 + i) * 0.035;
    }
  }
}

/** Builds the whole "coming soon" dressing for one plot, in plot-local space. */
function buildPlaceholder(anchor: AnchorDefinition, collision: CollisionWorld): Group {
  const placeholder = new Group();
  placeholder.name = 'placeholder';

  const [cx, cz] = anchor.position;
  const ground = terrainHeight(cx, cz);

  // --- marked-out ground ---------------------------------------------------
  // Unlit on purpose: a lit material turned the plot into a dark slab at dusk,
  // when it most needs to read as "something is coming here".
  const patchMaterial = new MeshBasicMaterial({
    color: anchor.accent,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const patch =
    anchor.footprint.kind === 'circle'
      ? new Mesh(new CylinderGeometry(anchor.footprint.radius, anchor.footprint.radius, 0.02, 44), patchMaterial)
      : new Mesh(
          new BoxGeometry(anchor.footprint.halfX * 2, 0.02, anchor.footprint.halfZ * 2),
          patchMaterial,
        );
  patch.position.y = 0.07;
  placeholder.add(patch);

  // A dashed outline of little pegs so the plot edge is legible from above.
  // Instanced: there are ~30 per plot across five plots, and as individual
  // meshes they alone accounted for well over a third of the frame's draw calls.
  const outline = outlinePoints(anchor);
  const pegs = new InstancedMesh(
    new ConeGeometry(0.16, 0.55, 7),
    new MeshStandardMaterial({ color: anchor.accent, roughness: 0.6, metalness: 0 }),
    outline.length,
  );
  pegs.name = 'plot-pegs';
  pegs.castShadow = true;

  const pegMatrix = new Matrix4();
  const pegPosition = new Vector3();
  const pegRotation = new Quaternion();
  const pegScale = new Vector3(1, 1, 1);
  outline.forEach((point, index) => {
    const worldX = cx + point.x;
    const worldZ = cz + point.z;
    pegPosition.set(point.x, terrainHeight(worldX, worldZ) - ground + 0.28, point.z);
    pegMatrix.compose(pegPosition, pegRotation, pegScale);
    pegs.setMatrixAt(index, pegMatrix);
  });
  pegs.instanceMatrix.needsUpdate = true;
  placeholder.add(pegs);

  // --- the sign -------------------------------------------------------------
  const [ex, ez] = anchor.entrance;
  const signX = ex - cx;
  const signZ = ez - cz;
  const signGround = terrainHeight(ex, ez) - ground;

  const signGroup = new Group();
  signGroup.name = 'sign';
  signGroup.position.set(signX, signGround, signZ);
  signGroup.rotation.y = anchor.signYaw;
  placeholder.add(signGroup);

  const postMaterial = new MeshStandardMaterial({
    color: PALETTE.wood,
    roughness: 0.9,
    metalness: 0,
  });
  const postGeometry = new CylinderGeometry(0.12, 0.14, 2.2, 8);
  for (const offset of [-1.05, 1.05]) {
    const post = new Mesh(postGeometry, postMaterial);
    post.position.set(offset, 1.1, 0);
    post.castShadow = true;
    post.receiveShadow = true;
    signGroup.add(post);
  }

  const boardBack = new Mesh(
    new BoxGeometry(2.6, 1.5, 0.12),
    new MeshStandardMaterial({ color: PALETTE.woodLight, roughness: 0.85 }),
  );
  boardBack.position.y = 2.05;
  boardBack.castShadow = true;
  boardBack.receiveShadow = true;
  boardBack.userData.baseY = 2.05;
  boardBack.name = 'sign-face';
  // Tappable, for the "inspect" camera — see `world/signs.ts`.
  markAsSign(boardBack, 2.6, 1.5);
  signGroup.add(boardBack);

  const face = new Mesh(
    new PlaneGeometry(2.44, 1.37),
    new MeshBasicMaterial({
      map: signTexture({
        title: anchor.signTitle,
        subtitle: anchor.signSubtitle,
        glyph: anchor.glyph,
        accent: anchor.accent,
      }),
      // Front only: from behind you should see the plain wooden board, not
      // mirrored writing.
      toneMapped: false,
    }),
  );
  face.position.z = 0.07;
  boardBack.add(face);

  // A bobble on top, because everything in this park has a bobble on top.
  const bobble = new Mesh(
    new SphereGeometry(0.2, 12, 9),
    new MeshStandardMaterial({ color: anchor.accent, roughness: 0.5 }),
  );
  bobble.position.set(0, 0.92, 0);
  bobble.castShadow = true;
  boardBack.add(bobble);

  // A ring of bunting-ish hoops at the plot centre so it reads as "reserved"
  // even before you get close enough to read the sign.
  const hoop = new Mesh(
    new TorusGeometry(1.6, 0.09, 8, 30),
    new MeshStandardMaterial({
      color: anchor.accent,
      roughness: 0.5,
      emissive: anchor.accent,
      emissiveIntensity: 0.15,
    }),
  );
  hoop.rotation.x = Math.PI / 2;
  hoop.position.y = 0.5;
  hoop.castShadow = true;
  placeholder.add(hoop);

  // Sign posts are solid; the plot itself is walkable so kids can run about in
  // the space before the ride exists.
  collision.addCircle(ex, ez, 0.5);

  return placeholder;
}

/** Points around the plot edge, in plot-local space, for the marker pegs. */
function outlinePoints(anchor: AnchorDefinition): Vector3[] {
  const points: Vector3[] = [];
  if (anchor.footprint.kind === 'circle') {
    const count = Math.max(10, Math.round(anchor.footprint.radius * 2.4));
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU;
      points.push(
        new Vector3(
          Math.cos(angle) * anchor.footprint.radius,
          0,
          Math.sin(angle) * anchor.footprint.radius,
        ),
      );
    }
  } else {
    const { halfX, halfZ } = anchor.footprint;
    const step = 2.6;
    for (let x = -halfX; x <= halfX; x += step) {
      points.push(new Vector3(x, 0, -halfZ), new Vector3(x, 0, halfZ));
    }
    for (let z = -halfZ + step; z < halfZ; z += step) {
      points.push(new Vector3(-halfX, 0, z), new Vector3(halfX, 0, z));
    }
  }
  return points;
}
