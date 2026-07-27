# Standing loops

Recurring jobs for this project. **They are session-only** — Claude Code's
scheduler keeps them in memory, so they die when the session exits and must
be re-armed in a new one.

A `SessionStart` hook prints this file into context at the start of every
session in this repo, so whoever is overseeing can re-arm them immediately.

## Re-arm these on a new session

All five jobs below (three loops plus the daily pause/resume pair) die with
the session and must be recreated. Recurring jobs also auto-expire after
seven days, so they need re-arming at least weekly regardless.

| Cadence | Cron | Task |
| --- | --- | --- |
| Every 20 minutes | `*/20 * * * *` | kill redundant browser panes and vite instances |
| Hourly at :07 | `7 * * * *` | check in with tasks done and still to do since last update, continue working if not yet complete |
| Hourly at :23 | `23 * * * *` | Fable Architect sub-agent does review of repo code to date, produces a report, the Overseer delegates actioning of this report, and writes it into design docs |

## Daily quiet hours

Development pauses over the expensive part of the day and resumes when
tokens are cheaper. These two are **also session-only** and must be re-armed
alongside the loops above.

| Cadence | Cron | Task |
| --- | --- | --- |
| Daily 12:40 | `40 12 * * *` | **Landing call.** Tell every in-flight agent the pause is imminent: bring work to a safe, shippable state, start nothing new. **Flex scope, not quality** — an incomplete but useful feature is fine to ship if it regresses nothing, builds green, and meets the same QA-PLAYBOOK standards as any other PR. Cut scope, not corners. Anything unfinished gets committed, pushed and opened as a PR with the gaps listed as follow-ups, never left uncommitted in a worktree. |
| Daily 12:48 | `48 12 * * *` | **Pause.** Harvest every in-flight agent's work (build, commit, push, PR), merge what is green, stop all agents, kill servers and browser pages, and delete the three loops above so nothing fires during the pause. Fires 12 minutes early on purpose — winding down properly takes time, and the aim is that work has actually stopped by 1pm. |
| Daily 19:00 | `0 19 * * *` | **Resume.** Re-arm the three loops from this file, reload ARCHITECTURE-REVIEW.md and GAME_DESIGN.md, check what state the repo was left in, and restart work on the highest-priority outstanding items. |

The pause job must not delete the landing-call or pause/resume jobs
themselves — only the three development loops.

**The rule that matters most here:** when time is short, reduce what a
feature does; never reduce how well it is checked. A half-built feature
behind a green build and an honest PR body is fine. A finished-looking
feature with skipped QA is not.

Minutes are deliberately off :00 and :30, and offset from each other, so the
three jobs never fire together.

## Why each exists

- **The cull** — agents open dev servers and browser pages to verify their
  work and do not always clean up. Twice the machine ended up running 16+
  copies of the game at once. Agents are told to expect the cull and simply
  restart what they still need.
- **The check-in** — with a dozen agents in flight and sessions dying often,
  this is the heartbeat that catches stranded work. It has repeatedly found
  features that were finished and building green but never pushed.
- **The architecture review** — the codebase was built fast by a large fleet
  under unreliable conditions. The review appends a dated section to
  `ARCHITECTURE-REVIEW.md` each run and states what was fixed since the last.

## Also worth restoring

- The `chrome-devtools` MCP is configured with `--isolated` in
  `~/.claude.json`, so agent browsing happens in its own Chrome window
  (intended for a second monitor) rather than hijacking the working browser.
  A backup of the previous config sits at
  `~/.claude.json.bak-before-isolated-chrome`.
- Agents must pass `background: true` when opening pages — see rule 1 in
  `QA-PLAYBOOK.md`.
