/**
 * A localStorage cache for the pure solves that run at module load — the
 * park layout, the boundary profile, the train profile (Jim's ask, 7 Aug
 * 2026: "make the built park cache in local storage, and evict the cache on
 * the version of the game being played changing").
 *
 * Every cached solve is **deterministic data from a seed**: caching it
 * changes when the numbers are computed, never what they are. The cache key
 * carries the game's own baked version (`__APP_VERSION__`, the commit hash —
 * see vite.config.ts), so a new deploy starts cold and {@link evictStale}
 * sweeps every older version's entries the first time anything asks.
 *
 * In Node (the procgen suite, every check script) there is no localStorage
 * and the whole thing is a no-op: tests always measure a fresh solve.
 *
 * The staged-procgen work (loading screen) owns the deeper question of
 * moving these solves off the boot path entirely; this cache is the cheap
 * half — a RELOAD of a park already visited costs nothing — and is written
 * so a staged solver can call the same helper.
 */

const PREFIX = 'lgp:solve:';

function store(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (!candidate) return null;
    // A storage that throws on touch (private-mode quirks) is no storage.
    candidate.getItem(PREFIX);
    return candidate;
  } catch {
    return null;
  }
}

function version(): string {
  try {
    return __APP_VERSION__;
  } catch {
    return 'unversioned';
  }
}

let swept = false;

/** Drop every cached solve from any other version of the game, once. */
function evictStale(storage: Storage): void {
  if (swept) return;
  swept = true;
  const keep = `${PREFIX}${version()}:`;
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(PREFIX) && !key.startsWith(keep)) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

/**
 * Run `solve` — or skip it, if this game version has cached its result.
 *
 * `pack`/`unpack` translate between the solved object and plain JSON. Any
 * failure anywhere (quota, corrupt entry, schema drift) falls back to a
 * fresh solve; a cache can slow nothing down and break nothing.
 */
export function cachedSolve<T>(
  name: string,
  seedKey: string | number,
  solve: () => T,
  pack: (value: T) => unknown,
  unpack: (raw: unknown) => T,
): T {
  const storage = store();
  if (!storage) return solve();
  evictStale(storage);

  const key = `${PREFIX}${version()}:${name}:${seedKey}`;
  try {
    const cached = storage.getItem(key);
    if (cached !== null) return unpack(JSON.parse(cached));
  } catch {
    // Corrupt or mismatched — fall through to a fresh solve, and overwrite.
  }

  const value = solve();
  try {
    storage.setItem(key, JSON.stringify(pack(value)));
  } catch {
    // Quota or private mode: the game simply solves on every load, as ever.
  }
  return value;
}
