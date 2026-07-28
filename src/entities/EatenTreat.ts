import type { Group } from 'three';
import { clamp01 } from '../core/mathUtils';
import { disposeTree } from '../art/style/materials';
import type { AssetHandle } from '../art/style/asset';
import { shopItem } from '../world/building/shops/catalogue';
import { EAT_BITES, EAT_SECONDS, biteAt } from '../ui/chime';

/**
 * The ice cream, for as long as it lasts.
 *
 * GAME_DESIGN.md, the family's words: *"keeping ice cream in a backpack
 * doesn't really make sense — in this case make an eating sound effect and
 * show a 3d model of the ice cream for a few seconds, add it as eaten to the
 * cute-o-dex and the player doesn't carry it around."* The store handles the
 * last two (`isEdible` and the `eaten` placement, in `state/store.ts`); this
 * is the few seconds.
 *
 * It is the one thing in the game that is deliberately **not** a store
 * subscriber, and `entities/CarriedItem.ts`'s doc comment says why by
 * contrast: a held toy is a *fact about the save* that any number of systems
 * may change, so it is read from the state. Eating is not a fact, it is a
 * moment — it happens once, it has a beginning, and there is nothing left of
 * it afterwards to put in a save file. Modelling that as a state field would
 * mean a "currently eating" flag that a reload in the middle of a bite could
 * strand. So {@link Shopping} starts it directly, from the one `Acquisition`
 * that says `eaten`.
 *
 * The model is the shop's own — the same asset as the one on the counter, at
 * its `heldScale` — and it is chewed down in {@link EAT_BITES} steps over
 * {@link EAT_SECONDS}, in time with `playEatingSound`'s crunches.
 *
 * **Pooled.** ARCHITECTURE-REVIEW.md has a standing GC-pause complaint and a
 * suspect list; a six-year-old on an ice-cream spree would otherwise build and
 * throw away a fresh scoop-and-cone every ten seconds. Models are kept by
 * catalogue id and re-used, which bounds the pool at the number of edible
 * things in the catalogue (eight) no matter how many are eaten.
 */
export class EatenTreat {
  private readonly anchor: Group;

  /** One retained model per catalogue id — see the class doc. */
  private readonly pool = new Map<string, AssetHandle>();

  private handle: AssetHandle | null = null;
  /** The current treat's `heldScale`, read once on `start` rather than per frame. */
  private scale = 1;
  private time = 0;

  /** `anchor` is the character's `holdAnchor` — the same hand a toy is held in. */
  constructor(anchor: Group) {
    this.anchor = anchor;
  }

  /** True while something is being eaten. `CarriedItem` steps aside for it. */
  get active(): boolean {
    return this.handle !== null;
  }

  /**
   * Starts the munch for one catalogue id.
   *
   * Eating a second thing mid-bite simply restarts with the new one: there is
   * only one mouth, and one hand to hold it in.
   */
  start(itemId: string): void {
    const item = shopItem(itemId);
    if (!item) return;
    this.put();

    let handle = this.pool.get(itemId);
    if (!handle) {
      handle = item.model();
      handle.root.name = itemId;
      this.pool.set(itemId, handle);
    }
    // Tipped forward a touch, exactly as a carried thing is, so a treat sits in
    // the hand the same way the toy it replaced did.
    handle.root.rotation.set(0.12, 0, 0);
    handle.root.scale.setScalar(0.001);
    handle.root.visible = true;
    this.anchor.add(handle.root);

    this.handle = handle;
    this.scale = item.heldScale;
    this.time = 0;
  }

  /** Puts whatever is being eaten away immediately, unfinished. */
  stop(): void {
    this.put();
  }

  update(dt: number, elapsed: number): void {
    const handle = this.handle;
    if (!handle) return;

    this.time += dt;
    if (this.time >= EAT_SECONDS) {
      this.put();
      return;
    }

    // Which bite we are on, and how far through it — the same clock the sound
    // scheduled its crunches on, so the model shrinks as each one lands.
    const bite = Math.min(EAT_BITES - 1, Math.floor(this.time / (EAT_SECONDS / EAT_BITES)));
    const intoBite = clamp01((this.time - biteAt(bite)) / (EAT_SECONDS / EAT_BITES));
    // A whole treat at the first bite, a third of one at the last.
    const left = (EAT_BITES - bite) / EAT_BITES;
    // Squashed at the moment of the chomp, springing back over the next
    // fraction of a second — the same squash-and-stretch as everything else.
    const chomp = 1 - Math.max(0, 1 - intoBite * 7) * 0.22;
    // And the pop-in it arrives with, over the first slice of the first bite.
    const pop = clamp01(this.time / POP_SECONDS);
    const popped = pop < 1 ? (1 + Math.sin(pop * Math.PI) * 0.35) * pop : 1;

    handle.root.scale.setScalar(this.scale * left * chomp * popped);
    handle.update?.(dt, elapsed);
  }

  dispose(): void {
    this.put();
    for (const handle of this.pool.values()) {
      if (handle.dispose) handle.dispose();
      else disposeTree(handle.root);
    }
    this.pool.clear();
  }

  // -------------------------------------------------------------- internals

  /**
   * Takes the current model off the hand and back into the pool — *not*
   * disposed, which is the whole point of pooling it. Left invisible and at
   * nothing so a stale frame can never show a full ice cream for an instant.
   */
  private put(): void {
    const handle = this.handle;
    if (!handle) return;
    this.anchor.remove(handle.root);
    handle.root.visible = false;
    handle.root.scale.setScalar(0.001);
    this.handle = null;
    this.time = 0;
  }
}

/** Seconds the pop-in takes, the same beat as `CarriedItem`'s purchase pop. */
const POP_SECONDS = 0.25;
