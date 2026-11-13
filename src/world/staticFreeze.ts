import { Matrix4, type Object3D } from 'three';

/**
 * **Props that are placed once stop being re-derived every frame** (120 fps
 * plan, step 13; `docs/perf/FRAME-DROPS-2026-11.md` item 11).
 *
 * three.js recomposes every object's local matrix from position, quaternion
 * and scale on every frame, then multiplies it by its parent's — for 7,845 of
 * the park's 7,846 objects, although a fence post has not moved since the park
 * was built. `Object3D.updateMatrixWorld` skips both steps for a node with
 * `matrixAutoUpdate` off, *provided nothing above it forces the multiply*, so a
 * frozen subtree is frozen from its root down.
 *
 * ## Two levels, and why
 *
 * - **Local-frozen** (`matrixAutoUpdate = false`): the node's own position,
 *   rotation and scale are never written again. Its world matrix may still
 *   follow a live parent.
 * - **World-frozen** (also `matrixWorldAutoUpdate = false`): every node between
 *   it and the frozen root is frozen too, so its world matrix is a constant. A
 *   live ancestor *outside* the root recomposes each frame and passes `force`
 *   down; without this flag every descendant would still pay the multiply —
 *   which is the top self-time function the plan measured.
 *
 * A node that is left live (see {@link isLeftLive}) keeps working under frozen
 * parents: it composes its own matrix and multiplies by a parent world matrix
 * that is simply constant. Nodes *below* a live node are only ever
 * local-frozen, so they still follow it.
 *
 * ## The silent failure, and its guard
 *
 * Somebody later animates a frozen object and it just stops moving: nothing
 * throws, the position updates, the picture does not. {@link auditFrozen}
 * recomposes every frozen node and reports the ones whose stored matrix no
 * longer matches — `check:static-freeze` runs it against a played park.
 *
 * This module is deliberately **not** imported by anything procgen imports: it
 * is render-only, and the park-source hash (`scripts/lib/park-source-hash.mjs`)
 * must not move for it.
 */

/** Marks a node this module froze, so the audit measures exactly those. */
const FROZEN = Symbol.for('lgp.staticFreeze');

type FrozenLevel = 'local' | 'world';
type Marked = Object3D & { [FROZEN]?: FrozenLevel };

/**
 * Nodes this module will never freeze, whatever subtree they sit in:
 *
 * - **anything carrying `userData`** — a tag is somebody's handle on the node
 *   (a flag's flutter phase, an anchor record), and a handle means it may be
 *   driven later;
 * - **instanced and skinned meshes, LODs, lights, cameras, bones** — each has
 *   an owner that manages it (culling, a rig, the shadow pass).
 */
export function isLeftLive(node: Object3D): boolean {
  for (const _key in node.userData) return true;
  const kind = node as Object3D & {
    isInstancedMesh?: boolean;
    isSkinnedMesh?: boolean;
    isLOD?: boolean;
    isLight?: boolean;
    isCamera?: boolean;
    isBone?: boolean;
  };
  return Boolean(kind.isInstancedMesh || kind.isSkinnedMesh || kind.isLOD || kind.isLight || kind.isCamera || kind.isBone);
}

/** True if `root` or anything under it is a node {@link isLeftLive} names. */
export function holdsLiveNode(root: Object3D): boolean {
  let found = false;
  root.traverse((node) => {
    if (isLeftLive(node)) found = true;
  });
  return found;
}

export interface FreezeCount {
  /** Nodes whose local matrix is now a constant. */
  frozen: number;
  /** Of those, the ones whose world matrix is a constant too. */
  worldFrozen: number;
  /** Nodes left exactly as they were. */
  live: number;
}

/**
 * Freezes `root`'s subtree where it stands. Call it **after** placement: the
 * matrices are computed once, here, from whatever the transforms are now.
 *
 * `root`'s own ancestors are assumed not to move afterwards; the audit checks
 * that as well, since a moved ancestor would leave world-frozen nodes behind.
 */
export function freezeStatic(root: Object3D): FreezeCount {
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  const count: FreezeCount = { frozen: 0, worldFrozen: 0, live: 0 };
  const visit = (node: Marked, chainFrozen: boolean): void => {
    let frozenHere = false;
    if (isLeftLive(node)) {
      count.live++;
    } else {
      frozenHere = true;
      node.matrixAutoUpdate = false;
      count.frozen++;
      if (chainFrozen) {
        node.matrixWorldAutoUpdate = false;
        node[FROZEN] = 'world';
        count.worldFrozen++;
      } else {
        node[FROZEN] = 'local';
      }
    }
    for (const child of node.children) visit(child, chainFrozen && frozenHere);
  };
  visit(root, true);
  return count;
}

/** One frozen node that no longer matches what was stored for it. */
export interface FrozenDrift {
  /** Names from the scene root down, so the offender can be found. */
  path: string;
  /** `local`: its own transform was written. `world`: something above it moved. */
  kind: FrozenLevel;
  /** Largest absolute difference between any stored and recomposed element. */
  delta: number;
}

export interface FrozenAudit {
  /** Frozen nodes measured. Zero means the audit covered nothing. */
  checked: number;
  worldChecked: number;
  drifted: FrozenDrift[];
}

const composed = new Matrix4();

function maxElementDelta(a: Matrix4, b: Matrix4): number {
  let delta = 0;
  for (let i = 0; i < 16; i++) delta = Math.max(delta, Math.abs((a.elements[i] ?? Number.NaN) - (b.elements[i] ?? Number.NaN)));
  return delta;
}

function pathOf(node: Object3D): string {
  const names: string[] = [];
  for (let at: Object3D | null = node; at; at = at.parent) names.unshift(at.name || at.type);
  return names.join(' > ');
}

/**
 * Recomposes every frozen node under `scene` and reports the ones that have
 * drifted: a local matrix that is no longer `compose(position, quaternion,
 * scale)`, or a world-frozen matrix that is no longer `parent.world × local`.
 *
 * A `NaN` in either matrix counts as drift (`!(delta <= tolerance)`), so a
 * comparison that cannot be made does not pass by default.
 */
export function auditFrozen(scene: Object3D, tolerance = 1e-5): FrozenAudit {
  const audit: FrozenAudit = { checked: 0, worldChecked: 0, drifted: [] };
  scene.traverse((node: Marked) => {
    const level = node[FROZEN];
    if (level === undefined) return;
    audit.checked++;
    composed.compose(node.position, node.quaternion, node.scale);
    const local = maxElementDelta(composed, node.matrix);
    if (!(local <= tolerance)) audit.drifted.push({ path: pathOf(node), kind: 'local', delta: local });
    if (level !== 'world') return;
    audit.worldChecked++;
    if (node.parent) composed.multiplyMatrices(node.parent.matrixWorld, node.matrix);
    else composed.copy(node.matrix);
    const world = maxElementDelta(composed, node.matrixWorld);
    if (!(world <= tolerance)) audit.drifted.push({ path: pathOf(node), kind: 'world', delta: world });
  });
  return audit;
}
