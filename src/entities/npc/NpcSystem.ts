import { Color, Group, Object3D, Vector3 } from 'three';
import { ART } from '../../art/style/artPalette';
import { PALETTE } from '../../core/palette';
import { Rng, TAU } from '../../core/mathUtils';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../../world/Collision';
import type { GroundSampler } from '../Player';
import { InstancedCrowd, type CrowdMember } from './InstancedCrowd';
import { KidCrowd, type KidColours } from './kidCrowd';
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

/** Beyond this from the player, behaviour runs every other frame. */
const FAR_DISTANCE = 34;

/** How far behind its child a pet trails, in metres. */
const PET_TRAIL = 1.15;

/**
 * Colour choices, all of them already named in `PALETTE` or `ART`.
 *
 * Skin tones are the palette's one skin colour scaled — the same trick the kid
 * model uses for its own shading, which keeps every child on the one warm hue
 * the park is lit for instead of introducing five new colours nobody art
 * directed.
 */
const SKIN_SCALES = [1, 0.95, 0.88, 0.78, 0.66, 0.56] as const;

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
  private readonly playerPosition = new Vector3();
  private frame = 0;

  constructor(
    collision: CollisionWorld,
    groundSampler: GroundSampler | null = null,
    // Trees big enough to climb — threaded down into every child's wander
    // driver so it can decide, on its own, whether one is worth stopping at.
    // Empty by default so nothing here breaks if a caller has none to offer.
    climbableTrees: readonly ClimbableTreeSeed[] = [],
  ) {
    this.group.name = 'npcs';

    const rng = new Rng(NPC_SEED);
    this.graph = new PoiGraph(collision);
    this.kids = new KidCrowd(NPC_COUNT);
    this.group.add(this.kids.crowd.group);

    const spawnNodes = this.graph.spawnNodes();
    const climberBudget: ClimberBudget = { active: 0, max: MAX_CONCURRENT_CLIMBERS };

    for (let i = 0; i < NPC_COUNT; i += 1) {
      const node = spawnNodes[Math.floor((i / NPC_COUNT) * spawnNodes.length)];
      if (!node) break;

      const avatar = this.kids.spawn(
        pickColours(rng),
        rng.chance(0.35),
        rng.range(0.86, 1.04),
      );

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
      );
      character.groundSampler = groundSampler;
      character.setWalkPhase(rng.range(0, TAU));
      this.characters.push(character);
    }

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

    for (const character of this.characters) {
      character.syncTransform();
      this.kids.crowd.commit(character.avatar.member);
    }
    this.kids.crowd.flush();

    this.updatePets(dt, elapsed);
  }

  dispose(): void {
    this.kids.dispose();
    this.pets.dispose();
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
}

// ------------------------------------------------------------------ helpers

const scratchColour = new Color();

function pickColours(rng: Rng): KidColours {
  const skinScale = rng.pick(SKIN_SCALES);
  return {
    skin: scratchColour.setHex(PALETTE.skin).multiplyScalar(skinScale).getHex(),
    hair: rng.pick(HAIR_COLOURS),
    outfit: rng.pick(OUTFIT_COLOURS),
    shoe: rng.pick(SHOE_COLOURS),
    bag: rng.pick(BAG_COLOURS),
  };
}
