import { Group, Object3D, Vector3 } from 'three';
import { CIRCULAR_PARK_AREA, PARK_BOUNDARY } from '../../world/boundary';
import { ART } from '../../art/style/artPalette';
import { PALETTE } from '../../core/palette';
import { CHILD_FOOTPRINT, KID_SKIN_TONES } from '../../art/models/kid';
import { CROWD_HAIR_STYLES, type HairStyle } from '../../art/models/hair';
import {
  BAG_COLOURS,
  HAIR_COLOURS,
  OUTFIT_COLOURS,
  SHOE_COLOURS,
} from '../../art/models/kidLooks';
import { CROWD_BACKPACK_KINDS, type BackpackKind } from '../../art/models/backpacks';
import { CROWD_SHOE_KINDS, type ShoeKind } from '../../art/models/shoes';
import { Rng, TAU } from '../../core/mathUtils';
import type { FrameContext, GameSystem } from '../../core/types';
import type { IsoCamera } from '../../core/IsoCamera';
import { circleSeparation, MAX_DEPENETRATION_SPEED, type CollisionWorld } from '../../world/Collision';
import { PLAYER_RADIUS } from '../../core/constants';
import type { GroundSampler, Player } from '../Player';
import { CharacterModel } from '../CharacterModel';
import { ParadeMember } from '../parade/ParadeMember';
import { disposeTree } from '../../art/style/materials';
import { createHat, type HatKind } from '../../art/models/hats';
import { shopItem } from '../../world/building/shops/catalogue';
import { gameStore } from '../../state';
import { NameLabel } from '../../ui/NameLabel';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { InstancedCrowd, type CrowdMember } from './InstancedCrowd';
import { BLUE_EYE_VARIANT, EYE_VARIANT_COUNT, KidCrowd, type KidColours } from './kidCrowd';
import { NpcCharacter } from './NpcCharacter';
import { characterModelAvatar, type NpcAvatar } from './npcAvatar';
import { WaypointDriver, type Waypoint } from './waypointDriver';
import { PoiGraph } from './poiGraph';
import { JourneyPlanner } from './journey';
import { castleAttractions, gardenAttractions, type Attraction } from './attractions';
import type { LevelConnector } from '../../world/building/surfaces';
import type { ShopStand } from '../../world/building/shops/Shops';
import { createPetBlob, PET_BODY_NODE, PET_HEAD_NODE } from './petBlob';
import { WanderDriver, type ClimberBudget } from './wanderDriver';
import type { ActivityBudget } from './activities/activity';
// Chatting (see the additive block in wanderDriver.ts): the shared budget
// that caps how many children may be mid-chat at once, and the speed below
// which the player counts as "stood still" for that same block.
import { CHAT_STATIONARY_SPEED_EPS, type ChatBudget } from './chatActivity';
import type { ClimbableTreeSeed } from '../../world/Scenery';

/**
 * Caps how many children climb trees across the whole park at once (see
 * `world/TreeClimbing.ts` and the climbing block in `wanderDriver.ts`). One
 * shared budget, handed to every driver, keeps a lucky run of coin flips from
 * putting half the crowd up in the branches at the same time.
 */
const MAX_CONCURRENT_CLIMBERS = 3;

/**
 * How many children may be on the railway — riding or walking to a platform —
 * at once. Issue #350.
 *
 * The train had no cap at all, so every child rolled for it independently and
 * twenty of the twenty-four ended up at a station together. Four is the same
 * order as the climb's three and the paint stall's four: enough that the train
 * always has somebody on it and a child waiting on a platform has company,
 * never so many that the platform *is* the park.
 */
const MAX_CONCURRENT_RIDERS = 4;

/**
 * How many children may be mid-chat across the whole park at once (see the
 * chatting block in `wanderDriver.ts`) — the brief's "at most one or two",
 * so standing still reads as being noticed rather than being mobbed.
 */
const MAX_CONCURRENT_CHATTERS = 2;

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

/**
 * Children in the park — **derived from the park's actual area, not picked.**
 *
 * Twelve was the right number when the park was a 58 m circle. #115 then grew
 * it into a spline running out to 101 m: **21,136 m² against that circle's
 * 10,568 — exactly twice the ground, and still twelve children on it.** Jim,
 * 7 August 2026: *"we have a bigger park now so it should handle more NPCs
 * anyway"*.
 *
 * So what is authored here is the **density** the park was tuned at, and the
 * count follows the boundary. Change the park's shape again and the crowd comes
 * with it, instead of this constant quietly going stale a second time.
 *
 * Cost is not the constraint (see this file's header): every child is instanced
 * and shares one toon material, so *"adding the thirteenth costs nothing but a
 * matrix"*. Behaviour for children far from the camera already runs at half
 * rate.
 */
const NPC_DENSITY_PER_SQUARE_METRE = 12 / CIRCULAR_PARK_AREA;
const NPC_COUNT = Math.round(NPC_DENSITY_PER_SQUARE_METRE * PARK_BOUNDARY.area);

