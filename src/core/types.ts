import type { Vector3 } from 'three';
import type { InputSystem } from './input';

/**
 * Everything a system is given each frame.
 *
 * Systems receive this instead of reaching for globals, which keeps them
 * testable and makes their dependencies obvious at a glance.
 */
export interface FrameContext {
  /** Seconds since the previous frame, clamped (see MAX_FRAME_DELTA). */
  readonly dt: number;
  /** Seconds since the game started. Use for continuous animation phases. */
  readonly elapsed: number;
  /** Merged keyboard + gamepad state for this frame. */
  readonly input: InputSystem;
  /** Where the player is right now — handy for LOD, shadows and proximity. */
  readonly playerPosition: Vector3;
  /** Frame counter, useful for "do this every N frames" work. */
  readonly frame: number;
}

/**
 * The contract every updatable system implements.
 *
 * Register one with `game.addSystem(...)` and it is updated in registration
 * order every frame. See ARCHITECTURE.md for the full recipe.
 */
export interface GameSystem {
  /** Short identifier used in the debug overlay and error messages. */
  readonly name: string;
  update(context: FrameContext): void;
  /** Release GPU resources here — geometries, materials, textures. */
  dispose?(): void;
}
