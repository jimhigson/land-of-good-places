import { gameStore } from './store';

/**
 * Things to *do*, as opposed to things to own.
 *
 * The Cute-o-dex has always had a "Secrets 🌟" section and nothing has ever
 * been in it — every other page is built from the shop catalogue, and a shop
 * cannot sell you "run fast enough to kick up dust". So secrets get their own
 * little table, the same way flowers do (`FLOWER_COLOURS`, picked rather than
 * bought, rendered from their own list in `CuteODex`).
 *
 * They are recorded through the ordinary {@link gameStore.collect} path, so a
 * secret is a `CuteThing` like any other: it shows as a silhouette until you
 * do it, it counts towards the book's total, it is saved and restored with
 * everything else, and the completion prize waits for it.
 *
 * The point of a "thing to do" is that nobody tells you about it. The card
 * says `???` until it happens, and then it says what you did — which is how a
 * six-year-old finds out that running was worth doing.
 */
export interface Secret {
  /** Stable id and Cute-o-dex key, e.g. `secret.dust`. */
  readonly id: string;
  /** What the card is called once it is found. */
  readonly name: string;
  /** Its emoji — shown crushed to a silhouette while it is still unfound. */
  readonly icon: string;
  /** What the card says underneath, once you have done it. */
  readonly done: string;
}

export const SECRETS: readonly Secret[] = [
  {
    id: 'secret.dust',
    name: 'Dust cloud',
    icon: '💨',
    done: 'You ran so fast you kicked up dust!',
  },
  {
    id: 'secret.railRace',
    name: 'Race winner',
    icon: '🏆',
    done: 'You beat the other cart on the rails!',
  },
  {
    id: 'secret.keychain',
    name: 'Keyring collector',
    icon: '🔑',
    done: 'You collected your first keychain!',
  },
  // The Reptile House's two deeds (`world/reptileHouse/`): every one of its
  // fifteen exhibits greeted, and all five hiding baby snakes found.
  {
    id: 'secret.metTheReptiles',
    name: 'Reptile friend',
    icon: '🦎',
    done: 'You said hi to every animal in the house!',
  },
  {
    id: 'secret.snakeSpotter',
    name: 'Snake spotter',
    icon: '🐍',
    done: 'You found all five hiding baby snakes!',
  },
  // The Library's story time (#718): sat on a story cushion from before the
  // owl's first word to her last — awarded by `world/library/storyTime.ts`.
  {
    id: 'secret.storyTime',
    name: 'Story listener',
    icon: '📖',
    done: 'You sat and listened to a whole story!',
  },
  // The Library's big readers' shelf (track D of #714): every chapter book
  // read to its end. Awarded by `world/library/readBooks.ts`'s `markBookRead`,
  // the one owner of that rule. The picture books keep their own prize.
  {
    id: 'secret.bigReader',
    name: 'Big reader',
    icon: '📚',
    done: 'You read every chapter book!',
  },
];

const BY_ID = new Map<string, Secret>(SECRETS.map((secret) => [secret.id, secret]));

/**
 * Records a thing-to-do as done, the first time it happens.
 *
 * Deliberately cheap enough to call from a hot path — the dust effect calls it
 * on every single footfall — because the alternative is the caller keeping its
 * own "have I done this yet" flag, which is a flag that a save/reload can get
 * out of step with the book. After the first time this is one map lookup and
 * one property read, and it allocates nothing.
 *
 * `placement` has to be one of the `CUTE_PLACEMENTS`, none of which really
 * describes a deed; `backpack` is the inert one — only `parade` has any effect
 * on the world, and nothing walks behind you because you ran fast.
 */
export function discoverSecret(id: string): void {
  if (gameStore.get().collection[id]?.discovered === true) return;
  const secret = BY_ID.get(id);
  if (!secret) return;
  gameStore.collect(secret.id, secret.name, 'secret', 'backpack');
}