/** …and two of them brought something. */
const PET_COUNT = 2;

/** Fixed seed: the same children, in the same clothes, on every reload. */
const NPC_SEED = 20260726;

/**
 * Closer than this and two children push each other apart.
 *
 * **A whole child wide, measured off the model** — not `NPC_RADIUS * 2`, which
 * is what this was, and which is 1.0 m. `NPC_RADIUS` is the radius a child is
 * resolved against *walls* with, and 0.5 m is right for that: it is roughly the
 * girth of the torso, and a narrow collision circle is what lets two children
 * pass on a path. It is nowhere near the radius a child *looks* like. A chibi
 * rig is almost entirely head — {@link CHILD_FOOTPRINT} is 1.8 m — so children
 * separated to exactly 1.0 m are standing with their skulls half a metre inside
 * one another, everywhere in the park, all the time.
 *
 * Found while fixing the cat bus, where Jim could see it happening to eleven
 * children at once; but it was never a bus bug, and raising it here fixes the
 * same overlap wherever two children happen to meet.
 */
export const SEPARATION = CHILD_FOOTPRINT;

/**
 * Closer than this and a child pushes gently apart from the player instead of
 * walking through them (design feedback #31d — "player↔NPC collision").
 * Exactly the same combined-radii idea as {@link SEPARATION}, just with the
 * player's own girth on one side instead of a second child's.
 */
const PLAYER_SEPARATION = CHILD_FOOTPRINT / 2 + PLAYER_RADIUS;

/** Beyond this from the player, behaviour runs every other frame. */
const FAR_DISTANCE = 34;

/** How far behind its child a pet trails, in metres. */
const PET_TRAIL = 1.15;

/**
 * A cute, curated, deliberately international cast — the family asked for
 * name labels, so the children needed names. No duplicates within one park:
 * `pickNames` below draws from this pool without replacement.
 *
 * Every {@link PINNED_KIDS} name is reserved out of the general draw — see
 * `pickNames`.
 */
