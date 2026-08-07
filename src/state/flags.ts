/**
 * The one-time things — "has this already happened on this device?"
 *
 * There used to be four of these, each a tiny module with its own
 * `localStorage` key, its own try/catch and its own private idea of what a
 * remembered thing looks like: `ui/characterCreationFlag.ts`,
 * `world/entrance/arrivalFlag.ts`, `ui/DexPrize.ts` and `ui/WhatsNew.ts`. Three
 * storage schemes plus a save file would have been four, so they are all held
 * here instead, in memory, and written to disk as part of the one save
 * (`state/save.ts`'s {@link SavedFlags}).
 *
 * The four call sites keep their own small friendly APIs — `hasSeenDexPrize()`
 * still means what it always meant — they just ask this rather than the
 * browser. Nothing here touches `localStorage`: the autosave does that, on its
 * own schedule, for everything at once.
 */

import type { SavedFlags } from './save';

class SaveFlags {
  private createdCharacterFlag = false;
  private arrivedByBusFlag = false;
  private dexPrizeSeenFlag = false;
  private whatsNewSeenIdValue: number | null = null;
  private hotelKeyFlag = false;
  private changes = 0;

  /**
   * Bumped by every change, so the autosave can tell whether anything
   * happened. The same job `gameStore.revision` does for the park itself; a
   * save's dirty check is the sum of the two.
   */
  get revision(): number {
    return this.changes;
  }

  /** Applies a loaded save. Absent fields keep their "never happened" default. */
  hydrate(flags: SavedFlags): void {
    if (flags.createdCharacter !== undefined) this.createdCharacterFlag = flags.createdCharacter;
    if (flags.arrivedByBus !== undefined) this.arrivedByBusFlag = flags.arrivedByBus;
    if (flags.dexPrizeSeen !== undefined) this.dexPrizeSeenFlag = flags.dexPrizeSeen;
    if (flags.hotelKey !== undefined) this.hotelKeyFlag = flags.hotelKey;
    if (flags.whatsNewSeenId !== undefined) this.whatsNewSeenIdValue = flags.whatsNewSeenId;
    this.changes += 1;
  }

  /**
   * The flags, as the save file wants them.
   *
   * Built fresh rather than aliased — unlike `gameStore.savedGame`, which
   * points at live sub-objects to stay cheap. This one is four fields, so a
   * literal costs nothing and nobody has to remember not to keep it.
   */
  snapshot(): SavedFlags {
    const flags: {
      createdCharacter: boolean;
      arrivedByBus: boolean;
      dexPrizeSeen: boolean;
      hotelKey: boolean;
      whatsNewSeenId?: number;
    } = {
      createdCharacter: this.createdCharacterFlag,
      arrivedByBus: this.arrivedByBusFlag,
      dexPrizeSeen: this.dexPrizeSeenFlag,
      hotelKey: this.hotelKeyFlag,
    };
    // Omitted rather than null: `exactOptionalPropertyTypes`, and "never seen
    // one" is exactly what an absent field means everywhere else in the save.
    if (this.whatsNewSeenIdValue !== null) flags.whatsNewSeenId = this.whatsNewSeenIdValue;
    return flags;
  }

  // ------------------------------------------------------------ the flags

  /** True once this browser has been through the character creator. */
  get createdCharacter(): boolean {
    return this.createdCharacterFlag;
  }

  markCharacterCreated(): void {
    if (this.createdCharacterFlag) return;
    this.createdCharacterFlag = true;
    this.changes += 1;
  }

  /** True once the cat bus has already brought her to the park. */
  get arrivedByBus(): boolean {
    return this.arrivedByBusFlag;
  }

  markArrived(): void {
    if (this.arrivedByBusFlag) return;
    this.arrivedByBusFlag = true;
    this.changes += 1;
  }

  /** True once the Cute-o-dex 100% celebration has fired. */
  get dexPrizeSeen(): boolean {
    return this.dexPrizeSeenFlag;
  }

  markDexPrizeSeen(): void {
    if (this.dexPrizeSeenFlag) return;
    this.dexPrizeSeenFlag = true;
    this.changes += 1;
  }

  /** True once the Land Hotel's reception has given her the room key. */
  hasHotelKey(): boolean {
    return this.hotelKeyFlag;
  }

  giveHotelKey(): void {
    if (this.hotelKeyFlag) return;
    this.hotelKeyFlag = true;
    this.changes += 1;
  }

  /** Newest what's-new entry already read, or `null` on a first-ever visit. */
  get whatsNewSeenId(): number | null {
    return this.whatsNewSeenIdValue;
  }

  setWhatsNewSeenId(id: number): void {
    if (this.whatsNewSeenIdValue === id) return;
    this.whatsNewSeenIdValue = id;
    this.changes += 1;
  }
}

/** The one and only flags instance. Import this, don't construct your own. */
export const saveFlags = new SaveFlags();
