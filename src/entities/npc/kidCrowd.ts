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
import { CROWD_HAIR_STYLES, type HairStyle } from '../../art/models/hair';
import { CROWD_BACKPACK_KINDS, type BackpackKind } from '../../art/models/backpacks';
import { visibleTop } from '../../art/style/measure';
import { toonMaterial } from '../../art/style/materials';
import { ART } from '../../art/style/artPalette';
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

/**
 * Extra eye colours the crowd bakes as their own face-material set, on top of
 * the default (violet, `ART.kidEye`) the prototype already paints — one of
 * these used to be reserved just for Ethan (a family request: always blue),
 * generalised here so the whole crowd can vary, not just him.
 *
 * These are a *subset* of `art/models/kid.ts`'s `KID_EYE_COLOURS` — the
 * character creator offers `Hazel` and `Grey` too, but those only ever paint
 * the player's own, un-instanced face. Baking them here would cost a full
 * extra `FACE_ORDER.length` textures apiece for variety an instanced crowd of
 * near-identical children does not need. Three keeps the crowd's own face
 * budget at `(3 + 1) × FACE_ORDER.length` = 12 canvases (up from 6 before
 * this feature) — see the doc comment on {@link EYE_VARIANT_COUNT}.
 */
const EYE_VARIANTS: readonly number[] = [ART.kidEyeBlue, ART.kidEyeBrown, ART.kidEyeGreen];

/**
 * How many face materials one eye variant occupies in the shared list — one
 * per {@link FACE_ORDER} entry.
 */
const EYE_VARIANT_OFFSET = FACE_ORDER.length;

/**
 * How many distinct eye-colour variants a child can be spawned with: the
 * default plus every entry in {@link EYE_VARIANTS}. Valid `eyeVariant`
 * arguments to {@link KidCrowd.spawn} are `0..EYE_VARIANT_COUNT - 1`.
 */
export const EYE_VARIANT_COUNT = EYE_VARIANTS.length + 1;

/** The variant index reserved for Ethan's family-requested blue eyes. */
export const BLUE_EYE_VARIANT = EYE_VARIANTS.indexOf(ART.kidEyeBlue) + 1;

/** How many of the biggest parts cast a shadow. Head, body and bag. */
const SHADOW_CASTER_PARTS = 3;

/**
 * The style the prototype is built wearing.
 *
 * Only matters for which parts happen to be `visible` on the prototype after
 * construction — the crowd reads geometry and hierarchy, not visibility — but
 * it does decide what {@link KidCrowd.modelHeight} measures, so it is named
 * rather than left as a bare string in two places.
 */
const PROTOTYPE_STYLE: HairStyle = 'bunches';

/**
 * The backpack the prototype is built wearing.
 *
 * Same reasoning as {@link PROTOTYPE_STYLE}: the crowd reads geometry, not
 * visibility, so this only decides what happens to be `visible` on a model
 * nobody ever renders — but naming it beats a bare string in three places.
 */
