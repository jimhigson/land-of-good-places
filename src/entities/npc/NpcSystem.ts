import { Group, Object3D, Vector3 } from 'three';
import { ART } from '../../art/style/artPalette';
import { PALETTE } from '../../core/palette';
import { KID_SKIN_TONES } from '../../art/models/kid';
import { Rng, TAU } from '../../core/mathUtils';
import type { FrameContext, GameSystem } from '../../core/types';
import type { IsoCamera } from '../../core/IsoCamera';
import { circleSeparation, MAX_DEPENETRATION_SPEED, type CollisionWorld } from '../../world/Collision';
import { PLAYER_RADIUS } from '../../core/constants';
import type { GroundSampler, Player } from '../Player';
import { NameLabel } from '../../ui/NameLabel';
import { InstancedCrowd, type CrowdMember } from './InstancedCrowd';
import { BLUE_EYE_VARIANT, EYE_VARIANT_COUNT, KidCrowd, type KidColours } from './kidCrowd';
import { NpcCharacter, NPC_RADIUS } from './NpcCharacter';
import { PoiGraph } from './poiGraph';
import { createPetBlob, PET_BODY_NODE, PET_HEAD_NODE } from './petBlob';
import { WanderDriver, type ClimberBudget } from './wanderDriver';
import type { ClimbableTreeSeed } from '../../world/Scenery';

/**
 * Caps how many children climb trees across the whole park at once (see
 * `world/TreeClimbing.ts` and the climbing block in `wanderDriver.ts`). One
 * shared budget, handed to every driver, keeps a lucky run of coin flips from
 * putting half the crowd up in the branches at the same time.
 */
const MAX_CONCURRENT_CLIMBERS = 3;

/**
 * The children who were already in the park when you arrived.
 *
 * A dozen of them, wandering the paths between the fountain, the ball pit, the
 * door of the big building and the plots where the rides are coming. Two have
 * brought a blob pet. They wave if you come near, and if you hop, the ones who
 * saw you hop back.
 *
 * The park was not *un*finished without them, but it was uninhabited, and an
 * empty park reads as a tech demo however much is in it. This is the cheapest
 * thing in the game per unit of "somewhere real".
 *
 * ### How it is put together
 *
 * Three pieces, each with its own file and none of them knowing much about the
 * others:
 *
 * - `kidCrowd.ts` **draws** them, by instancing a prototype of the same
 *   `createKid()` the player wears — about thirty draw calls for the whole
 *   crowd rather than thirty per child.
 * - `NpcCharacter` **moves** them, with the player's movement code and the
 *   player's collision world.
 * - `wanderDriver.ts` **decides** for them, and is the only part that has
 *   anything to say about behaviour.
 *
 * Swapping the third for a driver fed from the network turns these into remote
 * players without touching the other two. That is the whole reason for the
 * split — see `driver.ts`.
 *
 * ### Cost
 *
 * Every child is instanced and every child shares one toon material, so adding
 * the thirteenth costs nothing but a matrix. Behaviour for children far from
 * the camera runs at half rate. Nothing in the frame path allocates.
 */

/** Children in the park. Enough to feel populated, few enough to feel like a park. */
const NPC_COUNT = 12;

/** …and two of them brought something. */
const PET_COUNT = 2;

/** Fixed seed: the same children, in the same clothes, on every reload. */
const NPC_SEED = 20260726;

/** Closer than this and two children push each other apart. */
const SEPARATION = NPC_RADIUS * 2;

/**
 * Closer than this and a child pushes gently apart from the player instead of
 * walking through them (design feedback #31d — "player↔NPC collision").
 * Exactly the same combined-radii idea as {@link SEPARATION}, just with the
 * player's own girth on one side instead of a second child's.
 */
const PLAYER_SEPARATION = NPC_RADIUS + PLAYER_RADIUS;

/** Beyond this from the player, behaviour runs every other frame. */
const FAR_DISTANCE = 34;

/** How far behind its child a pet trails, in metres. */
const PET_TRAIL = 1.15;

/**
 * A cute, curated, deliberately international cast — the family asked for
 * name labels, so the children needed names. No duplicates within one park:
 * `pickNames` below draws from this pool without replacement.
 *
 * `ETHAN_NAME` is reserved out of the general draw — see {@link ETHAN_INDEX}.
 */
