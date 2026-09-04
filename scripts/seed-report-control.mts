/**
 * **The control for `check:seed-pool`'s end-to-end clause.** Deliberately
 * reports a *random* member of the pool, exactly as the broken code did.
 *
 * `check-seed-pool.mts` boots this the same number of times it boots
 * `seed-report.mts`, and **fails if these runs all agree** — because a
 * "six fresh harnesses built the same park" clause is worth nothing unless it
 * has been shown able to notice when they do not. This repo has shipped
 * several green checks that were incapable of failing; a repetition test is an
 * especially easy one to get wrong, since the reassuring answer is also the
 * answer you get when the comparison is broken.
 *
 * It draws the same way `parkSeedPool.ts`'s `drawFromPool` does, so it is a
 * faithful stand-in for the regression rather than merely some noise: if this
 * file ever stops disagreeing with itself, the reason is interesting.
 */
const { PARK_SEED_POOL } = await import('../src/world/parkSeedPool.ts');

const at = Math.floor(Math.random() * PARK_SEED_POOL.length);

process.stdout.write(String(PARK_SEED_POOL[Math.min(at, PARK_SEED_POOL.length - 1)]));