const KID_NAMES: readonly string[] = [
  'Ethan',
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
 * A child whose look is pinned rather than rolled — a family request, one
 * per name. Everything left `undefined` still rolls normally (pace, spawn
 * spot, backpack/shoe *kind* are never pinned today), same as Ethan always
 * worked before this became a list.
 *
 * `hat`/`petItemId`/a `hairStyle` outside {@link CROWD_HAIR_STYLES} all cost
 * more than the shared instanced crowd can give a member — see
 * `needsIndividualModel` — so a pinned kid asking for any of those is built
 * as a one-off {@link CharacterModel} instead of an instanced `KidAvatar`.
 * That is a real, individually-rendered character exactly like the player,
 * not a new rendering path: it already has a working `hatAnchor`, and
 * already drives the simulated ponytail, because `CharacterModel` always
 * did.
 */
interface PinnedKidSpec {
  readonly name: string;
  readonly hair?: number;
  readonly skin?: number;
  readonly hairStyle?: HairStyle;
  readonly outfit?: number;
  readonly shoe?: number;
  readonly bag?: number;
  /** Crowd-only: which baked face variant to use. See {@link BLUE_EYE_VARIANT}. */
  readonly eyeVariant?: number;
  /** Individual-model-only: a literal eye colour. Defaults to `ART.kidEye`. */
  readonly eyeColour?: number;
  /** A hat, worn permanently — see `art/models/hats.ts`'s `HatKind`. */
  readonly hat?: HatKind;
  /** A shop item id (`world/building/shops/catalogue.ts`) that trails this
   *  kid specifically, driven the same way the parade follows the player —
   *  see `buildPinnedPet`. */
  readonly petItemId?: string;
}

/** Family request (26 July): always a blonde, blue-eyed boy named Ethan. */
const ETHAN: PinnedKidSpec = {
  name: 'Ethan',
  hair: ART.kidHairBlonde,
  // 'Fair' (`KID_SKIN_TONES[1]`) — the game's long-standing default light
  // tone, pinned alongside his hair and eyes (1 August).
  skin: ART.kidSkin,
  hairStyle: 'short',
  eyeVariant: BLUE_EYE_VARIANT,
};

/** Eleri's own pinned look: brown hair worn long, RiPika's hat and pet, pink dress and shoes. */
const ELERI: PinnedKidSpec = {
  name: 'Eleri',
  hair: PALETTE.hair,
  hairStyle: 'long',
  // `PALETTE.outfit` is already the game's own pink, so "pink dress" needs no
  // colour of its own — the crowd's one garment silhouette already reads as
  // a dress. `ART.heartPink` for the shoes rather than the same pink twice.
  outfit: PALETTE.outfit,
  shoe: ART.heartPink,
  hat: 'ripikaHat',
  petItemId: 'toy.ripika',
  // No eye override: the crowd's own default variant (0) already bakes
  // `ART.kidEye`, a warm violet — exactly what nobody asked her to have but
  // everyone else in the park already wears by default.
};

/** Rumi's own pinned look: purple hair in a simulated swishy ponytail, all black, purple eyes. */
const RUMI: PinnedKidSpec = {
  name: 'Rumi',
  hair: ART.miniLilac,
  hairStyle: 'longPonytail',
  // 'Honey' (`KID_SKIN_TONES[2]`).
  skin: 0xf0b787,
  // `PALETTE.ink` rather than a literal black — ART_DIRECTION's rule of
  // thumb is "never pure black" (see `artPalette.ts`'s own header), and ink
  // is the darkest tone already in the palette.
  outfit: PALETTE.ink,
  shoe: PALETTE.ink,
  bag: PALETTE.ink,
  // No eye override, same reasoning as Eleri's: the default bake is already
  // violet/purple (`ART.kidEye`).
};

/**
 * The whole pinned cast. Order does not matter — see `pinnedSlots` below,
 * which assigns fixed slot indices at construction time, not here — but
 * names must never repeat, including against {@link KID_NAMES}'s general
 * pool: `pickNames` filters every one of these out before drawing.
 */
const PINNED_KIDS: readonly PinnedKidSpec[] = [ETHAN, ELERI, RUMI];

/**
 * Whether a pinned kid's look exceeds what the shared instanced crowd can
 * give one member: a hat (no crowd member has an attachable hatAnchor — see
 * `npcAvatar.ts`), a pet of their own (the crowd's pet blob is one shared
 * shape for everyone), or the floor-length simulated ponytail (deliberately
 * excluded from `CROWD_HAIR_STYLES` — see `art/models/hair.ts` — because
 * simulating it for the whole crowd would cost every background child eight
 * more draw calls and a physics chain nobody would ever look at).
 *
 * `true` means this one is built as a one-off {@link CharacterModel} instead
 * — see `NpcSystem.buildIndividualAvatar`.
 */
function needsIndividualModel(pinned: PinnedKidSpec): boolean {
  return (
    pinned.hat != null ||
    pinned.petItemId != null ||
    (pinned.hairStyle != null && !CROWD_HAIR_STYLES.includes(pinned.hairStyle))
  );
}

/** Softer and quieter than the player's pink label, so Eleri still stands out. */
const NPC_LABEL_ACCENT = PALETTE.markerSky;
/** A touch smaller than the player's label — see `NameLabel`'s `sizeScale`. */
const NPC_LABEL_SCALE = 0.82;
/** How high above a child's own height their label floats. */
const LABEL_HEIGHT_OFFSET = 0.34;
/** Only the nearest handful of labels show at once — a dozen name pills is clutter. */
const VISIBLE_LABEL_CAP = 10;

/** A speech bubble floats a little higher than the name pill it shares a head with. */
const BUBBLE_HEIGHT_OFFSET = LABEL_HEIGHT_OFFSET + 0.62;

/**
 * Colour choices — now in `art/models/kidLooks.ts`, so the cat bus's journey
 * can dress its passengers out of the same tin without importing this file.
 * `NpcSystem` reads `PARK_BOUNDARY` at module scope, and the journey has to be
 * on screen *before* the park is solved. See that file for the full reasoning.
 */

/**
 * Somebody who lives in a space that is not the park.
 *
 * The generalisation Jim asked for after playing the hotel: *"even other
 * children can be walked through even though in the park NPCs are solid —
 * they should be the same code."* They are now literally the same code. A
 * resident is an ordinary {@link NpcCharacter} in the ordinary
 * `this.characters` array, so it gets — without a line of its own —
 * `NpcCharacter`'s movement and walk cycle, the shared `CollisionWorld`, the
 * shared `WalkSurfaces` ground sampler, {@link NpcSystem.separate}'s
 * child↔child push-apart and {@link NpcSystem.separateFromPlayer}'s
 * player↔child one. The hotel's own bespoke movement layer is gone: there is
 * nothing left for it to disagree with the park about.
 *
 * What is *not* shared is the decision layer, which is exactly the seam
 * `driver.ts` exists to cut along: a resident is driven by a
 * {@link WaypointDriver} round a circuit inside its own room rather than by a
 * `WanderDriver` round the park's `PoiGraph`. A room is not a graph — see that
 * file's header.
 *
 * ### Who builds what
 *
 * The space owns the *look and the geography*: it builds the model, parents it
 * into its own root (so the body is shown and hidden with the space, and
 * disposed with it), and works out where standing about is sensible. This
 * system owns the *body and the physics*. That is why `avatar` arrives already
 * built and already parented — `NpcSystem` never touches a resident's scene
 * graph, and could not sensibly decide which of four hotel rooms one belongs
 * to.
 *
 * ### What a resident deliberately does not get
 *
 * A name pill and a speech bubble. Both are park furniture — the pill is
 * capped to the ten nearest and the bubble is driven by the chat activity,
 * neither of which a room with three people in it wants. The parallel `labels`
 * and `bubbles` arrays simply run out, and the frame path already skips a
 * character with no entry in them.
 */
export interface ResidentSpec {
  readonly name: string;
  /**
   * The body, already built **and already added to its own space's root**.
   * Anything that satisfies `NpcAvatar` will do: `npcAvatar.ts`'s
   * `characterModelAvatar` for a child, its `creatureAvatar` for a pet.
   */
  readonly avatar: NpcAvatar;
  /** The circuit, in world metres. The body starts on the first one. */
  readonly waypoints: readonly Waypoint[];
  /** This resident's own seeded stream, so reloading gives the same stroll. */
  readonly seed: number;
  /** Fraction of the house walking pace. See {@link WaypointOptions.pace}. */
  readonly pace?: number;
  /**
   * Height of the floor these waypoints are on. Defaults to 0.
   *
   * The space has to say, because nothing else can: `NpcCharacter` starts
   * everybody at `terrainHeight`, which is the park's own hills and knows
   * nothing about a floor plate six hundred metres away — and `WalkSurfaces`
   * only offers a platform within a step *up* of where you ask from, so a
   * body that starts far below its own floor is told it has none and falls
   * for ever. See `NpcCharacter.settle`.
   */
  readonly floorY?: number;
}

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
  /**
   * Where the children go and how they get there — issue #350.
   *
   * Shared by every child: it owns one `NavGrid` per space and the per-frame
   * budget that stops a cohort of simultaneous arrivals planning at once.
   */
  private readonly planner: JourneyPlanner;
  private readonly characters: NpcCharacter[] = [];
  private readonly petList: Pet[] = [];
  /** One-off `CharacterModel`s built by `buildIndividualAvatar` — disposed by hand in `dispose()`,
   *  since they are real scene objects rather than members of `this.kids`' instanced batch. */
  private readonly individualModels: CharacterModel[] = [];
  /** A named pet trailing a specific pinned kid — see `buildPinnedPet`/`updatePinnedPets`. */
  private readonly pinnedPets: { readonly member: ParadeMember; readonly owner: NpcCharacter }[] = [];
  private readonly labels: NameLabel[] = [];
  /** Parallel to `characters` — kept as the concrete class (rather than the
   *  narrower `CharacterDriver`) purely to read `chatBubbleText` back out; see
   *  the chatting block in `wanderDriver.ts`. */
  private readonly wanderDrivers: WanderDriver[] = [];
  /** Parallel to `characters`. Most sit empty (`setText(null)` is a no-op) —
   *  only the one or two children mid-chat ever have anything to show. */
  private readonly bubbles: SpeechBubble[] = [];
  private readonly chatBudget: ChatBudget = { active: 0, max: MAX_CONCURRENT_CHATTERS };
  /** How long the player has been standing still — see `CHAT_STATIONARY_SPEED_EPS`. */
  private playerStationaryFor = 0;
  private readonly lastPlayerPosition = new Vector3();
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

  private readonly camera: IsoCamera;
  private readonly arrivingByBus: number;

  constructor(
    collision: CollisionWorld,
    camera: IsoCamera,
    groundSampler: GroundSampler | null = null,
    // Trees big enough to climb — threaded down into every child's wander
    // driver so it can decide, on its own, whether one is worth stopping at.
    // Empty by default so nothing here breaks if a caller has none to offer.
    climbableTrees: readonly ClimbableTreeSeed[] = [],
    // Every railway bridge's own surface height at (x, z), or null off every
    // bridge — `PoiGraph`'s height-aware line-of-sight probe needs it to
    // stand a candidate edge's sample point on the deck rather than at
    // ground level (issue #116, Decision 8). Defaults to "no bridges
    // anywhere", which is every space but the park itself.
    bridgeHeightAt: (x: number, z: number) => number | null = () => null,
    /**
     * How many of these children ride in on the cat bus.
     *
     * **They are park NPCs from birth, not passengers converted into NPCs
     * afterwards** — Jim's ruling, and the code leaves no alternative anyway:
     * `KidCrowd` sizes a fixed-capacity `InstancedMesh` from `NPC_COUNT` and
     * `InstancedCrowd.spawn()` throws the moment it is exhausted, so eleven
     * children joining *later* is not a thing this system can do.
     *
     * So the arrival does not add anybody. It borrows the first
     * {@link arrivingByBus} of the park's own cast for the first fifteen
     * seconds of their lives. `NPC_COUNT` is unchanged and unchangeable by
     * this: eleven of the twenty-four simply start the game sitting down.
     */
    arrivingByBus: number = 0,
    // The people who live somewhere that is not the park — the hotel's guests,
    // today. See {@link ResidentSpec}. Built last of all, below, and on their
    // own seeded streams, so hosting them cannot shift a single roll the park's
    // own twelve children make.
    residents: readonly ResidentSpec[] = [],
    /**
     * The declared ways between levels — `WalkSurfaces.connectors`, the same
     * closure `Game.ts` hands the player's own `NavGrid`. A child walking to
     * the Hat Shop on deck 2 climbs the lobby stair to get there, so their
     * lattice needs the connectors as much as the player's does.
     */
    connectors: () => readonly LevelConnector[] = () => [],
    /**
     * The castle's shops, as destinations — `Shops.stands`, which already
     * carries a title and a world x/z/y at the spot in front of each counter.
     * Jim asked for these by name: "This can include things inside the castle."
     */
    shopStands: readonly ShopStand[] = [],
  ) {
    this.camera = camera;
    this.arrivingByBus = arrivingByBus;
    this.group.name = 'npcs';

    const rng = new Rng(NPC_SEED);
    // A separate stream for names, so shuffling the cast never shifts which
    // colours/hairstyles/paces the seeded `rng` above hands to which slot.
    const nameRng = new Rng(NPC_SEED + 424242);
    // And another for the bags. Bag *colour* has always come off the main
    // stream (`pickColours`), so the shape has to come from somewhere else or
    // every child in the park would be handed somebody else's hair, pace and
    // spot on the path the day this feature landed — the same reason the names
    // above have their own stream.
    const bagRng = new Rng(NPC_SEED + 90210);
    // And another for the shoes, same reasoning, own salt so it cannot
    // collide with the bags' (90210) or the names' (424242).
    const shoeRng = new Rng(NPC_SEED + 24680);

    // If the player named themselves after one of the pinned cast, that one
    // is not in the park — a family request (Jim, 4 August): "if the player
    // makes their name any of the canned names, that NPC isn't in the game."
    // The slot itself is not dropped, so the park still has `NPC_COUNT`
    // children: it just rolls a normal random kid instead, same as if this
    // pinned kid had never existed. Read once, at construction, rather than
    // subscribed to — a save's cast is fixed the moment the park is built,
    // same as everyone else's colours and hairstyle.
    const playerName = gameStore.get().player.name;
    const activePinned = PINNED_KIDS.filter((pinned) => pinned.name !== playerName);
    // Fixed slot indices, assigned in list order — deterministic for a given
    // player name, which is all "fixed" needs to mean here. A pinned kid
    // dropping out for a name collision shifts the ones after it down by one
    // rather than leaving a gap, so the park never spawns fewer than
    // `NPC_COUNT` children over a collision.
    const pinnedSlots = new Map<number, PinnedKidSpec>();
    activePinned.forEach((pinned, index) => pinnedSlots.set(index, pinned));

    const otherNames = pickNames(nameRng, NPC_COUNT - activePinned.length);
    let nameCursor = 0;

    this.graph = new PoiGraph(collision, bridgeHeightAt);

    // The park has hills and a railway bridge, so an attraction's height is
    // sampled rather than assumed — see `attractions.ts`. Falls back to a flat
    // park when there is no sampler, which is only the case in a test harness
    // that never built a building.
    const sample: GroundSampler = groundSampler ?? (() => 0);
    const attractions: Attraction[] = [
      ...gardenAttractions(sample),
      ...castleAttractions(shopStands),
    ];
    this.planner = new JourneyPlanner(
      collision,
      sample,
      connectors,
      // `bridgeCovers` is the same question `bridgeHeightAt` answers, asked as
      // a boolean: a point is over a bridge exactly when the bridge has a
      // surface height there. Derived rather than passed separately so the two
      // can never disagree about where a deck is.
      (x, z) => bridgeHeightAt(x, z) !== null,
      attractions,
    );
    this.kids = new KidCrowd(NPC_COUNT);
    this.group.add(this.kids.crowd.group);

    const spawnNodes = this.graph.spawnNodes();
    const climberBudget: ClimberBudget = { active: 0, max: MAX_CONCURRENT_CLIMBERS };
    const riderBudget: ActivityBudget = { active: 0, max: MAX_CONCURRENT_RIDERS };

    for (let i = 0; i < NPC_COUNT; i += 1) {
      const node = spawnNodes[Math.floor((i / NPC_COUNT) * spawnNodes.length)];
      if (!node) break;

      // A pinned kid (Ethan, say) is a family request: always present,
      // always looking the way they were asked to. Every `rng` call below
      // still fires in the same order for every slot regardless — only the
      // results for a pinned slot are overridden — so adding or removing one
      // never reshuffles anyone else's look.
      const pinned = pinnedSlots.get(i);
      const name = pinned ? pinned.name : (otherNames[nameCursor++] ?? 'Friend');

      const rolledColours = pickColours(rng);
      const colours: KidColours = pinned
        ? {
            skin: pinned.skin ?? rolledColours.skin,
            hair: pinned.hair ?? rolledColours.hair,
            outfit: pinned.outfit ?? rolledColours.outfit,
            shoe: pinned.shoe ?? rolledColours.shoe,
            bag: pinned.bag ?? rolledColours.bag,
          }
        : rolledColours;

      // One `next()` off the stream, exactly as the `chance(0.35)` short-hair
      // coin flip this replaced took — so widening the crowd from two
      // hairstyles to eight changes what each child *wears* without reshuffling
      // any of their other rolls, and a pinned kid stays where they are.
      const styleRoll = CROWD_HAIR_STYLES[rng.int(0, CROWD_HAIR_STYLES.length - 1)] ?? 'bunches';
      const hairStyle: HairStyle = pinned?.hairStyle ?? styleRoll;

      // A pinned kid's eyes, if given, are a crowd face *variant* — everyone
      // else rolls across the crowd's whole eye-colour range (see
      // `kidCrowd.ts`'s `EYE_VARIANT_COUNT`), same spirit as the skin/hair/
      // outfit rolls above. Only read for a crowd-rendered pinned kid — an
      // individually-modelled one uses `pinned.eyeColour` directly instead,
      // see `buildIndividualAvatar`.
      const eyeVariant = pinned?.eyeVariant ?? rng.int(0, EYE_VARIANT_COUNT - 1);

      const backpack =
        CROWD_BACKPACK_KINDS[bagRng.int(0, CROWD_BACKPACK_KINDS.length - 1)] ?? 'satchel';
      const shoes = CROWD_SHOE_KINDS[shoeRng.int(0, CROWD_SHOE_KINDS.length - 1)] ?? 'plain';
      const scale = rng.range(0.86, 1.04);

      const avatar: NpcAvatar =
        pinned && needsIndividualModel(pinned)
          ? this.buildIndividualAvatar(pinned, colours, hairStyle, scale, backpack, shoes)
          : this.kids.spawn(colours, hairStyle, scale, eyeVariant, backpack, shoes);
      // Forces the face variant to match immediately — otherwise a
      // child whose expression never transitions away from the default
      // 'neutral' would never call `setExpression` and a pinned kid's eyes
      // would show the crowd's normal (un-pinned) colour until the first
      // blink. Harmless on an individually-modelled avatar, which already
      // baked its own eye colour in at construction.
      avatar.setExpression('neutral');

      const driver = new WanderDriver({
        graph: this.graph,
        planner: this.planner,
        rng: new Rng(NPC_SEED + i * 977),
        startNode: node.index,
        pace: rng.range(0.85, 1.12),
        climbableTrees,
        climberBudget,
        riderBudget,
        chatBudget: this.chatBudget,
        arrivesByBus: i < this.arrivingByBus,
      });
      this.wanderDrivers.push(driver);

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

      if (pinned?.petItemId) {
        const pet = this.buildPinnedPet(pinned.petItemId, pinned.name);
        if (pet) {
          // Drop it right on its owner rather than letting it follow in from
          // wherever `ParadeMember`'s own construction left it — the same
          // "no chase-in on spawn" courtesy `placeAt` gives every parade
          // member that pops in already placed. Facing is re-derived the
          // moment it starts moving (`ParadeMember.update` turns to face
          // wherever it is actually heading), so `0` here is only ever seen
          // for the first still frame.
          pet.placeAt(character.position.x, character.position.y, character.position.z, 0);
          this.group.add(pet.root);
          this.pinnedPets.push({ member: pet, owner: character });
        }
      }

      const label = new NameLabel(name, NPC_LABEL_ACCENT, NPC_LABEL_SCALE);
      label.sprite.position.set(
        character.position.x,
        character.position.y + avatar.height + LABEL_HEIGHT_OFFSET,
        character.position.z,
      );
      this.group.add(label.sprite);
      this.labels.push(label);
      this.labelOrder.push(i);

      const bubble = new SpeechBubble(NPC_LABEL_ACCENT);
      bubble.sprite.position.set(
        character.position.x,
        character.position.y + avatar.height + BUBBLE_HEIGHT_OFFSET,
        character.position.z,
      );
      this.group.add(bubble.sprite);
      this.bubbles.push(bubble);
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

    // --- residents -----------------------------------------------------------
    // Deliberately after the pets: `petList` picks its owners by index into
    // `this.characters`, so appending anybody before that runs would hand the
    // park's two blob pets to two different children. Deliberately on their own
    // `Rng` per resident, never the park's `rng`, for the same reason — see
    // `ResidentSpec` and the seed-stream note in the constructor's signature.
    for (const spec of residents) {
      const rng = new Rng(spec.seed);
      const start = spec.waypoints[0] ?? { x: 0, z: 0 };
      const character = new NpcCharacter(
        spec.avatar,
        new WaypointDriver({
          rng,
          points: spec.waypoints,
          ...(spec.pace !== undefined ? { pace: spec.pace } : {}),
        }),
        collision,
        start.x,
        start.z,
        rng.range(-Math.PI, Math.PI),
        spec.name,
      );
      character.groundSampler = groundSampler;
      // The constructor could only guess with `terrainHeight`, which knows
      // nothing about a floor plate six hundred metres from the park — see
      // `NpcCharacter.settle` and `ResidentSpec.floorY`.
      character.settle(spec.floorY ?? 0);
      character.setWalkPhase(rng.range(0, TAU));
      spec.avatar.setExpression('neutral');
      this.characters.push(character);
    }

    // Sized once everybody exists, residents included: `updateLabels` walks
    // `characters` and writes one distance per index, so a short array here
    // would silently stop measuring the last few.
    this.labelDistances = new Float32Array(this.characters.length);
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

    // Hand out this frame's route-planning budget before anybody is stepped.
    // Twenty-four children arriving in the same second would otherwise run
    // twenty-four A* searches in one frame; two of them do, and the rest ask
    // again next frame while standing still looking at what they walked to.
    this.planner.beginFrame();

    // The player's hop is the cue for the giggle-hop. Reading the action rather
    // than the Player keeps this system's only dependency the collision world.
    const playerHopped = context.input.justPressed('jump');

    // Chatting (additive): how long the player has stood still, and whether
    // they have a hat on — computed once per frame here, rather than in every
    // driver, and handed down through `NpcCharacter.update`. See
    // `DriverContext.playerStationaryFor`/`playerWearingHat` in `driver.ts`.
    const playerSpeed = dt > 0 ? this.playerPosition.distanceTo(this.lastPlayerPosition) / dt : 0;
    this.playerStationaryFor =
      playerSpeed > CHAT_STATIONARY_SPEED_EPS ? 0 : this.playerStationaryFor + dt;
    this.lastPlayerPosition.copy(this.playerPosition);
    const playerWearingHat = this.player?.wornHat != null;

    for (let i = 0; i < this.characters.length; i += 1) {
      const character = this.characters[i];
      if (!character) continue;

      // Children a long way off think every other frame, and think twice as
      // hard when they do. Nobody has ever noticed a distant child deciding to
      // turn left 16 milliseconds late.
      const far = character.position.distanceToSquared(this.playerPosition) >
        FAR_DISTANCE * FAR_DISTANCE;
      if (far && (this.frame + i) % 2 !== 0) continue;

      const charDt = far ? dt * 2 : dt;
      character.update(
        charDt,
        elapsed,
        this.playerPosition,
        playerHopped,
        this.playerStationaryFor,
        playerWearingHat,
      );
      // Only an individually-modelled avatar has anything here — the
      // simulated ponytail's physics update, today. Must run after
      // `character.update` has posed this frame; see `NpcAvatar.tick`'s own
      // doc comment.
      character.avatar.tick?.(charDt);
    }

    this.separate(dt);
    this.separateFromPlayer(dt);

    for (const character of this.characters) {
      character.syncTransform();
      // Only set on an instanced `KidAvatar` — a one-off `CharacterModel`
      // avatar is a real scene object with no instance buffer to flush.
      const member = character.avatar.member;
      if (member) this.kids.crowd.commit(member);
    }
    this.kids.crowd.flush();

    this.updatePets(dt, elapsed);
    this.updatePinnedPets(dt, elapsed);
    this.updateLabels();
    this.updateBubbles();
  }

  /**
   * Everything this system built. A **resident's** avatar is deliberately not
   * in here: its model was built by, parented into and is disposed with its
   * own space (see {@link ResidentSpec}), and disposing it from both places is
   * how a shared material gets freed out from under something still drawing it.
   */
  dispose(): void {
    this.kids.dispose();
    this.pets.dispose();
    for (const label of this.labels) label.dispose();
    for (const bubble of this.bubbles) bubble.dispose();
    for (const model of this.individualModels) {
      model.root.removeFromParent();
      disposeTree(model.root);
    }
    for (const pet of this.pinnedPets) pet.member.dispose();
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
  /**
   * `dt` because the correction is **rate-limited**, exactly as
   * `separateFromPlayer` already limits its own.
   *
   * It was not, and at the old 1.0 m {@link SEPARATION} that never showed:
   * the worst single correction two children could need was half a metre, which
   * hides under `check:jitter`'s 1 m own-step bound. Widening the separation to
   * a whole child brought it out — 118 violations, worst step 1.209 m — because
   * an unlimited push moves a child further in one frame than they can walk in
   * twenty. `MAX_DEPENETRATION_SPEED` is the same 3 m/s escort the collision
   * world uses to ease anything out of anything else, and using it here means
   * two children who end up overlapping *slide* apart over a few frames instead
   * of snapping.
   */
  private separate(dt: number): void {
    const maxPush = MAX_DEPENETRATION_SPEED * dt;
    for (let a = 0; a < this.characters.length; a += 1) {
      const first = this.characters[a];
      if (!first) continue;
      for (let b = a + 1; b < this.characters.length; b += 1) {
        const second = this.characters[b];
        if (!second) continue;
        first.separateFrom(second, SEPARATION, maxPush);
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
      // standing — see `NpcCharacter.separateFrom`'s identical guard. A
      // scripted one's is a bus seat, and this is the pass that would shove the
      // player's own seatmate out through the bodywork beside her.
      if (character.climbing || character.scripted) continue;

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
   * Trots a pinned kid's own named pet along behind them — a `ParadeMember`
   * (`entities/parade/ParadeMember.ts`), same class the shop's toys already
   * use to follow the player, just fed a different target every frame. Its
   * own `update` handles the follow spring, the walk-cycle gait and the
   * expression; all this does is say where "behind its owner" currently is,
   * identical geometry to {@link updatePets}'s blob trail.
   */
  private updatePinnedPets(dt: number, elapsed: number): void {
    for (const { member, owner } of this.pinnedPets) {
      const facing = owner.avatar.rig.root.rotation.y;
      const targetX = owner.position.x - Math.sin(facing) * PET_TRAIL;
      const targetZ = owner.position.z - Math.cos(facing) * PET_TRAIL;
      member.target.set(targetX, owner.position.y, targetZ);
      member.update(dt, elapsed);
    }
  }

  /**
   * Builds a pinned kid whose look exceeds the shared instanced crowd — see
   * `needsIndividualModel` — as a one-off {@link CharacterModel}: the exact
   * model the player wears, individually rendered rather than instanced, so
   * it already has a real `hatAnchor` a hat mesh can simply be parented to
   * and already drives the simulated ponytail through its own `update`.
   *
   * Added straight to `this.group` here, since (unlike a `KidCrowd` member)
   * it is a real scene-graph object rather than a proxy skeleton the crowd
   * uploads for it.
   */
  private buildIndividualAvatar(
    pinned: PinnedKidSpec,
    colours: KidColours,
    hairStyle: HairStyle,
    scale: number,
    backpack: BackpackKind,
    shoes: ShoeKind,
  ): NpcAvatar {
    const model = new CharacterModel(
      {
        skin: colours.skin,
        hair: colours.hair,
        outfit: colours.outfit,
        outfitArms: colours.outfit,
        shoe: colours.shoe,
      },
      {
        hairStyle,
        // `exactOptionalPropertyTypes`: an absent eye colour must be an
        // omitted key, never an explicit `undefined`, so this is spread
        // rather than written as a plain `eyeColour: pinned.eyeColour`.
        ...(pinned.eyeColour !== undefined ? { eyeColour: pinned.eyeColour } : {}),
        backpackKind: backpack,
        backpackColour: colours.bag,
        shoeKind: shoes,
      },
    );
    model.root.scale.setScalar(scale);
    this.group.add(model.root);
    this.individualModels.push(model);

    if (pinned.hat) {
      // The same attachment `entities/WornHat.ts` gives the player, minus
      // the reactive machinery: a pinned kid's hat is chosen once and never
      // taken off, so there is nothing to subscribe to.
      const hat = createHat(pinned.hat);
      model.hatAnchor.add(hat.root);
      model.setHatWorn(true);
    }

    // The mapping from "the player's own model" to "something `NpcCharacter`
    // can pose" lives in `npcAvatar.ts`, not here: the hotel's residents are
    // the same body built by the same factory, and two copies of it is the
    // repo's most-repeated bug.
    return characterModelAvatar(model);
  }

  /**
   * Builds the standalone creature that trails a pinned kid with a
   * `petItemId` — a `ParadeMember` wrapping the same shop item's model
   * (`world/building/shops/catalogue.ts`'s `shopItem`), the same class and
   * the same catalogue the parade already uses to follow the player. `null`
   * only if the id is not a real catalogue entry — defensive, since these are
   * all string literals authored alongside their `PinnedKidSpec`.
   */
  private buildPinnedPet(itemId: string, ownerName: string): ParadeMember | null {
    const item = shopItem(itemId);
    if (!item) return null;
    return new ParadeMember(`pinned-pet:${ownerName}`, item);
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

  /**
   * Floats a {@link SpeechBubble} over whichever child (or two) is mid-chat —
   * see the chatting block in `wanderDriver.ts`. Reads `chatBubbleText`
   * straight off each child's own `WanderDriver`, the same way `TreeClimbing`
   * reads `climbPhase`: the driver owns the state, this just draws it.
   *
   * No distance cap of its own beyond what `SpeechBubble.updateScreenSize`
   * already does — the shared chat budget already caps how many are ever
   * showing at once, so there is no clutter to guard against here.
   */
  private updateBubbles(): void {
    const camera = this.camera;

    for (let i = 0; i < this.characters.length; i += 1) {
      const character = this.characters[i];
      const driver = this.wanderDrivers[i];
      const bubble = this.bubbles[i];
      if (!character || !bubble) continue;

      bubble.setText(driver?.chatBubbleText ?? null);
      bubble.sprite.position.set(
        character.position.x,
        character.position.y + character.avatar.height + BUBBLE_HEIGHT_OFFSET,
        character.position.z,
      );
      bubble.updateScreenSize(camera);
    }
  }
}

// ------------------------------------------------------------------ helpers

/**
 * Draws `count` names from {@link KID_NAMES} without replacement (and
 * without any {@link PINNED_KIDS} name, whether or not it is active this
 * park — a name reserved for the pinned cast is never handed to a random
 * kid instead) — so nobody in one park shares a name with anybody else.
 */
function pickNames(rng: Rng, count: number): string[] {
  const reserved = new Set(PINNED_KIDS.map((pinned) => pinned.name));
  const pool = KID_NAMES.filter((n) => !reserved.has(n));
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