const ETHAN_NAME = 'Ethan';
const KID_NAMES: readonly string[] = [
  ETHAN_NAME,
  'Amara',
  'Bodhi',
  'Cleo',
  'Dara',
  'Elowen',
  'Finn',
  'Gaia',
  'Hana',
  'Iris',
  'Jasper',
  'Kiko',
  'Luca',
  'Mira',
  'Noor',
  'Ola',
  'Priya',
  'Quinn',
  'Rosa',
  'Sana',
  'Theo',
  'Uma',
  'Vera',
  'Wren',
  'Yara',
  'Zara',
  'Aiko',
  'Hugo',
  'Ines',
  'Milo',
];

/**
 * Ethan's fixed spawn slot — a family request: a blonde, blue-eyed boy named
 * Ethan is always somewhere in the park, not just "usually". Fixed to an
 * index rather than picked by the seeded `rng` so he survives any reordering
 * of the random draws around him.
 */
const ETHAN_INDEX = 0;

/** Softer and quieter than the player's pink label, so Eleri still stands out. */
const NPC_LABEL_ACCENT = PALETTE.markerSky;
/** A touch smaller than the player's label — see `NameLabel`'s `sizeScale`. */
const NPC_LABEL_SCALE = 0.82;
/** How high above a child's own height their label floats. */
const LABEL_HEIGHT_OFFSET = 0.34;
/** Only the nearest handful of labels show at once — a dozen name pills is clutter. */
const VISIBLE_LABEL_CAP = 10;

/**
 * Colour choices, all of them already named in `PALETTE` or `ART`.
 *
 * Skin tones are drawn from `KID_SKIN_TONES` — the same hand-picked, inclusive
 * range the character creator offers the player (see `art/models/kid.ts`),
 * rather than one base hue scaled darker: a uniform scale drifts warm skin
 * towards grey at the low end, and never actually reaches a deep tone. Every
 * child in the park should look plausibly reachable from the creator's own
 * swatch row.
 */

const HAIR_COLOURS = [
  PALETTE.hair,
  ART.ripikaTip,
  ART.corgiTan,
  ART.biscuitFurDark,
  PALETTE.ink,
  ART.ripikaYellow,
  PALETTE.blossomPink,
  ART.miniLilac,
] as const;

const OUTFIT_COLOURS = [
  PALETTE.outfit,
  PALETTE.markerMint,
  PALETTE.markerSky,
  PALETTE.markerLemon,
  PALETTE.markerLilac,
  ART.jumperRed,
  ART.miniLilac,
  ART.corgiTan,
  ART.heartPink,
] as const;

const SHOE_COLOURS = [
  PALETTE.shoe,
  ART.jumperRed,
  PALETTE.markerLemon,
  PALETTE.markerLilac,
  ART.miniBelly,
] as const;

const BAG_COLOURS = [
  ART.kidBackpack,
  PALETTE.markerLemon,
  PALETTE.markerPink,
  ART.miniBelly,
  ART.corgiTan,
] as const;

/** A pet, and the child it belongs to. */
interface Pet {
  readonly owner: NpcCharacter;
  readonly root: Object3D;
  readonly body: Object3D;
  readonly head: Object3D;
  readonly member: CrowdMember;
  /** Smoothed position, so it does not snap about behind its child. */
  readonly position: Vector3;
  facing: number;
  bounce: number;
}

export class NpcSystem implements GameSystem {
  readonly name = 'npcs';
  readonly group = new Group();

  private readonly kids: KidCrowd;
  private readonly pets: InstancedCrowd;
  private readonly graph: PoiGraph;
  private readonly characters: NpcCharacter[] = [];
  private readonly petList: Pet[] = [];
  private readonly labels: NameLabel[] = [];
  /** Scratch distance-to-camera per character, reused every frame — see `updateLabels`. */
  private readonly labelDistances: Float32Array;
  /** Character indices, kept sorted nearest-first every frame. */
  private readonly labelOrder: number[] = [];
  private readonly playerPosition = new Vector3();
  private frame = 0;
  /**
   * Set by `attachPlayer`, once the player exists — `null` for the handful of
   * frames before `World.attachPlayer` runs. Needed (rather than just the
   * position `FrameContext` already hands every system) because pushing the
   * player gently apart from a child means calling `Player.nudge`, which only
   * the real instance has.
   */
  private player: Player | null = null;

