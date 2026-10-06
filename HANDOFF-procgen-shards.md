# Handoff: procgen shards (PR #713, branch fix/procgen-shards)

Model: Opus 5.5, assigned by the Overseer. Task: get `Procgen invariants` green on main. The shard 1 watchdog was being blown.

- Root cause: scatterDecoupling.test.ts built five parks one after another (17m50s green, more than 22m30s red), and `--shard` put it on a shard by file count.
- Done: split into a canonical file and a seed-12 file, with builds in parallel; `test/procgenShards.ts` is the explicit 6-shard map; vitest.config enforces the partition; check:seed-coverage parses the map and the matrix.
- Remaining: CI green on the PR, then report per-shard times to the Overseer. Do not merge.
