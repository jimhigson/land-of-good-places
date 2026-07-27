# Standing loops

Recurring jobs for this project. **They are session-only** — Claude Code's
scheduler keeps them in memory, so they die when the session exits and must
be re-armed in a new one.

A `SessionStart` hook prints this file into context at the start of every
session in this repo, so whoever is overseeing can re-arm them immediately.

## Re-arm these on a new session

| Cadence | Cron | Task |
| --- | --- | --- |
| Every 20 minutes | `*/20 * * * *` | kill redundant browser panes and vite instances |
| Hourly at :07 | `7 * * * *` | check in with tasks done and still to do since last update, continue working if not yet complete |
| Hourly at :23 | `23 * * * *` | Fable Architect sub-agent does review of repo code to date, produces a report, the Overseer delegates actioning of this report, and writes it into design docs |

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
