import {
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  type Material,
  type Texture,
} from 'three';
import { createKid } from '../../art/models/kid';
import { toonMaterial } from '../../art/style/materials';
import type { Expression } from '../../art/style/faces';
import { InstancedCrowd, type CrowdMember } from './InstancedCrowd';

/**
 * The park's children, drawn as one crowd.
 *
 * Everything here exists to answer one question: how do you get a dozen
 * differently-coloured copies of {@link createKid} on screen without either
 * re-authoring the model or spending the whole draw-call budget?
 *
 * The answer is to build **one** kid with deliberately absurd colours — pure
 * red skin, pure green hair — and then read it. Every material whose colour
 * comes back as one of those sentinels is identified by the *role* it plays,
 * and the crowd repaints that part per child through `instanceColor`. Nothing
 * in `art/models/kid.ts` is touched or duplicated, so when the model is retuned
 * the crowd simply inherits it.
 *
 * The sentinels also have to account for the two shades the model derives for
 * itself (`hair × 0.86`, `outfit × 0.82`); those are recomputed here with the
 * identical `Color` maths, which is why they match exactly rather than
 * approximately.
 */

/** Absurd, unmistakable, and nowhere in the palette — that is the whole point. */
const SENTINEL_SKIN = 0xff0000;
const SENTINEL_HAIR = 0x00ff00;
const SENTINEL_OUTFIT = 0x0000ff;
const SENTINEL_SHOE = 0xffff00;
const SENTINEL_BAG = 0xff00ff;

/** The two shades `kid.ts` derives, computed exactly as it computes them. */
const SENTINEL_HAIR_DARK = new Color(SENTINEL_HAIR).multiplyScalar(0.86).getHex();
const SENTINEL_OUTFIT_DARK = new Color(SENTINEL_OUTFIT).multiplyScalar(0.82).getHex();
const SENTINEL_BAG_DARK = new Color(SENTINEL_BAG).multiplyScalar(0.82).getHex();

export type ColourRole =
  | 'skin'
  | 'hair'
  | 'hairDark'
  | 'outfit'
  | 'outfitDark'
  | 'shoe'
  | 'bag'
  | 'bagDark'
  | 'face'
  | 'fixed';

/** The colours that make one child look like nobody else in the park. */
export interface KidColours {
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  readonly shoe: number;
  readonly bag: number;
}

/** Node names stamped on the prototype so each member can find its joints. */
const NODE_BODY = 'npc.body';
const NODE_HEAD = 'npc.head';
const NODE_LEFT_ARM = 'npc.leftArm';
const NODE_RIGHT_ARM = 'npc.rightArm';
const NODE_LEFT_LEG = 'npc.leftLeg';
const NODE_RIGHT_LEG = 'npc.rightLeg';

/** Face variants, in the order they become instance variants. */
const FACE_ORDER: readonly Expression[] = ['neutral', 'happy', 'blink'];

/** How many of the biggest parts cast a shadow. Head, hair and body. */
const SHADOW_CASTER_PARTS = 3;

/** The joints a walk cycle needs, resolved once per child. */
export interface KidRig {
  readonly root: Object3D;
  readonly body: Object3D;
  readonly head: Object3D;
  readonly leftArm: Object3D;
  readonly rightArm: Object3D;
  readonly leftLeg: Object3D;
  readonly rightLeg: Object3D;
}

/** One child in the crowd: a rig to pose and a face to swap. */
export interface KidAvatar {
  readonly rig: KidRig;
  readonly member: CrowdMember;
  /** Resting head height, read off the prototype so a retune carries through. */
  readonly headBaseY: number;
  /** Total height in metres, after this child's own scale. */
  readonly height: number;
  setExpression(expression: Expression): void;
}

export class KidCrowd {
  readonly crowd: InstancedCrowd;
  /** Height of the unscaled model, straight from the model file. */
  readonly modelHeight: number;

  private readonly prototype: Object3D;
  private readonly roles: readonly ColourRole[];
  private readonly facePartIndex: number;
  /** Parts that make up the side bunches — hidden to give a short-hair child. */
  private readonly sideHairParts: readonly number[];
  private readonly fixedColours: readonly number[];

