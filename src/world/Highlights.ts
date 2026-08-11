import {
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type RingGeometry,
  type Scene,
} from 'three';
import type { FrameContext, GameSystem } from '../core/types';
import {
  createRainbowRings,
  createRainbowSparks,
  rainbowRingGeometry,
  type RainbowRings,
  type RainbowSparks,
} from '../art/effects/rainbowRing';
import {
  buildHighlightShell,
  createRainbowOutlineMaterial,
  isInstanced,
  SWEEP_SPEED,
  type HighlightShell,
} from '../art/effects/rainbowOutline';
import { decal } from '../art/style/materials';
import type { InteractZone } from './interact';
import { highlightKey, type HighlightTarget } from './highlight';

/**
 * The HIGHLIGHT RULE, as one system — and, since 28 July 2026, the SELECTION
 * RULE's other half.
 *
 * GAME_DESIGN.md, absolute, applies everywhere: *everything you can interact
 * with is outlined in a rainbow when it is about to be used*. The SELECTION RULE
 * then made "about to be used" mean exactly one thing: **the rainbow outline IS
 * the selection**. Whatever `world/Selection.ts` has picked — by proximity, by
 * hover or by tap — is what is outlined, and `ui/ActionChips.ts` floats that
 * same thing's actions over it. One pick, two pictures of it, which is what
 * makes it impossible for the outline and the chips to disagree.
 *
 * This system therefore owns no picking of its own at all any more (it used to
 * own the hover ray; that moved to `Selection`, which needs it for taps too).
 * It draws, and it fires the activation flash on request.
 *
 * ### Cost
 *
 * One slot, allocated at construction — because one thing is selected. **At most
 * one extra draw call in the whole frame**, no matter how many interactables the
 * park grows. Shell geometry is built on first use and cached per object, so
 * nothing is merged in a loop.
 *
 * ### Day and night
 *
 * The rainbow is unlit (`MeshBasicMaterial`), so it reads identically under the
 * midday sun and under a lamp post at 2 a.m. — which is the whole reason it is
 * not a toon material. What makes it survive *daylight over pale sand* is the
 * plum separators baked into the strip; see `art/effects/rainbowOutline.ts`.
 */

/** One selection, one outline. */
const SLOT_COUNT = 1;

/** Clearance above the ground for the fallback ring, so it never z-fights the grass. */
const RING_CLEARANCE = 0.07;

/** The fallback ring never shrinks below this radius, in metres. */
const MIN_RING_RADIUS = 0.7;

/** Ring width as a fraction of its radius — a rim, not a dinner plate. */
const RING_INNER = 0.84;

/** Gentle breathing, shared by every highlight on screen: cycles per second, and depth. */
const PULSE_HZ = 0.5;
const PULSE_DEPTH = 0.12;

/**
 * The clock the activation flash runs on when the park's has stopped.
 *
 * Pressing E on a shop opens a panel, and a panel pauses the park — so the very
 * flash that says "you touched it" would freeze half-played, which reads as a
 * glitch rather than as confirmation. The flash is UI feedback, not gameplay, so
 * it keeps its own nominal tick while everything else is held still.
 */
const FROZEN_DT = 1 / 60;

export interface HighlightSources {
  /** The one selected thing, from `world/Selection.ts`, or null. */
  selected(): InteractZone | null;
  /** True while something else owns the screen — a shop, the book, the map, a sign. */
  blocked(): boolean;
}

export class Highlights implements GameSystem {
  readonly name = 'highlights';
  readonly group = new Group();

  private readonly material: MeshBasicMaterial;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly ringGeometry: RingGeometry;
  private readonly slots: HighlightSlot[] = [];

  /** One shell per target object, built lazily and kept — see the cost note above. */
  private readonly shells = new Map<string, HighlightShell | null>();

  private readonly scratchMatrix = new Matrix4();

  /**
   * The activation flash: the hop rainbow's own pool, fired at whatever was
   * just used. Reused rather than rewritten — it is already a rainbow that
   * flicks outward, rises and fades over six-tenths of a second, which is
   * exactly what the rule asks for, and a second implementation of that would
   * be a second rainbow to keep in step with this one.
   */
  private readonly rings: RainbowRings;
  private readonly sparks: RainbowSparks;

  private readonly sources: HighlightSources;

