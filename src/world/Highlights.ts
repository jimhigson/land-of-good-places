import {
  Box3,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
  type Ray,
  type RingGeometry,
  type Scene,
} from 'three';
import type { FrameContext, GameSystem } from '../core/types';
import type { IsoCamera } from '../core/IsoCamera';
import { rainbowRingGeometry } from '../art/effects/rainbowRing';
import {
  buildHighlightShell,
  createRainbowOutlineMaterial,
  isInstanced,
  SWEEP_SPEED,
  type HighlightShell,
} from '../art/effects/rainbowOutline';
import { decal } from '../art/style/materials';
import type { InteractZone } from './interact';
import type { SignZone } from './signs';
import { highlightKey, type HighlightTarget } from './highlight';

/**
 * The HIGHLIGHT RULE, as one system.
 *
 * GAME_DESIGN.md, absolute, applies everywhere: *everything you can interact
 * with is outlined in a rainbow when it is about to be used*. On a mouse, that
 * means **on hover**. On a keyboard or a pad, it means **whatever pressing E
 * would use right now**, for as long as E is primed. The point is that a
 * six-year-old can always see what is usable without hunting for it.
 *
 * Built once, here, so that everything built afterwards inherits it. Three
 * things feed it and it owns none of them:
 *
 *  - **the zone list** — the same `interactZones()` the tap navigator and the
 *    action button already walk, so registering a tap target *is* registering a
 *    highlight;
 *  - **the primed zone** — `ActionButton.zone`, which is by definition the one
 *    thing E would act on, hysteresis and all. Reading it rather than
 *    re-deriving it is what guarantees the outline and the pill can never
 *    disagree about what you are standing next to;
 *  - **the primed sign** — `SignReader.nearby`, the same idea for the passive
 *    "Read" pill.
 *
 * ### Cost
 *
 * Three slots, allocated at construction: hover, primed zone, primed sign.
 * **At most three extra draw calls in the whole frame**, no matter how many
 * interactables the park grows — highlighting is a property of the one thing
 * you are pointing at, not of every registered thing. Shell geometry is built
 * on first use and cached per object, so nothing is merged in a loop.
 *
 * ### Day and night
 *
 * The rainbow is unlit (`MeshBasicMaterial`), so it reads identically under the
 * midday sun and under a lamp post at 2 a.m. — which is the whole reason it is
 * not a toon material. What makes it survive *daylight over pale sand* is the
 * plum separators baked into the strip; see `art/effects/rainbowOutline.ts`.
 */

/** Slots, in order: what the mouse is over, what E would use, what Read would read. */
const SLOT_COUNT = 3;

/** Clearance above the ground for the fallback ring, so it never z-fights the grass. */
const RING_CLEARANCE = 0.07;

/** The fallback ring never shrinks below this radius, in metres. */
const MIN_RING_RADIUS = 0.7;

/** Ring width as a fraction of its radius — a rim, not a dinner plate. */
const RING_INNER = 0.84;

/** Nothing further than this from the player is worth pointing at. Matches TapNavigator. */
const MAX_HOVER_DISTANCE = 90;

/** Gentle breathing, shared by every highlight on screen: cycles per second, and depth. */
const PULSE_HZ = 0.5;
const PULSE_DEPTH = 0.12;

export interface HighlightSources {
  /** Every interactable in the park this frame — the same list the action button walks. */
  zones(): readonly InteractZone[];
  /** What pressing E would act on right now, or null. */
  primedZone(): InteractZone | null;
  /** What pressing Read would read right now, or null. */
  primedSign(): SignZone | null;
  /** True while something else owns the screen — a shop, the book, a mini-game, a ride. */
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
  /** World-space bounds per target object, for hover picking. Targets that move use their zone instead. */
  private readonly bounds = new Map<string, Box3>();

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchSphere = new Sphere();
  private readonly scratchPoint = new Vector3();
  private hasCursor = false;