  constructor(
    collision: CollisionWorld,
    private readonly camera: IsoCamera,
    groundSampler: GroundSampler | null = null,
    // Trees big enough to climb — threaded down into every child's wander
    // driver so it can decide, on its own, whether one is worth stopping at.
    // Empty by default so nothing here breaks if a caller has none to offer.
    climbableTrees: readonly ClimbableTreeSeed[] = [],
  ) {
    this.group.name = 'npcs';

    const rng = new Rng(NPC_SEED);
    // A separate stream for names, so shuffling the cast never shifts which
    // colours/hairstyles/paces the seeded `rng` above hands to which slot.
    const nameRng = new Rng(NPC_SEED + 424242);
    const otherNames = pickNames(nameRng, NPC_COUNT - 1);
    let nameCursor = 0;

    this.graph = new PoiGraph(collision);
    this.kids = new KidCrowd(NPC_COUNT);
    this.group.add(this.kids.crowd.group);

    const spawnNodes = this.graph.spawnNodes();
    const climberBudget: ClimberBudget = { active: 0, max: MAX_CONCURRENT_CLIMBERS };

    for (let i = 0; i < NPC_COUNT; i += 1) {
      const node = spawnNodes[Math.floor((i / NPC_COUNT) * spawnNodes.length)];
      if (!node) break;

      // Ethan is a family request: always present, always a blonde,
      // blue-eyed boy. Every `rng` call below still fires in the same order
      // for every slot — only the results for his slot are overridden — so
      // moving him would not reshuffle anyone else's look.
      const isEthan = i === ETHAN_INDEX;
      const name = isEthan ? ETHAN_NAME : (otherNames[nameCursor++] ?? ETHAN_NAME);

      const rolledColours = pickColours(rng);
      const colours = isEthan ? { ...rolledColours, hair: ART.kidHairBlonde } : rolledColours;

      const shortHairRoll = rng.chance(0.35);
      const shortHair = isEthan ? true : shortHairRoll;

      // Ethan's blue eyes are pinned to their own variant; everyone else
      // rolls across the crowd's whole eye-colour range (see `kidCrowd.ts`'s
      // `EYE_VARIANT_COUNT`), same spirit as the skin/hair/outfit rolls above.
      const eyeVariant = isEthan ? BLUE_EYE_VARIANT : rng.int(0, EYE_VARIANT_COUNT - 1);

      const avatar = this.kids.spawn(colours, shortHair, rng.range(0.86, 1.04), eyeVariant);
      // Forces the face variant to match immediately — otherwise a
      // child whose expression never transitions away from the default
      // 'neutral' would never call `setExpression` and Ethan would show the
      // crowd's normal (non-blue) eyes until the first blink.
      avatar.setExpression('neutral');

      const driver = new WanderDriver({
        graph: this.graph,
        rng: new Rng(NPC_SEED + i * 977),
        startNode: node.index,
        pace: rng.range(0.85, 1.12),
        climbableTrees,
        climberBudget,
      });

      const character = new NpcCharacter(
        avatar,
        driver,
        collision,
        node.x + rng.range(-0.8, 0.8),
        node.z + rng.range(-0.8, 0.8),
        rng.range(-Math.PI, Math.PI),
        name,
      );
      character.groundSampler = groundSampler;
      character.setWalkPhase(rng.range(0, TAU));
      this.characters.push(character);

      const label = new NameLabel(name, NPC_LABEL_ACCENT, NPC_LABEL_SCALE);
      label.sprite.position.set(
        character.position.x,
        character.position.y + avatar.height + LABEL_HEIGHT_OFFSET,
        character.position.z,
      );
      this.group.add(label.sprite);
      this.labels.push(label);
      this.labelOrder.push(i);
    }

    this.labelDistances = new Float32Array(this.characters.length);

    // --- pets ----------------------------------------------------------------
    const petPrototype = createPetBlob();
    this.pets = new InstancedCrowd(petPrototype.root, PET_COUNT, {
      // Pets keep their own materials — there is only one kind of blob, so
      // there is nothing to repaint per instance.
      materialsFor: (source) => (Array.isArray(source.material) ? [] : [source.material]),
      castShadowFor: () => false,
      receiveShadow: false,
    });
    this.group.add(this.pets.group);

    for (let i = 0; i < PET_COUNT && i < this.characters.length; i += 1) {
      // Give them to children some way apart in the spawn order, so both pets
      // are not in the same corner of the park.
      const owner = this.characters[Math.floor((i * this.characters.length) / PET_COUNT)];
      if (!owner) continue;
      const member = this.pets.spawn();
      const root = member.root;
      this.petList.push({
        owner,
        root,
        body: root.getObjectByName(PET_BODY_NODE) ?? root,
        head: root.getObjectByName(PET_HEAD_NODE) ?? root,
        member,
        position: new Vector3().copy(owner.position),
        facing: 0,
        bounce: rng.range(0, TAU),
      });
    }
  }

  /** Installs the building's ground sampler, so the ground floor is walkable. */
  setGroundSampler(sampler: GroundSampler): void {
    for (const character of this.characters) character.groundSampler = sampler;
  }

