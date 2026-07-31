---
name: claude-usage
description: "Report the current Claude account's usage — 5-hour and 7-day rate-limit window utilization, reset times, overage status — read from this machine's logged-in Claude Code session. Use when the user asks about their Claude/token usage, remaining quota, rate limits, or how close they are to a usage cap. Examples: \"what's my claude usage\", \"how much of my limit have I used\", \"check my rate limit\", \"/claude-usage\""
---

# Claude usage

There is no dedicated usage-reporting endpoint for subscription (Pro/Max)
accounts — the Admin API's Usage & Cost API needs an `org:admin`-scoped
credential, which a normal `claude login` session does not carry. What every
API response DOES carry, for the token's own request, is a set of
`anthropic-ratelimit-*` headers — so the only self-service way to see where
a subscription account stands is to make one minimal request and read those
back.

`../claude-usage`, the sibling script in this repo's `scripts/` directory,
does exactly that: reads the account's OAuth token straight from the macOS
Keychain (`Claude Code-credentials` entry — the same session Claude Code
itself is logged in with), makes a 1-output-token call to `/v1/messages`,
and prints the 5-hour and 7-day window utilization, their reset times, and
overage status. No secret is ever stored in the script or printed by it —
the token is read fresh from the Keychain each run.

macOS only. On Linux the same credential JSON lives in plaintext at
`~/.claude/.credentials.json` under the same `claudeAiOauth.accessToken`
path — `scripts/claude-usage`'s `load_token()` would need swapping to read
that file instead of calling `security`.

This skill only works with this repo checked out, since it shells out to
the sibling script by relative path. There is also a self-contained,
machine-wide copy at `~/.claude/skills/claude-usage/` that works from any
project — the two should be kept in step if either changes.

## What to do

Run the sibling script from the repo root and relay its output to the user
plainly — the numbers speak for themselves, no extra interpretation needed
unless something is close to a limit (say so if a window is above ~80%
used):

```bash
python3 scripts/claude-usage
```

If it exits with an error about the Keychain entry, the user is not logged
into Claude Code on this machine (or is on Linux) — tell them so rather than
retrying.