const PROTOTYPE_BACKPACK: BackpackKind = 'satchel';

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
  /**
   * Per style, the parts a child wearing it must **not** show.
   *
   * This is how the crowd gets nine silhouettes out of one prototype. The
   * prototype carries every style's hair at once (`CROWD_HAIR_STYLES`), each
   * mesh tagged by the model with the styles it belongs to, and a member
   * simply zeroes the matrices of the ones that are not its own — see
   * `InstancedCrowd`'s `shown`. A second crowd per hairstyle would be twenty-odd
   * more draw calls apiece, which is more than the rest of the children cost
   * put together.
   *
   * It replaces a positional guess ("hair-coloured, on the head, off to one
   * side") that only ever had to tell bunches from no-bunches. Nine styles is
   * well past what a heuristic can do, and the model already knows the answer.
   */
  private readonly hiddenParts: ReadonlyMap<HairStyle, readonly number[]>;
  /**
   * Per bag, the parts a child wearing it must **not** show.
   *
   * {@link hiddenParts}'s twin, built the same way out of the same kind of
   * model-supplied tags — see `art/models/backpacks.ts`'s `BackpackPart`. The
   * straps belong to every kind, so they are in nobody's hidden list and every
   * child keeps them.
   */
  private readonly hiddenBags: ReadonlyMap<BackpackKind, readonly number[]>;
  /** Bare height per style — spikes reach 0.2 m higher than a bob. */
  private readonly heights: ReadonlyMap<HairStyle, number>;
  private readonly fixedColours: readonly number[];

  constructor(capacity: number) {
    const handle = createKid({
      skin: SENTINEL_SKIN,
      hair: SENTINEL_HAIR,
      outfit: SENTINEL_OUTFIT,
      shoe: SENTINEL_SHOE,
      backpackColour: SENTINEL_BAG,
      hairStyle: PROTOTYPE_STYLE,
      // Every style a background child can wear, built into the one prototype.
      // The floor-length simulated ponytail is deliberately not among them —
      // see `CROWD_HAIR_STYLES` for the full reasoning.
      hairStyles: CROWD_HAIR_STYLES,
      backpack: true,
      backpackKind: PROTOTYPE_BACKPACK,
      // Every bag a background child can wear, built into the one prototype —
      // exactly what `hairStyles` above does for hair. The two creature-head
      // bags are deliberately not among them; see `CROWD_BACKPACK_KINDS`.
      backpackKinds: CROWD_BACKPACK_KINDS,
    });

    this.prototype = handle.root;
    this.modelHeight = handle.height;

    // Ask the model how tall it is wearing each style in turn, rather than
    // tabulating nine numbers here that would go stale the first time anybody
    // retuned the hair.
    const heights = new Map<HairStyle, number>();
    for (const style of CROWD_HAIR_STYLES) {
      handle.setHairStyle(style);
      heights.set(style, visibleTop(handle.root));
    }
    handle.setHairStyle(PROTOTYPE_STYLE);
    this.heights = heights;

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

    // One throwaway kid per extra eye colour — never added to any scene
    // graph — exists only to paint that colour's version of the same
    // expression set. Discarded once its textures are captured below; see
    // `EYE_VARIANTS`/`EYE_VARIANT_OFFSET`.
    const variantFaceMaps: Map<Expression, Texture | null>[] = EYE_VARIANTS.map((eyeColour) => {
      const maps = new Map<Expression, Texture | null>();
      if (!faceMesh) return maps;
      const variantHandle = createKid({
        skin: SENTINEL_SKIN,
        hair: SENTINEL_HAIR,
        outfit: SENTINEL_OUTFIT,
        shoe: SENTINEL_SHOE,
        backpackColour: SENTINEL_BAG,
        hairStyle: 'bunches',
        backpack: true,
        eyeColour,
      });
      const variantFaceMesh = findFaceMesh(variantHandle.root);
      if (variantFaceMesh) {
        const variantMaterial = variantFaceMesh.material as MeshToonMaterial;
        for (const expression of FACE_ORDER) {
          variantHandle.setExpression(expression);
          maps.set(expression, variantMaterial.map);
        }
      }
      return maps;
    });

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
      // Each extra eye variant appended in turn, at `variantIndex * EYE_VARIANT_OFFSET`.
      for (const maps of variantFaceMaps) {
        for (const expression of FACE_ORDER) {
          const clone = base.clone();
          clone.map = maps.get(expression) ?? base.map;
          faceMaterials.push(clone);
        }
      }
    }

    // Only the parts that carry the silhouette cast a shadow. Every caster is
    // drawn again in the shadow pass, so a whole child casting is twice a
    // child's worth of draw calls for a soft blob on the grass that a head and
    // a body already produce.
    //
    // Hair is excluded from the contest outright. Since the prototype carries
    // every style at once, the biggest mesh on it is now whichever style has
    // the widest merged geometry — the long curtain, whose two face-framing
    // strands put its bounding sphere near a metre — and letting that win
    // would push the *body* out of the top three and leave every child in the
    // park casting a shadow shaped like somebody else's hairstyle.
    const hairMeshes = new Set(handle.hairParts.map((part) => part.mesh));
    const casters = new Set(
      largestParts(this.prototype, SHADOW_CASTER_PARTS, (mesh) => !hairMeshes.has(mesh)),
    );

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

    // Invert the model's "this mesh belongs to these styles" into the crowd's
    // "wearing this style, hide these part indices".
    const hidden = new Map<HairStyle, number[]>();
    for (const style of CROWD_HAIR_STYLES) hidden.set(style, []);
    for (const part of handle.hairParts) {
      const index = sources.indexOf(part.mesh as Mesh);
      if (index < 0) continue;
      for (const style of CROWD_HAIR_STYLES) {
        if (!part.styles.includes(style)) hidden.get(style)?.push(index);
      }
    }
    this.hiddenParts = hidden;

    const hiddenBags = new Map<BackpackKind, number[]>();
    for (const kind of CROWD_BACKPACK_KINDS) hiddenBags.set(kind, []);
    for (const part of handle.backpackParts) {
      const index = sources.indexOf(part.mesh as Mesh);
      if (index < 0) continue;
      for (const kind of CROWD_BACKPACK_KINDS) {
        if (!part.kinds.includes(kind)) hiddenBags.get(kind)?.push(index);
      }
    }
    this.hiddenBags = hiddenBags;
  }

  /**
   * Adds a child. `scale` varies height a little — children are not clones, and
   * at this camera a 6% difference in height reads more strongly than a hat.
   * `hairStyle` must be one of {@link CROWD_HAIR_STYLES}; anything else would
   * hide every hair part and leave a bald child.
   * `eyeVariant` selects one of the face-material sets baked in the
   * constructor — `0` for the default violet, `1..EYE_VARIANTS.length` for
   * the extras (see {@link EYE_VARIANT_COUNT}, {@link BLUE_EYE_VARIANT}).
   * `backpack` must be one of {@link CROWD_BACKPACK_KINDS}; anything else
   * would hide every bag part and leave a child in bare straps.
   */
  spawn(
    colours: KidColours,
    hairStyle: HairStyle,
    scale: number,
    eyeVariant = 0,
    backpack: BackpackKind = PROTOTYPE_BACKPACK,
  ): KidAvatar {
    const member = this.crowd.spawn();
    member.root.scale.setScalar(scale);

    for (let part = 0; part < this.roles.length; part += 1) {
      this.crowd.setPartColour(member, part, this.colourFor(part, colours));
    }

    for (const part of this.hiddenParts.get(hairStyle) ?? []) member.shown[part] = 0;
    for (const part of this.hiddenBags.get(backpack) ?? []) member.shown[part] = 0;

    const rig = resolveRig(member.root);
    const facePart = this.facePartIndex;

    return {
      rig,
      member,
      headBaseY: rig.head.position.y,
      // This child's own style, not the prototype's: a name label sized off
      // `modelHeight` would sit inside a spiky-haired child's hair.
      height: (this.heights.get(hairStyle) ?? this.modelHeight) * scale,
      setExpression: (expression: Expression) => {
        if (facePart < 0) return;
        const variant = FACE_ORDER.indexOf(expression);
        const base = variant < 0 ? 0 : variant;
        member.variant[facePart] = base + eyeVariant * EYE_VARIANT_OFFSET;
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
 * The `count` bulkiest meshes in a model, by bounding radius, among those
 * `eligible` accepts.
 *
 * Chosen by size rather than by name so that retuning the model — or renaming
 * a part, or swapping the hair for a hat — still picks whatever is now doing
 * the work of being the character's outline.
 */
function largestParts(prototype: Object3D, count: number, eligible: (mesh: Mesh) => boolean): Mesh[] {
  const measured: { mesh: Mesh; radius: number }[] = [];
  prototype.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    // Skip the ink outlines: an outline is by construction bigger than the part
    // it wraps, so it would win every size contest, and the crowd does not draw
    // them anyway.
    if (object.material instanceof MeshBasicMaterial) return;
    if (!eligible(object)) return;
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
