import { PALETTE } from '../../../core/palette';
import { Rng } from '../../../core/mathUtils';
import type { AssetHandle } from '../../../art/style/asset';
import { createRipika } from '../../../art/models/ripika';
import { createBiscuit } from '../../../art/models/biscuit';
import { createBalloon } from '../../../art/models/balloons';
import { createHat } from '../../../art/models/hats';
import { createJetpack } from '../../../art/models/jetpack';
import { createPet, PET_KINDS, PUFF_DISPLAY_NAME, type PetKind } from '../../../art/models/pets';
import {
  createCandyFloss,
  createIceCream,
  createStarToy,
  createStickerSheet,
  createSurpriseEgg,
} from '../../../art/models/shopItems';
import { createSpookyCandy } from '../../../minigames/spookyHouse/candyModel';
import {
  createKeychain,
  KEYCHAIN_KINDS,
  type KeychainKind,
} from '../../../art/models/keychains';
import type { CuteCategory, InventoryKind } from '../../../state';

/**
 * What the seven shops sell.
 *
 * One table, read by three things that must never disagree: the fit-out that
 * puts the stock on the shelves, the purchase panel that lists it, and the
 * carried-item system that puts the bought one in the player's hands. Each entry
 * carries its own model factory, so "the toy on the shelf" and "the toy you are
 * holding" are the same asset at two scales.
 *
 * Prices are here for flavour and for Mayhem mode. In normal mode the purse is
 * bottomless (`gameStore.spend`) and the HUD hides the money pill entirely —
 * which is why the panel says *Collect* rather than *Buy* there (see
 * `state/wording.ts`).
 */
/**
 * Name and blurb for each keyring, kept beside the kinds they name.
 *
 * `check:brevity` holds these to a title of 24 characters and a blurb of one
 * sentence of 50 — do not add `KNOWN_LONG` entries to buy room, write shorter.
 */
const KEYCHAIN_COPY: Record<KeychainKind, { displayName: string; blurb: string; icon: string }> = {
  ripika: { displayName: 'RiPika Keychain', blurb: 'A tiny RiPika for your bag.', icon: '🐹' },
  star: {
    displayName: 'Star Keychain',
    blurb: 'A little star that swings when you walk.',
    icon: '🌟',
  },
  strawberry: {
    displayName: 'Strawberry Keychain',
    blurb: 'A tiny strawberry, never squashy.',
    icon: '🍓',
  },
  rainbow: {
    displayName: 'Rainbow Keychain',
    blurb: 'A whole rainbow, small enough to carry.',
    icon: '🌈',
  },
  heart: { displayName: 'Heart Keychain', blurb: 'A little heart bouncing on your bag.', icon: '💗' },
  rumi: { displayName: 'Rumi Keychain', blurb: 'A tiny Rumi doll, ponytail and all.', icon: '🖤' },
};

export type ShopId =
  | 'toy'
  | 'balloon'
  | 'candyFloss'
  | 'iceCream'
  | 'hat'
  | 'stickerPet'
  | 'surpriseEgg';

export interface ShopItem {
  /** Stable catalogue id, and the Cute-o-dex key. */
  readonly id: string;
  /**
   * Which shop unit sells it — or `'spookyHouse'` for the one entry that
   * isn't sold anywhere, only found (see the `candy.spookyHouse` entry in
   * `SHOP_ITEMS` below). Kept as
   * a union with `ShopId` rather than folded into it, so the exhaustive
   * `Record<ShopId, …>` tables in `fitouts.ts`/`Shops.ts` never have to know
   * about a shop that doesn't physically exist.
   */
  readonly shopId: ShopId | 'spookyHouse' | 'keychainStall';
  readonly displayName: string;
  /** One cheerful line under the name in the purchase panel. */
  readonly blurb: string;
  /** Emoji for the panel and the inventory drawer. */
  readonly icon: string;
  readonly price: number;
  readonly kind: InventoryKind;
  readonly category: CuteCategory;
  /** Can be held in the hand (and later join the parade). */
  readonly carryable: boolean;
  /** Fresh model, origin at the base, facing +Z. */
  readonly model: () => AssetHandle;
  /** Scale to use when it is in the player's hand. */
  readonly heldScale: number;
  /** True for stock that is only on sale sometimes — the rainbow floss. */
  readonly rare: boolean;
}