  /**
   * Gives the crowd the real player, once it exists — see `World.attachPlayer`
   * and the `player` field's own doc. Lets `update` push a child gently apart
   * from the player instead of letting them walk through each other (design
   * feedback #31d).
   */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * The children themselves.
   *
   * Exposed for rides that carry a character rather than steer one: a driver
   * produces intent and has no business owning a position, so something that
   * physically moves a child — the park train's carriages — needs the bodies.
   * Read-only: nothing outside may add or remove one.
   */
  get riders(): readonly NpcCharacter[] {
    return this.characters;
  }

  /** How many draw calls the crowd costs. Reported in the debug overlay. */
  get drawCallCost(): number {
    return this.kids.crowd.partCount + this.pets.partCount;
  }

  /**
   * Every child in the crowd, for a system that wants to read or briefly take
   * over one of them — currently just `world/TreeClimbing.ts`, which reads
   * each one's driver to spot a climb in progress and pose it accordingly.
   */
  get all(): readonly NpcCharacter[] {
    return this.characters;
  }

  update(context: FrameContext): void {
    const { dt, elapsed } = context;
    if (dt <= 0) return;

    this.frame += 1;
    this.playerPosition.copy(context.playerPosition);

    // The player's hop is the cue for the giggle-hop. Reading the action rather
    // than the Player keeps this system's only dependency the collision world.
    const playerHopped = context.input.justPressed('jump');

    for (let i = 0; i < this.characters.length; i += 1) {
      const character = this.characters[i];
      if (!character) continue;

      // Children a long way off think every other frame, and think twice as
      // hard when they do. Nobody has ever noticed a distant child deciding to
      // turn left 16 milliseconds late.
      const far = character.position.distanceToSquared(this.playerPosition) >
        FAR_DISTANCE * FAR_DISTANCE;
      if (far && (this.frame + i) % 2 !== 0) continue;

      character.update(far ? dt * 2 : dt, elapsed, this.playerPosition, playerHopped);
    }

    this.separate();
    this.separateFromPlayer(dt);

    for (const character of this.characters) {
      character.syncTransform();
      this.kids.crowd.commit(character.avatar.member);
    }
    this.kids.crowd.flush();

    this.updatePets(dt, elapsed);
    this.updateLabels();
  }

  dispose(): void {
    this.kids.dispose();
    this.pets.dispose();
    for (const label of this.labels) label.dispose();
  }

  // ---------------------------------------------------------------- internals

  /**
   * Pushes overlapping children apart.
   *
   * Twelve characters is 66 pairs, which is cheaper than adding twelve moving
   * circles to a collision world built for tree trunks — and far better
   * behaved, because a collider would make every child a wall the others grind
   * against. Relaxation moves both parties half the overlap and stops, so it
   * cannot oscillate.
   */
  private separate(): void {
    for (let a = 0; a < this.characters.length; a += 1) {
      const first = this.characters[a];
      if (!first) continue;
      for (let b = a + 1; b < this.characters.length; b += 1) {
        const second = this.characters[b];
        if (!second) continue;
        first.separateFrom(second, SEPARATION);
      }
    }
  }

  /**
   * Pushes a child gently apart from the player, and the player gently apart
   * from the child — design feedback #31d, "the player and NPCs cannot walk
   * through each other". The same relaxation `separate` already uses for
   * child↔child (see `circleSeparation`, which this and `NpcCharacter.
   * separateFrom` both now share), just with the player's own girth on one
   * side.
   *
   * Never a hard stop: this only ever moves each side by (at most) half of
   * however much they overlap, split evenly, so a child brushing past the
   * player slides round them rather than snagging. `MAX_DEPENETRATION_SPEED`
   * (see `Collision.ts` — the fix for design feedback #17's "fling") caps how
   * far either side can be shoved in one frame, for the one case ordinary
   * walking can never produce on its own: a child or the player arriving
   * already embedded in the other, e.g. a teleport or a space change landing
   * them on top of each other.
   *
   * The player's half goes through `Player.nudge`, which re-resolves them
   * against the ordinary collision world — so this can never push the player
   * through a wall or a tree to get them away from a child — and never
   * touches `Player.velocity`, so (exactly like `resolve`'s own escorting)
   * being nudged apart from a child can never be mistaken for player input
   * and banked as speed.
   */
  private separateFromPlayer(dt: number): void {
    const player = this.player;
    if (!player) return;

    const maxPush = MAX_DEPENETRATION_SPEED * dt;

    for (const character of this.characters) {
      // A climbing child's (x, z) is the tree it is up, not somewhere it is
      // standing — see `NpcCharacter.separateFrom`'s identical guard.
      if (character.climbing) continue;

      const push = circleSeparation(
        character.position.x,
        character.position.z,
        player.position.x,
        player.position.z,
        PLAYER_SEPARATION,
      );
      if (!push) continue;

      const magnitude = Math.hypot(push.dx, push.dz);
      const scale = magnitude > maxPush ? maxPush / magnitude : 1;
      const dx = push.dx * scale;
      const dz = push.dz * scale;

      character.position.x -= dx;
      character.position.z -= dz;
      player.nudge(dx, dz);
    }
  }