  constructor(capacity: number) {
    const handle = createKid({
      skin: SENTINEL_SKIN,
      hair: SENTINEL_HAIR,
      outfit: SENTINEL_OUTFIT,
      shoe: SENTINEL_SHOE,
      backpackColour: SENTINEL_BAG,
      hairStyle: 'bunches',
      backpack: true,
    });

    this.prototype = handle.root;
    this.modelHeight = handle.height;

    // Name the joints so every member can find its own copies by name.
    handle.body.name = NODE_BODY;
    handle.head.name = NODE_HEAD;
    handle.limbs.leftArm.name = NODE_LEFT_ARM;
    handle.limbs.rightArm.name = NODE_RIGHT_ARM;
    handle.limbs.leftLeg.name = NODE_LEFT_LEG;
    handle.limbs.rightLeg.name = NODE_RIGHT_LEG;

    // Collect one texture per expression by asking the model to wear each in
    // turn and noting which map it swapped to. The model owns its own canvases;
    // this only borrows references to them.
    const faceMesh = findFaceMesh(this.prototype);
    const faceMaps = new Map<Expression, Texture | null>();
    if (faceMesh) {
      const faceMaterial = faceMesh.material as MeshToonMaterial;
      for (const expression of FACE_ORDER) {
        handle.setExpression(expression);
        faceMaps.set(expression, faceMaterial.map);
      }
      handle.setExpression('neutral');
    }

    // One material for the entire crowd. Colour comes from `instanceColor`, so
    // white here means "whatever this child was painted".
    const bodyMaterial = toonMaterial(0xffffff);

    const faceMaterials: Material[] = [];
    if (faceMesh) {
      const base = faceMesh.material as MeshToonMaterial;
      for (const expression of FACE_ORDER) {
        const clone = base.clone();
        clone.map = faceMaps.get(expression) ?? base.map;
        faceMaterials.push(clone);
      }
    }

    // Only the parts that carry the silhouette cast a shadow. Every caster is
    // drawn again in the shadow pass, so a whole child casting is twice a
    // child's worth of draw calls for a soft blob on the grass that a head and
    // a body already produce.
    const casters = new Set(largestParts(this.prototype, SHADOW_CASTER_PARTS));

    this.crowd = new InstancedCrowd(this.prototype, capacity, {
      materialsFor: (source) =>
        source === faceMesh && faceMaterials.length > 0 ? faceMaterials : [bodyMaterial],
      castShadowFor: (source) => casters.has(source),
      receiveShadow: false,
    });

    const sources = this.crowd.partSources;
    this.facePartIndex = faceMesh ? sources.indexOf(faceMesh) : -1;
    this.roles = sources.map((source) => classify(source, source === faceMesh));
    this.fixedColours = sources.map((source) => materialColour(source));
    this.sideHairParts = sources
      .map((source, index) => ({ source, index }))
      .filter(({ source, index }) => isSideHair(source, this.roles[index] ?? 'fixed'))
      .map(({ index }) => index);
  }

  /**
   * Adds a child. `scale` varies height a little — children are not clones, and
   * at this camera a 6% difference in height reads more strongly than a hat.
   */
  spawn(colours: KidColours, shortHair: boolean, scale: number): KidAvatar {
    const member = this.crowd.spawn();
    member.root.scale.setScalar(scale);

    for (let part = 0; part < this.roles.length; part += 1) {
      this.crowd.setPartColour(member, part, this.colourFor(part, colours));
    }

    if (shortHair) {
      for (const part of this.sideHairParts) member.shown[part] = 0;
    }

    const rig = resolveRig(member.root);
    const facePart = this.facePartIndex;

    return {
      rig,
      member,
      headBaseY: rig.head.position.y,
      height: this.modelHeight * scale,
      setExpression: (expression: Expression) => {
        if (facePart < 0) return;
        const variant = FACE_ORDER.indexOf(expression);
        member.variant[facePart] = variant < 0 ? 0 : variant;
      },
    };
  }

  dispose(): void {
    this.crowd.dispose();
  }