const ICE_SCOOPS = {
  bubblegum: [PALETTE.markerPink],
  custard: [PALETTE.flowerYellow],
  minty: [PALETTE.markerMint],
  rainbow: [PALETTE.markerPink, PALETTE.flowerYellow, PALETTE.markerSky],
} as const;

export const SHOP_ITEMS: readonly ShopItem[] = [
  // ------------------------------------------------------------------- toys
  {
    id: 'toy.ripika',
    shopId: 'toy',
    displayName: 'RiPika',
    blurb: 'The electric yellow mouse!',
    icon: '⚡',
    price: 40,
    kind: 'toy',
    category: 'toy',
    carryable: true,
    model: () => createRipika(),
    heldScale: 0.3,
    rare: false,
  },
  {
    id: 'toy.biscuit',
    shopId: 'toy',
    displayName: 'Biscuit',
    blurb: 'A teddy in a red jumper with two hearts.',
    icon: '🧸',
    price: 45,
    kind: 'toy',
    category: 'toy',
    carryable: true,
    model: () => createBiscuit(),
    heldScale: 0.32,
    rare: false,
  },
  {
    id: 'toy.star',
    shopId: 'toy',
    displayName: 'Twinkle Star',
    blurb: 'A squishy star with a very small smile.',
    icon: '⭐',
    price: 20,
    kind: 'toy',
    category: 'toy',
    carryable: true,
    model: () => createStarToy(PALETTE.flowerYellow),
    heldScale: 0.62,
    rare: false,
  },

  // The toy shop's one gadget, and Eleri's own ask: *"add a shop that sells a
  // jet pack, and when you use it your pet gets one too."* Not `carryable` —
  // it goes straight onto her back on purchase (`GameStore.buy`) rather than
  // into her hands, because a child who has just bought a jet pack wants to
  // fly, and a rocket carried like a shopping bag is nobody's idea of one.
  {
    id: 'gear.jetpack',
    shopId: 'toy',
    displayName: 'Jet Pack',
    blurb: 'Press fly and off you go!',
    icon: '🚀',
    price: 60,
    kind: 'jetpack',
    // Filed under Toys in the Cute-o-dex, which is where it is sold and what it
    // is: a toy rocket. A section of its own would be a page with one thing on.
    category: 'toy',
    carryable: false,
    model: () => createJetpack(),
    // Never in a hand, so this is only ever read by code that does not run for
    // it. Kept at the neutral 1 rather than 0, so a future carried-gear feature
    // starts from life size rather than from a thing that has vanished.
    heldScale: 1,
    rare: false,
  },

  // --------------------------------------------------------------- balloons
  {
    id: 'balloon.dalmatian',
    shopId: 'balloon',
    displayName: 'Fire Pup',
    blurb: 'A fire-fighting dalmatian pup balloon.',
    icon: '🐶',
    price: 25,
    kind: 'balloon',
    category: 'balloon',
    carryable: true,
    model: () => createBalloon('dalmatian'),
    heldScale: 0.72,
    rare: false,
  },
  {
    id: 'balloon.corgi',
    shopId: 'balloon',
    displayName: 'Flying Corgi',
    blurb: 'Pink flying glasses. Hold on tight and float!',
    icon: '🐕',
    price: 30,
    kind: 'balloon',
    category: 'balloon',
    carryable: true,
    model: () => createBalloon('corgi'),
    heldScale: 0.72,
    rare: false,
  },
  {
    id: 'balloon.chicken',
    shopId: 'balloon',
    displayName: 'Chicken-looter',
    blurb: 'A white and red chicken. Watch your snacks!',
    icon: '🐔',
    price: 28,
    kind: 'balloon',
    category: 'balloon',
    carryable: true,
    model: () => createBalloon('chicken'),
    heldScale: 0.72,
    rare: false,
  },

  // ------------------------------------------------------------ candy floss
  {
    id: 'floss.pink',
    shopId: 'candyFloss',
    displayName: 'Pink Candy Floss',
    blurb: 'A cloud of pink fluff on a stick.',
    icon: '🍬',
    price: 8,
    kind: 'treat',
    category: 'candyfloss',
    carryable: true,
    model: () => createCandyFloss('pink'),
    heldScale: 0.62,
    rare: false,
  },
  {
    id: 'floss.blue',
    shopId: 'candyFloss',
    displayName: 'Blue Candy Floss',
    blurb: 'Tastes like the sky, apparently.',
    icon: '🩵',
    price: 8,
    kind: 'treat',
    category: 'candyfloss',
    carryable: true,
    model: () => createCandyFloss('blue'),
    heldScale: 0.62,
    rare: false,
  },
  {
    id: 'floss.rainbow',
    shopId: 'candyFloss',
    displayName: 'Rainbow Candy Floss',
    blurb: 'Very rare — only when the machine feels like it!',
    icon: '🌈',
    price: 15,
    kind: 'treat',
    category: 'candyfloss',
    carryable: true,
    model: () => createCandyFloss('rainbow'),
    heldScale: 0.62,
    rare: true,
  },

  // -------------------------------------------------------------- ice cream
  {
    id: 'ice.bubblegum',
    shopId: 'iceCream',
    displayName: 'Bubblegum Wobble',
    blurb: 'One scoop. It wobbles when you walk.',
    icon: '🍦',
    price: 10,
    kind: 'treat',
    category: 'icecream',
    carryable: true,
    model: () => createIceCream(ICE_SCOOPS.bubblegum),
    heldScale: 0.62,
    rare: false,
  },
  {
    id: 'ice.custard',
    shopId: 'iceCream',
    displayName: 'Custard & Sprinkles',
    blurb: 'Silly, and a little bit lovely.',
    icon: '🍨',
    price: 10,
    kind: 'treat',
    category: 'icecream',
    carryable: true,
    model: () => createIceCream(ICE_SCOOPS.custard),
    heldScale: 0.62,
    rare: false,
  },
  {
    id: 'ice.minty',
    shopId: 'iceCream',
    displayName: 'Minty Moon',
    blurb: 'Green as a moon that ate too much mint.',
    icon: '🌙',
    price: 10,
    kind: 'treat',
    category: 'icecream',
    carryable: true,
    model: () => createIceCream(ICE_SCOOPS.minty),
    heldScale: 0.62,
    rare: false,
  },
  {
    id: 'ice.rainbowTriple',
    shopId: 'iceCream',
    displayName: 'Triple-Decker Rainbow',
    blurb: 'Three whole scoops. The famous one.',
    icon: '🌈',
    price: 18,
    kind: 'treat',
    category: 'icecream',
    carryable: true,
    model: () => createIceCream(ICE_SCOOPS.rainbow),
    heldScale: 0.55,
    rare: false,
  },

  // -------------------------------------------------------------------- hats
  {
    id: 'hat.party',
    shopId: 'hat',
    displayName: 'Party Hat',
    blurb: 'Pointy, with a bobble on top.',
    icon: '🎉',
    price: 12,
    kind: 'hat',
    category: 'hat',
    carryable: true,
    model: () => createHat('party'),
    heldScale: 0.7,
    rare: false,
  },
  {
    id: 'hat.crown',
    shopId: 'hat',
    displayName: 'Sparkly Crown',
    blurb: 'For being in charge of the whole park.',
    icon: '👑',
    price: 22,
    kind: 'hat',
    category: 'hat',
    carryable: true,
    model: () => createHat('crown'),
    heldScale: 0.7,
    rare: false,
  },
  {
    id: 'hat.bobble',
    shopId: 'hat',
    displayName: 'Bobble Hat',
    blurb: 'Woolly, warm, enormous bobble.',
    icon: '🧶',
    price: 14,
    kind: 'hat',
    category: 'hat',
    carryable: true,
    model: () => createHat('bobble'),
    heldScale: 0.7,
    rare: false,
  },
  {
    id: 'hat.sun',
    shopId: 'hat',
    displayName: 'Sun Hat',
    blurb: 'A brim as wide as a small table.',
    icon: '👒',
    price: 16,
    kind: 'hat',
    category: 'hat',
    carryable: true,
    model: () => createHat('sun'),
    heldScale: 0.7,
    rare: false,
  },
  {
    id: 'hat.cap',
    shopId: 'hat',
    displayName: 'Cheery Cap',
    blurb: 'Minty, with a little green peak.',
    icon: '🧢',
    price: 12,
    kind: 'hat',
    category: 'hat',
    carryable: true,
    model: () => createHat('cap'),
    heldScale: 0.7,
    rare: false,
  },
  {
    id: 'hat.flower',
    shopId: 'hat',
    displayName: 'Flower Crown',
    blurb: 'Six blossoms on a leafy band.',
    icon: '🌼',
    price: 18,
    kind: 'hat',
    category: 'hat',
    carryable: true,
    model: () => createHat('flower'),
    heldScale: 0.7,
    rare: false,
  },
  {
    id: 'hat.ripikaHat',
    shopId: 'hat',
    displayName: 'RiPika Cap',
    blurb: 'A plush cap with RiPika ears and cheeks.',
    icon: '⚡',
    price: 30,
    kind: 'hat',
    category: 'hat',
    carryable: true,
    model: () => createHat('ripikaHat'),
    heldScale: 0.7,
    rare: false,
  },
  {
    id: 'hat.puff',
    shopId: 'hat',
    displayName: `${PUFF_DISPLAY_NAME} Hat`,
    blurb: 'A humming pink hood with floppy earflaps.',
    icon: '🎀',
    price: 26,
    kind: 'hat',
    category: 'hat',
    carryable: true,
    model: () => createHat('puff'),
    heldScale: 0.7,
    rare: false,
  },

  // ------------------------------------------------------- stickers and pets
  {
    id: 'sticker.stars',
    shopId: 'stickerPet',
    displayName: 'Star Stickers',
    blurb: 'A whole sheet of twinkly stars.',
    icon: '✨',
    price: 6,
    kind: 'sticker',
    category: 'sticker',
    carryable: true,
    model: () => createStickerSheet(PALETTE.blossomWhite, PALETTE.flowerYellow),
    heldScale: 0.65,
    rare: false,
  },
  {
    id: 'sticker.hearts',
    shopId: 'stickerPet',
    displayName: 'Heart Stickers',
    blurb: 'Shiny hearts for absolutely everything.',
    icon: '💖',
    price: 6,
    kind: 'sticker',
    category: 'sticker',
    carryable: true,
    model: () => createStickerSheet(PALETTE.stonePinkLight, PALETTE.markerPink),
    heldScale: 0.65,
    rare: false,
  },
  {
    id: 'pet.bunny',
    shopId: 'stickerPet',
    displayName: 'Little Bunny',
    blurb: 'Hops. Will follow you about.',
    icon: '🐰',
    price: 35,
    kind: 'pet',
    category: 'pet',
    carryable: true,
    model: () => createPet('bunny'),
    heldScale: 0.45,
    rare: false,
  },
  {
    id: 'pet.kitten',
    shopId: 'stickerPet',
    displayName: 'Little Kitten',
    blurb: 'Very small, very pleased with itself.',
    icon: '🐱',
    price: 35,
    kind: 'pet',
    category: 'pet',
    carryable: true,
    model: () => createPet('kitten'),
    heldScale: 0.45,
    rare: false,
  },
  {
    id: 'pet.mouse',
    shopId: 'stickerPet',
    displayName: 'Little Mouse',
    blurb: 'Lilac, whiskery, likes pockets.',
    icon: '🐭',
    price: 35,
    kind: 'pet',
    category: 'pet',
    carryable: true,
    model: () => createPet('mouse'),
    heldScale: 0.45,
    rare: false,
  },
  {
    id: 'pet.puff',
    shopId: 'stickerPet',
    displayName: PUFF_DISPLAY_NAME,
    blurb: 'A jiggly pink puff who bursts into little songs.',
    icon: '🎵',
    price: 38,
    kind: 'pet',
    category: 'pet',
    carryable: true,
    model: () => createPet('puff'),
    heldScale: 0.45,
    rare: false,
  },

  // ----------------------------------------------------------- surprise eggs
  {
    id: 'egg.surprise',
    shopId: 'surpriseEgg',
    displayName: 'Surprise Egg',
    blurb: 'Nobody knows what is inside. Not even the shop.',
    icon: '🥚',
    price: 20,
    kind: 'egg',
    category: 'egg',
    carryable: true,
    model: () => createSurpriseEgg(PALETTE.stonePinkLight, PALETTE.markerLilac),
    heldScale: 0.7,
    rare: false,
  },

  // --------------------------------------------------------- the spooky house
  // Not sold anywhere — poured out by the mouth in the spooky house mini-game
  // (`minigames/spookyHouse/candyShower.ts`). `shopId: 'spookyHouse'` never
  // matches a real `ShopId`, so `itemsForShop` never puts it on a shelf; living
  // in `SHOP_ITEMS` is only so the Cute-o-dex (`ui/CuteODex.ts`, built from
  // `[...SHOP_ITEMS, ...EGG_PRIZES]`) picks it up without a second list to keep
  // in step. One entry, not one per shower colour — the colours are a visual
  // flourish (see the comment on `CANDY_COLOURS` in `candyShower.ts`), not
  // different things to collect. Filed under the existing "Candy floss"
  // Cute-o-dex page since it is a `treat` exactly like its neighbours there.
  {
    id: 'candy.spookyHouse',
    shopId: 'spookyHouse',
    displayName: 'Spooky Sweet',
    blurb: 'A sweet from the giggling mouth.',
    icon: '🍬',
    price: 0,
    kind: 'treat',
    category: 'candyfloss',
    carryable: true,
    model: () => createSpookyCandy(),
    heldScale: 0.9,
    rare: false,
  },

  // ----------------------------------------------------------- the keychains
  // Collected at the garden stall, never bought — hence `price: 0`, and hence
  // `shopId: 'keychainStall'`, which matches no real `ShopId` so `itemsForShop`
  // never puts one on a shelf inside the tower. Same trick as
  // `candy.spookyHouse` above, and for the same reason: being in `SHOP_ITEMS`
  // is what gets them the Cute-o-dex page, the save, the counts, the brevity
  // check and the asset check with no second list to keep in step.
  //
  // Not `carryable` and not paradeable. A keychain is worn on the bag or it is
  // in the bag; there is no third thing it can be doing, which is what makes
  // `wearableSlot('keychain')` the only sensible answer to tapping one in the
  // backpack drawer.
  ...KEYCHAIN_KINDS.map((kind) => ({
    id: `keychain.${kind}`,
    shopId: 'keychainStall' as const,
    ...KEYCHAIN_COPY[kind],
    price: 0,
    kind: 'keychain' as const,
    category: 'keychain' as const,
    carryable: false,
    model: () => createKeychain(kind),
    // Never held — kept sane rather than zero so a preview that scales by it
    // cannot collapse the keyring to nothing.
    heldScale: 1,
    rare: false,
  })),
];