  /** Trots each pet along behind its child. */
  private updatePets(dt: number, elapsed: number): void {
    for (const pet of this.petList) {
      const owner = pet.owner.position;
      const facing = pet.owner.avatar.rig.root.rotation.y;

      // Aim for a spot behind the child, in the direction they are facing.
      const targetX = owner.x - Math.sin(facing) * PET_TRAIL;
      const targetZ = owner.z - Math.cos(facing) * PET_TRAIL;

      const dx = targetX - pet.position.x;
      const dz = targetZ - pet.position.z;
      const distance = Math.hypot(dx, dz);

      // Catch up quickly when left behind, dawdle when already there — which is
      // exactly how a small animal on a lead behaves.
      const follow = Math.min(1, dt * (2.5 + distance * 3.5));
      pet.position.x += dx * follow;
      pet.position.z += dz * follow;
      pet.position.y = owner.y;

      if (distance > 0.12) pet.facing = Math.atan2(dx, dz);

      pet.root.position.copy(pet.position);
      pet.root.rotation.y = pet.facing;

      // A blob does not walk, it boings. Faster when it is hurrying.
      pet.bounce += dt * (5 + Math.min(distance, 1.5) * 6);
      const hop = Math.abs(Math.sin(pet.bounce)) * Math.min(0.16, 0.05 + distance * 0.1);
      pet.body.position.y = hop;
      pet.body.scale.set(1 + hop * 0.5, 1 - hop * 0.8, 1 + hop * 0.5);
      pet.head.rotation.z = Math.sin(elapsed * 2.3 + pet.bounce * 0.2) * 0.1;

      this.pets.commit(pet.member);
    }
    this.pets.flush();
  }

  /**
   * Floats each child's name pill above their head, screen-constant size —
   * the same {@link NameLabel} mechanism the player wears (design feedback:
   * "name labels, larger and screen-constant").
   *
   * Only the {@link VISIBLE_LABEL_CAP} nearest to what the camera is actually
   * looking at are shown; a park-full of pills on screen at once is clutter,
   * not charm. `labelOrder` is sorted in place every frame rather than
   * rebuilt, so this allocates nothing per frame beyond the sort itself.
   */
  private updateLabels(): void {
    const camera = this.camera;

    for (let i = 0; i < this.characters.length; i += 1) {
      const character = this.characters[i];
      this.labelDistances[i] = character
        ? character.position.distanceTo(camera.focusPoint)
        : Infinity;
    }

    this.labelOrder.sort((a, b) => (this.labelDistances[a] ?? 0) - (this.labelDistances[b] ?? 0));

    for (let rank = 0; rank < this.labelOrder.length; rank += 1) {
      const i = this.labelOrder[rank];
      if (i === undefined) continue;
      const character = this.characters[i];
      const label = this.labels[i];
      if (!character || !label) continue;

      if (rank >= VISIBLE_LABEL_CAP) {
        label.sprite.visible = false;
        continue;
      }

      label.sprite.position.set(
        character.position.x,
        character.position.y + character.avatar.height + LABEL_HEIGHT_OFFSET,
        character.position.z,
      );
      label.updateScreenSize(camera.worldUnitsPerPixel, this.labelDistances[i] ?? 0);
    }
  }
}

// ------------------------------------------------------------------ helpers

/**
 * Draws `count` names from {@link KID_NAMES} without replacement (and without
 * `ETHAN_NAME`, which is reserved for the fixed slot) — so nobody in one park
 * shares a name with anybody else.
 */
function pickNames(rng: Rng, count: number): string[] {
  const pool = KID_NAMES.filter((n) => n !== ETHAN_NAME);
  const picked: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const index = Math.floor(rng.unit() * pool.length);
    const [name] = pool.splice(index, 1);
    if (name) picked.push(name);
  }
  return picked;
}

function pickColours(rng: Rng): KidColours {
  return {
    skin: rng.pick(KID_SKIN_TONES).colour,
    hair: rng.pick(HAIR_COLOURS),
    outfit: rng.pick(OUTFIT_COLOURS),
    shoe: rng.pick(SHOE_COLOURS),
    bag: rng.pick(BAG_COLOURS),
  };
}
