/**
 * **Which nodes of `library.glb` load with the park, and which with the
 * reading room** — the one owner of the split.
 *
 * `library.glb` is one authored file (the 3D Artist's, `art/blend/library_build.py`),
 * but the game ships it as two modules: the **boot** piece (`libraryGlb.ts`),
 * loaded with the park, and the **room** piece (`libraryRoomGlb.ts`), a lazy
 * chunk fetched when she first goes in (`world/interiors.ts`'s `LIBRARY_ROOM`;
 * Jim, 12 Nov 2026: *"all interiors should be loaded on-demand on entering that
 * room"*). `pack:library` cuts the file in two by this list
 * (`scripts/lib/splitGlb.mts`); `check:library-glb` cuts it again and asserts
 * the two modules are exactly the two pieces, and that together they are every
 * node of the file, each read back identical.
 *
 * The boot piece is the building — {@link LIBRARY_SHELL_NODES} — plus the few
 * interior nodes something in the boot **measures**, so no number measured
 * off them needs a second, typed owner:
 *
 * - `shelf-carcass`, `shelf-shelves`: the bookcase's footprint
 *   (`LIBRARY_SHELF_FOOTPRINT`, read by `layout.ts`, which the park's plan is
 *   solved with) and its measured size, which places the secret den's doorway
 *   (`shell.ts`'s `libraryDenGap`) that `Library.doorBands()` reports.
 * - `cushion-body`: the story cushion's top and radius, which the library's
 *   children (`libraryKidDriver.ts`, run by the crowd from boot) sit by.
 *
 * Every other node — the furniture, the books, the owl, the dragon, the cat —
 * is drawn only in the reading room, so it waits for the room.
 *
 * No imports: the packer reads this from Node without loading the kit.
 */

/** The building's shell, every node of it. */
export const LIBRARY_SHELL_NODES = [
  'shell-plinth',
  'shell-steps',
  'shell-walls',
  'shell-windows',
  'shell-door',
  'shell-columns',
  'shell-entablature',
  'shell-pediment',
  'shell-pedimentBook',
  'shell-roof',
] as const;

/** Every node in the boot piece: the shell, and the interior nodes the boot measures (see above). */
export const LIBRARY_BOOT_NODES: readonly string[] = [...LIBRARY_SHELL_NODES, 'shelf-carcass', 'shelf-shelves', 'cushion-body'];

/** Is `name` a node of the boot piece? Every other node is the room's. */
export function isLibraryBootNode(name: string): boolean {
  return LIBRARY_BOOT_NODES.includes(name);
}