export function itemsForShop(shopId: ShopId): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.shopId === shopId);
}

/**
 * The pet species a given shop actually **sells**.
 *
 * `PET_KINDS` answers a different question — *which pet bodies can `pets.ts`
 * build?* — and the two stopped being the same list the moment RiPika became a
 * {@link PetKind} while still being sold as `toy.ripika` in the toy shop. A
 * display that iterates `PET_KINDS` is therefore advertising stock its shop
 * does not carry, which is what the sticker & pet shop's pen did the first time
 * this was tried.
 *
 * Reading the species off the id's tail is the same move
 * `Hotel.paradePetKind()` makes, and for the same reason: **the species lives
 * in the catalogue `id`, not in `kind`** (`kind` is the category — `'pet'`,
 * `'toy'`). So a pet the shop gains tomorrow shows up in its own pen the day it
 * is added, with no second list to keep in step.
 */
export function petKindsForShop(shopId: ShopId): PetKind[] {
  const known: readonly string[] = PET_KINDS;
  return itemsForShop(shopId)
    .filter((item) => item.kind === 'pet')
    .map((item) => item.id.slice(item.id.lastIndexOf('.') + 1))
    .filter((species): species is PetKind => known.includes(species));
}

/**
 * The five keychains, in catalogue order — the garden stall's whole display.
 *
 * `itemsForShop` cannot answer this: it takes a real {@link ShopId}, and
 * `'keychainStall'` deliberately is not one (see {@link ShopItem.shopId}'s own
 * doc comment). One small function rather than a second filter written out at
 * the call site, so `world/KeychainShop.ts` and `ui/KeychainPanel.ts` cannot
 * quietly disagree about which five entries the stall means.
 */