  constructor(
    scene: Scene,
    sources: HighlightSources,
  ) {
    this.sources = sources;
    this.group.name = 'highlights';
    this.material = createRainbowOutlineMaterial();
    this.ringGeometry = rainbowRingGeometry(RING_INNER, 1);
    this.ringMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });

    this.rings = createRainbowRings();
    this.sparks = createRainbowSparks();
    this.group.add(this.rings.root, this.sparks.root);

    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const slot = new HighlightSlot(this.material, this.ringGeometry, this.ringMaterial);
      this.slots.push(slot);
      this.group.add(slot.shell, slot.ring);
    }

    scene.add(this.group);
  }

  /**
   * "You touched it": half a second of radiating rainbow and a scatter of
   * stars, at whatever was just used.
   *
   * Public, and called from exactly one place: `world/Selection.ts`, which is
   * the one thing that knows when something was selected, pressed or arrived at.
   * A tap is confirmed the moment it lands rather than when the walk it started
   * finishes, because on a phone that burst is the only "yes, that one" a child
   * gets.
   */
  flashZone(zone: InteractZone | null): void {
    if (!zone) return;
    const radius = Math.max(0.7, zone.pickRadius);
    // Small things get a quieter flash: the hop ring is sized for a child
    // landing, and a full-strength one around a single flower is a firework.
    this.rings.burst(zone.x, zone.y, zone.z, Math.min(1, 0.5 + radius * 0.18));
    this.sparks.burst(zone.x, zone.y, zone.z, radius);
  }

  update(context: FrameContext): void {
    // The flash keeps its own clock — see FROZEN_DT. Everything else here is
    // free to stop when the park does.
    const effectDt = context.dt > 0 ? context.dt : FROZEN_DT;
    this.rings.update(effectDt);
    this.sparks.update(effectDt);

    // The sweep runs even while nothing is highlighted, so a highlight that
    // appears mid-sweep is already in step with the next one.
    const map = this.material.map;
    if (map) map.offset.x = (map.offset.x - context.dt * SWEEP_SPEED) % 1;

    const pulse = 1 - PULSE_DEPTH * (0.5 - 0.5 * Math.cos(context.elapsed * PULSE_HZ * Math.PI * 2));
    this.material.opacity = pulse;
    this.ringMaterial.opacity = pulse * 0.9;

    this.showZone(0, this.sources.blocked() ? null : this.sources.selected());
  }

  dispose(): void {
    this.rings.dispose();
    this.sparks.dispose();
    for (const slot of this.slots) slot.dispose();
    for (const shell of this.shells.values()) shell?.geometry.dispose();
    this.shells.clear();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }

  // -------------------------------------------------------------- internals

  private showZone(index: number, zone: InteractZone | null): void {
    const slot = this.slots[index];
    if (!slot) return;
    if (!zone) {
      slot.hide();
      return;
    }

    const shell = zone.highlight ? this.shellFor(zone.highlight) : null;
    if (shell && zone.highlight) {
      slot.showShell(zone.id, shell, this.worldMatrixOf(zone.highlight));
      return;
    }

    // No object named, or nothing solid under it: the ring is the guarantee that
    // every registered interactable is highlighted regardless.
    slot.showRing(
      zone.id,
      zone.x,
      zone.y + RING_CLEARANCE,
      zone.z,
      Math.max(MIN_RING_RADIUS, zone.pickRadius),
    );
  }

  /** The target's world matrix, with its instance's own matrix folded in if it has one. */
  private worldMatrixOf(target: HighlightTarget): Matrix4 {
    const { object, instanceId } = target;
    object.updateWorldMatrix(true, false);
    if (instanceId === undefined || !isInstanced(object)) return object.matrixWorld;
    object.getMatrixAt(instanceId, this.scratchMatrix);
    return this.scratchMatrix.premultiply(object.matrixWorld);
  }

  private shellFor(target: HighlightTarget): HighlightShell | null {
    const key = highlightKey(target);
    const existing = this.shells.get(key);
    if (existing !== undefined) return existing;

    // An instance is drawn through its own matrix, so the shell has to be pushed
    // in geometry space by however much that matrix will shrink it — a flower
    // head is a unit sphere scaled to nine centimetres.
    let scale = 1;
    if (target.instanceId !== undefined && isInstanced(target.object)) {
      target.object.updateWorldMatrix(true, false);
      target.object.getMatrixAt(target.instanceId, this.scratchMatrix);
      this.scratchMatrix.premultiply(target.object.matrixWorld);
      scale = Math.max(1e-4, maxScaleOf(this.scratchMatrix));
    }

    const shell = buildHighlightShell(target.object, scale);
    this.shells.set(key, shell);
    return shell;
  }

}

/**
 * One highlight on screen: a rainbow shell and a fallback ring, exactly one of
 * which is ever visible.
 *
 * Both are allocated at construction and never replaced — a highlight that
 * `new`ed a mesh every time the mouse moved would allocate a few thousand of
 * them a minute.
 */
class HighlightSlot {
  readonly shell: Mesh;
  readonly ring: Mesh;
  private key: string | null = null;

  constructor(material: MeshBasicMaterial, ringGeometry: RingGeometry, ringMaterial: MeshBasicMaterial) {
    this.shell = decal(new Mesh(new BufferGeometry(), material));
    this.shell.visible = false;
    this.shell.renderOrder = 3;
    // The shell carries a *copy* of its target's world matrix rather than being
    // parented to it — see `world/highlight.ts`: the highlight must never touch
    // anything the animators own.
    this.shell.matrixAutoUpdate = false;
    this.shell.matrixWorldAutoUpdate = false;

    this.ring = decal(new Mesh(ringGeometry, ringMaterial));
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.ring.rotation.x = -Math.PI / 2;
  }

  showShell(key: string, shell: HighlightShell, worldMatrix: Matrix4): void {
    if (this.key !== key) {
      this.key = key;
      this.shell.geometry = shell.geometry;
    }
    this.shell.matrix.copy(worldMatrix);
    this.shell.matrixWorld.copy(worldMatrix);
    this.shell.visible = true;
    this.ring.visible = false;
  }

  showRing(key: string, x: number, y: number, z: number, radius: number): void {
    this.key = key;
    this.ring.position.set(x, y, z);
    this.ring.scale.set(radius, radius, 1);
    this.ring.visible = true;
    this.shell.visible = false;
  }

  hide(): void {
    this.key = null;
    this.shell.visible = false;
    this.ring.visible = false;
  }

  dispose(): void {
    this.shell.removeFromParent();
    this.ring.removeFromParent();
    // Whatever geometry the shell is holding is a cached shell owned by
    // `Highlights`, and so are both materials. Nothing here is ours to free.
  }
}

/** The largest axis scale in a matrix — how much it will fatten a pushed shell. */
function maxScaleOf(matrix: Matrix4): number {
  const e = matrix.elements;
  const x = Math.hypot(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0);
  const y = Math.hypot(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0);
  const z = Math.hypot(e[8] ?? 0, e[9] ?? 0, e[10] ?? 0);
  return Math.max(x, y, z);
}
