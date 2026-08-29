---
name: stale-dev-server
description: Your code changes are not appearing in the running game — a field you just added looks like it has vanished from your own class, or the game behaves as though your edits do not exist. Diagnoses a stale service worker left on your port by an earlier session, and a broken Vite HMR module graph after a branch switch. Also covers when to use `npm run preview` vs `npm run dev` for testing the shipped service worker. Agent dev servers only — not for a real player stuck on stale content on the deployed site.
---

# Your edits are not showing up in the running game

**This section is about an agent's own local dev server, never about a real
player on the deployed site.** If a real person is stuck on stale content on
`landofgoodplaces.blockstack.ing`, that is the bug described in "How a
deployed park notices it is out of date" above, not this one — go fix the
update mechanism, do not hand them a console command from here.

This is a PWA, but as of 1 August the dev-mode service worker is **off by
default** (`vite.config.ts`'s `devOptions.enabled`) — a plain `npm run dev`
no longer registers one at all, so a fresh port just shows the current files,
like any other Vite project. Confirmed by measurement on 6 August: loading a
dev server in a clean browser profile gives `getRegistrations().length === 0`
and no caches, in a page where `isSecureContext` is `true` and a worker could
therefore perfectly well have registered.

**`npm run preview` is where a worker is expected, and where you test one.**
It serves the real `dist/` build with the real generated `sw.js` and precache
manifest. A dev-mode worker never could test the shipped one: `globPatterns`
precaches the *built* output, and dev has no built output to precache — so it
cached a different set of files by a different mechanism than the one that
reaches a phone. `VITE_PWA_DEV=1 npm run dev` still forces one on for the rare
job of poking the registration plumbing under HMR, but do not mistake it for a
test of what ships.

**A worker already installed on that port from an earlier session is still
live.** Turning the default off stops *new* ones being minted; it cannot
unregister one some tab registered last week, before this change, or under
`preview`, or from another agent's dev server on a port you have since
reused. That one keeps serving old JS to you, so your code changes silently
do not appear and a field you just added looks like it has vanished from your
own class. The cure is unchanged — in the page console:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
```

then hard-reload. If the game is behaving as though your edits do not exist
and you are on a plain `npm run dev` with no service worker running, suspect a
broken Vite HMR state instead — swapping many files at once under a *running*
dev server (a `git checkout`, a branch switch) can leave its module graph
inconsistent (`Failed to reload ...` in the console). Killing and restarting
the dev server fixes that in seconds; it is not worth debugging.

