import { Raycaster, Vector2, Vector3 } from 'three';
import type { FrameContext, GameSystem } from './core/types';
import type { IsoCamera } from './core/IsoCamera';
import type { TapPoint } from './core/input/PointerControls';
import type { Player } from './entities/Player';
import { pickWalkablePoint } from './world/pickWalkable';
import { pickSignZone, type SignZone } from './world/signs';
import { gameStore } from './state';

/**
 * Tap a sign, and the camera swoops in to read it.
 *
 * A tap is resolved to a ground point exactly the way `TapNavigator` resolves
 * one (see `world/pickWalkable.ts`) and then checked against the sign registry
 * — proximity-based, the same trick `world/interact.ts` uses for shop
 * counters, because a raycast through the world never actually hits a sign
 * board (it is "invisible" to the walkable-surface march on purpose).
 *
 * While inspecting, the game is paused the same way a shop or the backpack
 * pauses it — see `Shopping.syncPaused` for why this is a per-frame mirror of
 * {@link active} rather than a pair of set/clear calls scattered around.
 */
export class SignInspector implements GameSystem {
  readonly name = 'signInspector';

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly hit = new Vector3();
  private activeZone: SignZone | null = null;
  private wasPausedByUs = false;

  constructor(
    private readonly player: Player,
    private readonly camera: IsoCamera,
    private readonly zoneSource: () => readonly SignZone[],
  ) {
    window.addEventListener('keydown', this.onKeyDown);
  }

  /**
   * True from the moment a sign is tapped until the camera has fully swooped
   * back to normal play — deliberately including the exit tween, so the park
   * stays paused for its whole length rather than letting the player wander
   * off while the camera is still catching up.
   */
  get active(): boolean {
    return this.activeZone !== null || this.camera.isInspecting;
  }

  /**
   * Handles a tap that has already been resolved to nowhere in particular by
   * `TapNavigator` — called first, so a tap on a sign never *also* reads as
   * "walk over there". Returns true if it used the tap.
   */
  handleTap(point: TapPoint): boolean {
    // A slide or the lift already owns the character outright; reading a sign
    // mid-ride is not a thing that should be able to happen.
    if (this.player.riding && !this.active) return false;
    const zone = this.pickZoneAt(point);
    if (zone) {
      this.activeZone = zone;
      this.camera.beginInspect(zone.x, zone.y, zone.z, zone.yaw, zone.width, zone.height);
      return true;
    }
    // Any other tap, while inspecting, just backs out — see the class doc.
    if (this.active) {
      this.close();
      return true;
    }
    return false;
  }

  update(_context: FrameContext): void {
    this.syncPaused();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  // -------------------------------------------------------------- internals

  /** Any key at all backs out — a stray Escape, Enter, or a poke at the keyboard. */
  private readonly onKeyDown = (): void => {
    if (this.active) this.close();
  };

  private close(): void {
    this.activeZone = null;
    this.camera.endInspect();
  }

  private pickZoneAt(point: TapPoint): SignZone | null {
    const sampler = this.player.groundSampler;
    if (!sampler) return null;

    this.ndc.set(point.ndcX, point.ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);
    const found = pickWalkablePoint(this.raycaster.ray, sampler, this.player.position.y, this.hit);
    if (!found) return null;

    return pickSignZone(this.zoneSource(), this.hit.x, this.hit.z);
  }

  /**
   * Keeps the park's pause state a mirror of {@link active}, exactly the
   * pattern `Shopping.syncPaused` uses and for the same reason: checked fresh
   * every frame, so nothing here can forget to unpause behind it.
   */
  private syncPaused(): void {
    if (this.active) {
      if (!gameStore.get().paused) {
        this.wasPausedByUs = true;
        gameStore.setPaused(true);
      }
      return;
    }
    if (this.wasPausedByUs) {
      this.wasPausedByUs = false;
      gameStore.setPaused(false);
    }
  }
}
