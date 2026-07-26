# Land of Good Places

A cute, cosy 3D theme-park game you play in a web browser — **designed by Eleri
(age 6) and her dad**.

You can't lose and you can't die. You just explore the park, ride the rides
(including a ferris wheel that goes all the way to space), and collect lots of
cute things that follow you around in a little parade. Unless the grown-ups
turn on **Mayhem mode**…

Built with [Vite](https://vite.dev) 8.1, [three.js](https://threejs.org) and
TypeScript. See [GAME_DESIGN.md](./GAME_DESIGN.md) for the full design.

## Running it

```sh
npm install     # once
npm run dev     # dev server at http://127.0.0.1:5173
```

Other scripts:

```sh
npm run build      # typecheck, then build to dist/
npm run preview    # serve the built dist/ locally
npm run typecheck  # types only, no build
```

## Deployment

**It's live:**

| URL                                                       | What it is                    |
| --------------------------------------------------------- | ----------------------------- |
| <https://landofgoodplaces.blockstack.ing>                   | the one to share              |
| <https://land-of-good-places.blockstack.workers.dev>        | always-there fallback         |

Every push to `main` triggers
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which runs
`npm ci && npm run build` and publishes `dist/` to **Cloudflare Workers** as
static assets (config in [`wrangler.jsonc`](./wrangler.jsonc)). No button to
press — merge it and it's live in about 40 seconds. A failing build or
typecheck stops the deploy, so `main` only ever ships something that builds.

Both URLs serve the game from the **root** of their domain, so the PWA's
service worker gets the whole site in its scope and `base` stays `/` in
`vite.config.ts`. Unknown paths fall back to `index.html`.

### Secrets

Both repository secrets are set, and deploys work end to end:

| Secret                  | What it is                                          | Set? |
| ----------------------- | --------------------------------------------------- | ---- |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account to deploy into                | yes  |
| `CLOUDFLARE_API_TOKEN`  | Token with the **Edit Cloudflare Workers** template  | yes  |

If the token ever needs replacing, make a new one at
<https://dash.cloudflare.com/profile/api-tokens> (Create Token → **Edit
Cloudflare Workers** template → Account = your account → Create), then:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo jimhigson/land-of-good-places
```

### Deploying by hand

```sh
npm run build
npx wrangler login                       # once, opens a browser
npx wrangler deploy                      # uses wrangler.jsonc
```

Or with a token instead of a browser login — handy for scripts and agents:

```sh
npm run build
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy
```

To re-run a deploy without pushing anything:

```sh
gh workflow run deploy.yml --repo jimhigson/land-of-good-places --ref main
```

With no Cloudflare credentials at all you can still put a build online, on a
throwaway preview account that prints a claim URL:

```sh
npx wrangler deploy dist --temporary --name land-of-good-places
```
