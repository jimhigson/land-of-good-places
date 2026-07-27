# Handoff — save / continue

Branch `save-continue`, from `origin/main` @ `5b2ccdd`.

Task: autosave to localStorage every 5s and on the way out; on load offer
**continue** or **start again** (fresh character creation) in front of the
character creator in `main.ts`'s `boot()`.

---

## 1. The schema (decided — this is the part worth banking)

One key, one object, replacing the four ad-hoc flags that exist today.

```
localStorage['lgp:save'] = JSON.stringify(SaveFile)
```

```ts
const SAVE_VERSION = 1;

interface SaveFile {
  /** Schema version. Bumped ONLY for an incompatible change (see §1.3). */
  v: number;
  /** Date.now() at write. Purely informational ("last played"). */
  at: number;
  /** The store's private uid counter, so restored uids can never be re-minted. */
  purchases: number;
  game: SavedGame;
  place: SavedPlace;
  flags: SavedFlags;
}

interface SavedGame {
  parkName: string;
  mode: GameMode;
  money: number;
  splashPoints: number;
  bestSplashPoints: number;
  player: PlayerState;      // name, kind, skin/hair/outfit/eye colour,
                            // hairStyle, health, maxHealth, facePaint
  world: WorldState;        // timeOfDay, dayCount, lightsOn
  collection: Record<string, CuteThing>;   // the Cute-o-dex
  inventory: InventoryItem[];              // everything owned; `stowed` is
                                           // what says parade vs backpack
  carriedUid: string | null;
  wornFlowerUid: string | null;
  wornHatUid: string | null;
}

/** Never a raw world coordinate — see §1.1. */
interface SavedPlace {
  space: string;   // 'garden' | 'castle' today; 'floor0'… after Decision 3
  x: number; y: number; z: number;   // LOCAL to that space's origin
  facing: number;  // yaw, radians
}

interface SavedFlags {
  createdCharacter: boolean;  // was 'lgp:hasCreatedCharacter'
  arrivedByBus: boolean;      // was 'lgp:hasArrivedByBus'
  dexPrizeSeen: boolean;      // was DexPrize's own key
  whatsNewSeenId: number;     // was WhatsNew's 'lastSeenWhatsNewId'
}
```

**Deliberately not saved:** `paused` and `debugOverlay` (transient — you should
never load back into a paused game), and `moneyIsFinite` (derived from `mode`,
recomputed by `setMode` on load). Position is not stored raw (§1.1).

### 1.1 Position survives Decision 3

ARCHITECTURE-DECISIONS Decision 3 splits the castle into five spaces at
origins `(600 + 300k, 600)`. A saved `x/z` of `612, 604` means "next to the
lift on floor 0" tonight and "somewhere in the middle of nothing" afterwards.
So the save stores a **space id plus a position local to that space's
origin**. Today there are two spaces:

| space id  | origin                                            |
|-----------|---------------------------------------------------|
| `garden`  | `(0, 0, 0)`                                       |
| `castle`  | `(INTERIOR_ORIGIN_X, BUILDING_BASE_Y, INTERIOR_ORIGIN_Z)` |

After Decision 3, `castle` simply stops being a known space id, and an old
save resolves to the default garden spawn — a degraded restore, not a broken
one, and every other field still loads. That is the intended behaviour and is
exactly why the id is a string rather than an index.

### 1.2 Adding a field must be trivial and never fatal

Loading is **tolerant per field**, not all-or-nothing. Every field is read
through a checked accessor and falls back to the corresponding value from
`createInitialState()` when it is missing or the wrong type. Consequences:

- Adding a new field later needs **no version bump at all**: an older save
  simply lacks it and gets the default.
- Nine hair styles are not on `main` yet (`HairStyle` is still
  `bunches|bob|short`). When they land, a saved `hairStyle` that is not in
  the current union falls back to the default style rather than handing an
  unknown string to the art layer.
- Same rule for `facePaint`, `mode`, `kind`, `flowerColour`, and every
  `*Uid` (a uid that names nothing in the restored inventory becomes `null`).

### 1.3 Version bumps and how migration failure degrades

`v` exists for the changes tolerance cannot absorb — a field whose *meaning*
changes, or a restructure. Policy:

- `v === SAVE_VERSION` → load.
- `v < SAVE_VERSION` → run the migration chain `MIGRATIONS[n]: (old) => next`
  step by step. If any step is missing or throws, the save is **unreadable**.
- `v > SAVE_VERSION` (a save written by a newer deploy, then the browser
  serving an older cached bundle) → unreadable. Never guessed at.
- Malformed JSON, a non-object, a missing `v` → unreadable.

**Unreadable never crashes and never half-loads.** `loadSave()` returns
`null`; the boot screen then offers *only* "Start a new adventure", the
character creator runs, and the first autosave overwrites the bad blob. The
whole read is wrapped so that a `localStorage` that throws on access (Safari
private mode, as the existing flag files already handle) is just another
`null`.

### 1.4 Cheap writes

ARCHITECTURE-REVIEW keeps an allocation-suspect list and there is a standing
GC-pause complaint, so:

- The save object is a **small top-level literal that references the live
  sub-objects** (`player`, `world`, `collection`, `inventory`) rather than a
  deep copy. `JSON.stringify` walks them in place; per tick we allocate one
  small object plus the string, not a cloned graph.
- The interval only writes when something actually changed — a revision
  counter bumped by the store subscription, plus the player position
  quantised to 0.25 m.
- **Never on a blocked frame.** A `canSave()` predicate refuses while a
  mini-game is starting or frozen, while a space transition / iris is
  running, and while the player is riding. A refused tick stays dirty and
  retries on the next one.
- The timer is a `setInterval`, so it fires between frames, never inside
  `tick()`.
- On the way out, if saving is currently blocked, the *last known good*
  place snapshot is written instead of the live (mid-teleport) position.
  Losing five seconds of walking beats saving a bogus coordinate.

### 1.5 Leaving on iOS

`beforeunload` is unreliable on iOS, so the exit write is hooked to all
three: `pagehide`, `visibilitychange` (when `document.visibilityState` is
`hidden`), and `beforeunload`. The write is idempotent and revision-gated, so
firing all three costs one write.

---

## 2. Files

- `src/state/save.ts` (new) — schema, `loadSave()`, `writeSave()`, migrations.
- `src/state/store.ts` — `hydrate(saved)` + `snapshot()` + `revision`.
- `src/SaveSystem.ts` (new) — the 5 s timer and the exit listeners.
- `src/ui/ContinueOrRestart.ts` (new) — the boot choice screen.
- `src/main.ts` — the choice goes in `boot()`, in front of `CharacterCreation`.
- Retired into the one save: `src/ui/characterCreationFlag.ts`,
  `src/world/entrance/arrivalFlag.ts`, `src/ui/DexPrize.ts`'s key,
  `src/ui/WhatsNew.ts`'s key.

## 3. Progress

- [x] Schema decided and written down (this file).
- [ ] `save.ts`
- [ ] store hydrate/snapshot
- [ ] SaveSystem
- [ ] boot choice UI
- [ ] fold in the three existing flags
- [ ] `npm run build` green, PR raised

## 4. Notes for whoever picks this up

- The browser is owned by another agent tonight — build-verify only, and list
  what needs visual QA in the PR.
- `gameStore` is a singleton with a private `purchaseCount`; hydration must
  restore it or a new purchase can re-mint a uid that a restored item holds.
- `Player` reads `gameStore.get().player` in its constructor, so hydration
  must happen **before** `new Game(...)`, exactly like character creation does.