export function keychainItems(): readonly ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.shopId === 'keychainStall');
}

/**
 * What can be inside a surprise egg.
 *
 * Four prizes, all of them small models the game already has, so a hatch never
 * has to load anything. They are catalogue entries in their own right — the
 * Cute-o-dex has to be able to say "you found the egg RiPika" — but they are not
 * on any shelf, which is what `SHOP_ITEMS` means.
 */
export const EGG_PRIZES: readonly ShopItem[] = [
  {
    id: 'egg.prize.ripika',
    shopId: 'surpriseEgg',
    displayName: 'Tiny RiPika',
    blurb: 'It was RiPika all along!',
    icon: '⚡',
    price: 0,
    kind: 'toy',
    category: 'egg',
    carryable: true,
    model: () => createRipika(),
    heldScale: 0.24,
    rare: false,
  },
  {
    id: 'egg.prize.biscuit',
    shopId: 'surpriseEgg',
    displayName: 'Tiny Biscuit',
    blurb: 'A teeny teddy in a red jumper.',
    icon: '🧸',
    price: 0,
    kind: 'toy',
    category: 'egg',
    carryable: true,
    model: () => createBiscuit(),
    heldScale: 0.26,
    rare: false,
  },
  {
    id: 'egg.prize.star',
    shopId: 'surpriseEgg',
    displayName: 'Tiny Star',
    blurb: 'A squishy star, folded up small.',
    icon: '⭐',
    price: 0,
    kind: 'toy',
    category: 'egg',
    carryable: true,
    model: () => createStarToy(PALETTE.markerLilac),
    heldScale: 0.5,
    rare: false,
  },
  {
    id: 'egg.prize.mouse',
    shopId: 'surpriseEgg',
    displayName: 'Tiny Mouse',
    blurb: 'A whiskery lilac mouse, fast asleep.',
    icon: '🐭',
    price: 0,
    kind: 'pet',
    category: 'egg',
    carryable: true,
    model: () => createPet('mouse'),
    heldScale: 0.4,
    rare: false,
  },
];