  private colourFor(part: number, colours: KidColours): number {
    switch (this.roles[part]) {
      case 'skin':
        return colours.skin;
      case 'hair':
        return colours.hair;
      case 'hairDark':
        return new Color(colours.hair).multiplyScalar(0.86).getHex();
      case 'outfit':
        return colours.outfit;
      case 'outfitDark':
        return new Color(colours.outfit).multiplyScalar(0.82).getHex();
      case 'shoe':
        return colours.shoe;
      case 'bag':
        return colours.bag;
      case 'bagDark':
        return new Color(colours.bag).multiplyScalar(0.82).getHex();
      case 'face':
        return 0xffffff;
      default:
        return this.fixedColours[part] ?? 0xffffff;
    }
  }
}

// ------------------------------------------------------------------ helpers

function materialColour(mesh: Mesh): number {
  const material = mesh.material;
  if (Array.isArray(material)) return 0xffffff;
  const colour = (material as { color?: Color }).color;
  return colour ? colour.getHex() : 0xffffff;
}

function classify(mesh: Mesh, isFace: boolean): ColourRole {
  if (isFace) return 'face';
  switch (materialColour(mesh)) {
    case SENTINEL_SKIN:
      return 'skin';
    case SENTINEL_HAIR:
      return 'hair';
    case SENTINEL_HAIR_DARK:
      return 'hairDark';
    case SENTINEL_OUTFIT:
      return 'outfit';
    case SENTINEL_OUTFIT_DARK:
      return 'outfitDark';
    case SENTINEL_SHOE:
      return 'shoe';
    case SENTINEL_BAG:
      return 'bag';
    case SENTINEL_BAG_DARK:
      return 'bagDark';
    default:
      // Bobbles, hair ties and anything a future retune adds: every child wears
      // it in whatever colour the model chose.
      return 'fixed';
  }
}

/**
 * Is this part one of the side bunches?
 *
 * Hiding those parts is how the crowd gets a second hair silhouette without a
 * second crowd — a whole extra set of instanced meshes for one hairstyle is
 * twenty-odd draw calls, which is more than the rest of the children cost
 * together. The test is positional rather than by name so that it keeps working
 * if the bunches are moved or resized: hair-coloured, on the head, off to one
 * side. Ears sit in the same place but are skin, so they stay.
 */
function isSideHair(mesh: Mesh, role: ColourRole): boolean {
  if (role === 'skin' || role === 'face') return false;
  if (mesh.parent?.name !== NODE_HEAD) return false;
  return Math.abs(mesh.position.x) > 0.25;
}

/**
 * The `count` bulkiest meshes in a model, by bounding radius.
 *
 * Chosen by size rather than by name so that retuning the model — or renaming
 * a part, or swapping the hair for a hat — still picks whatever is now doing
 * the work of being the character's outline.
 */
function largestParts(prototype: Object3D, count: number): Mesh[] {
  const measured: { mesh: Mesh; radius: number }[] = [];
  prototype.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    // Skip the ink outlines: an outline is by construction bigger than the part
    // it wraps, so it would win every size contest, and the crowd does not draw
    // them anyway.
    if (object.material instanceof MeshBasicMaterial) return;
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    const radius = object.geometry.boundingSphere?.radius ?? 0;
    const scale = Math.max(object.scale.x, object.scale.y, object.scale.z);
    measured.push({ mesh: object, radius: radius * scale });
  });
  measured.sort((a, b) => b.radius - a.radius);
  return measured.slice(0, count).map((entry) => entry.mesh);
}

function findFaceMesh(prototype: Object3D): Mesh | null {
  let found: Mesh | null = null;
  prototype.traverse((object) => {
    if (found) return;
    if (object instanceof Mesh && object.name === 'facePatch') found = object;
  });
  return found;
}

function resolveRig(root: Object3D): KidRig {
  const find = (name: string): Object3D => root.getObjectByName(name) ?? root;
  return {
    root,
    body: find(NODE_BODY),
    head: find(NODE_HEAD),
    leftArm: find(NODE_LEFT_ARM),
    rightArm: find(NODE_RIGHT_ARM),
    leftLeg: find(NODE_LEFT_LEG),
    rightLeg: find(NODE_RIGHT_LEG),
  };
}
