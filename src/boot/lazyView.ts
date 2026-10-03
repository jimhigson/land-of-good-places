/**
 * **A module constant that is a view of a decision made later.**
 *
 * `PARK_LAYOUT`, `TRAIN_PLAN`, `CROSSING_SITES` and the rest have a hundred
 * consumers between them that read them as plain values. Under backtracking
 * those values are decided by the driver (`world/parkPlan.ts`), can be
 * re-decided when a later feature refuses, and are not known when the module
 * that exports them is evaluated. A `lazyView` keeps every consumer exactly as
 * written: the constant is a Proxy that forwards each property read to the
 * decision as it stands at that moment — forcing the park solve on the first
 * read if nothing has driven it yet, and throwing if the decision it views has
 * not been made (a read of `TRAIN_PLAN` from inside the layout builder is an
 * ordering bug, and it says so).
 *
 * Arrays view as arrays (`Array.isArray`, iteration, `length`, `map` all
 * reach the real array), so `CROSSING_SITES.map(...)` needs no change.
 */
export function lazyView<T extends object>(resolve: () => T): T {
  const target = (Array.isArray(undefined) ? [] : {}) as T;
  return new Proxy(target, {
    get: (_t, key) => {
      const value = Reflect.get(resolve(), key);
      return typeof value === 'function' ? value.bind(resolve()) : value;
    },
    has: (_t, key) => Reflect.has(resolve(), key),
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor: (_t, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(resolve()),
  });
}

/** An array-shaped view: `Array.isArray` is true of the proxy because its target is an array. */
export function lazyArrayView<T>(resolve: () => readonly T[]): readonly T[] {
  return new Proxy([] as T[], {
    get: (_t, key) => {
      const array = resolve();
      const value = Reflect.get(array, key);
      return typeof value === 'function' ? value.bind(array) : value;
    },
    has: (_t, key) => Reflect.has(resolve(), key),
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor: (_t, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  }) as readonly T[];
}