/**
 * Every catalogue entry there is, on sale or not — the shelves and the egg
 * prizes in one list.
 *
 * Exported because "everything a child can end up owning" is a real question
 * with real askers: {@link shopItem}'s own index below, and
 * `world/hotel/petBedFit.ts`, which measures every companion in it to find out
 * how big a pet bed has to be. A second `[...SHOP_ITEMS, ...EGG_PRIZES]`
 * written out at a call site is a list that stops being every entry the day a
 * third table appears.
 */
export const ALL_CATALOGUE_ITEMS: readonly ShopItem[] = [...SHOP_ITEMS, ...EGG_PRIZES];

/**
 * Look-up by id.
 *
 * Built after both tables so that a look-up by id finds egg prizes too — the
 * carried-item system is handed an id and has no idea whether it came off a
 * shelf or out of an egg.
 */
const BY_ID = new Map<string, ShopItem>(ALL_CATALOGUE_ITEMS.map((item) => [item.id, item]));

export function shopItem(id: string): ShopItem | null {
  return BY_ID.get(id) ?? null;
}

/** Picks a prize. `seed` should be the purchase number, so it is repeatable. */
export function eggPrize(seed: number): ShopItem {
  const rng = new Rng(4242 + seed * 977);
  return rng.pick(EGG_PRIZES);
}

/**
 * Whether the rainbow candy floss is on sale right now.
 *
 * It appears for one short window on *some* days, which is the whole point of a
 * rare thing: a child who wants it has to come back and look. Seeded off the day
 * number, so the window is the same for everyone playing that day and a shop
 * that says "back soon!" is telling the truth.
 */
export function rainbowFlossAvailable(day: number, timeOfDay: number): boolean {
  const window = rainbowFlossWindow(day);
  if (!window) return false;
  return timeOfDay >= window[0] && timeOfDay < window[1];
}

/** The day's rainbow window as `[start, end]` in clock fractions, or null. */
export function rainbowFlossWindow(day: number): [number, number] | null {
  const rng = new Rng(9001 + day * 7919);
  // Roughly three days in five have one at all.
  if (!rng.chance(0.6)) return null;
  const start = rng.range(0.26, 0.76);
  return [start, start + 0.16];
}