  constructor(
    scene: Scene,
    private readonly camera: IsoCamera,
    /**
     * The park itself, so that pointing at something usable also turns the
     * cursor into a pointer — GAME_DESIGN.md's HIGHLIGHT RULE asks for both,
     * and doing it here means one decision with two effects rather than a
     * second hover test that could disagree with the outline. The rule lives in
     * `style.css` (`#game-canvas[data-hover]`); this only says when.
     */
    private readonly canvas: HTMLCanvasElement,
    private readonly sources: HighlightSources,
  ) {
    this.group.name = 'highlights';
    this.material = createRainbowOutlineMaterial();
    this.ringGeometry = rainbowRingGeometry(RING_INNER, 1);
    this.ringMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });

    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const slot = new HighlightSlot(this.material, this.ringGeometry, this.ringMaterial);
      this.slots.push(slot);
      this.group.add(slot.shell, slot.ring);
    }

    scene.add(this.group);
  }

  /**
   * Where the mouse is, in normalised device coordinates, or nothing if it has
   * left the canvas. Touch never calls this: a finger has no hover, and on a
   * touch device the action pill is the "primed" signal instead.
   */
  setCursor(ndcX: number, ndcY: number): void {
    this.ndc.set(ndcX, ndcY);
    this.hasCursor = true;
  }

  clearCursor(): void {
    this.hasCursor = false;
  }

  update(context: FrameContext): void {
    // The sweep runs even while nothing is highlighted, so a highlight that
    // appears mid-sweep is already in step with the next one.
    const map = this.material.map;
    if (map) map.offset.x = (map.offset.x - context.dt * SWEEP_SPEED) % 1;

    const pulse = 1 - PULSE_DEPTH * (0.5 - 0.5 * Math.cos(context.elapsed * PULSE_HZ * Math.PI * 2));
    this.material.opacity = pulse;
    this.ringMaterial.opacity = pulse * 0.9;

    if (this.sources.blocked()) {
      for (const slot of this.slots) slot.hide();
      this.setPointerCursor(false);
      return;
    }

    const zones = this.sources.zones();
    const hovered = this.pickHovered(zones, context.playerPosition);
    this.setPointerCursor(hovered !== null);
    const primed = this.sources.primedZone();
    const sign = this.sources.primedSign();

    this.showZone(0, hovered);
    // Never draw the same thing twice: standing next to the very thing you are
    // pointing at is the common case, not the exception.
    this.showZone(1, primed && primed.id !== hovered?.id ? primed : null);
    this.showSign(2, sign);
  }

  dispose(): void {
    for (const slot of this.slots) slot.dispose();
    for (const shell of this.shells.values()) shell?.geometry.dispose();
    this.shells.clear();
    this.bounds.clear();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }

  // -------------------------------------------------------------- internals

  /** Only ever written on a change: the cursor is a style recalc, every frame is not. */
  private setPointerCursor(on: boolean): void {
    const want = on ? 'true' : 'false';
    if (this.canvas.dataset.hover === want) return;
    this.canvas.dataset.hover = want;
  }

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

  private showSign(index: number, sign: SignZone | null): void {
    const slot = this.slots[index];
    if (!slot) return;
    if (!sign) {
      slot.hide();
      return;
    }
    const target: HighlightTarget = { object: sign.object };
    const shell = this.shellFor(target);
    if (shell) slot.showShell(sign.id, shell, this.worldMatrixOf(target));
    else slot.hide();
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

  /**
   * The interactable under the mouse, or null.
   *
   * Tested against the target's world bounds where one was registered — so a tall
   * shop front can be pointed at anywhere up its awning — and against the zone's
   * own `pickRadius` sphere otherwise, which is exactly what a tap already uses.
   * Nearest hit along the ray wins, the same rule `pickInteractZone` uses for a
   * finger.
   */
  private pickHovered(
    zones: readonly InteractZone[],
    playerPosition: Readonly<Vector3>,
  ): InteractZone | null {
    if (!this.hasCursor) return null;
    this.raycaster.setFromCamera(this.ndc, this.camera.camera);
    const ray = this.raycaster.ray;

    let best: InteractZone | null = null;
    let bestDistance = Infinity;

    for (const zone of zones) {
      const dx = zone.x - playerPosition.x;
      const dz = zone.z - playerPosition.z;
      // Cheap, and it is also what keeps the building's interior — six hundred
      // metres away in its own space — out of the park's hover tests.
      if (dx * dx + dz * dz > MAX_HOVER_DISTANCE * MAX_HOVER_DISTANCE) continue;

      const hit = this.intersect(ray, zone);
      if (hit === null || hit >= bestDistance) continue;
      best = zone;
      bestDistance = hit;
    }

    return best;
  }

  /** Distance along the ray to this zone, or null for a miss. */
  private intersect(ray: Ray, zone: InteractZone): number | null {
    const box = zone.highlight ? this.boundsFor(zone.highlight) : null;
    if (box) {
      const hit = ray.intersectBox(box, this.scratchPoint);
      return hit ? ray.origin.distanceTo(hit) : null;
    }
    this.scratchSphere.center.set(zone.x, zone.y + zone.pickRadius * 0.5, zone.z);
    this.scratchSphere.radius = zone.pickRadius;
    const hit = ray.intersectSphere(this.scratchSphere, this.scratchPoint);
    return hit ? ray.origin.distanceTo(hit) : null;
  }

  /**
   * World bounds of a registered target, cached.
   *
   * Only for targets that stand still — which is every one that names a whole
   * object. An instance moves, grows and is picked (the flowers), so those fall
   * back to their zone's sphere, which is rebuilt from live data every frame
   * anyway.
   */
  private boundsFor(target: HighlightTarget): Box3 | null {
    if (target.instanceId !== undefined) return null;
    const key = highlightKey(target);
    const existing = this.bounds.get(key);
    if (existing) return existing;
    const box = new Box3().setFromObject(target.object);
    if (box.isEmpty()) return null;
    this.bounds.set(key, box);
    return box;
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
