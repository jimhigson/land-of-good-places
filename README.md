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

Every push to `main` triggers
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which runs
`npm ci && npm run build` and publishes `dist/` to **Cloudflare Workers** as
static assets (config in [`wrangler.jsonc`](./wrangler.jsonc)). A failing build
or typecheck stops the deploy, so `main` only ever ships something that builds.

The site is served from the root of a `workers.dev` URL, which keeps things
simple for the PWA that's coming later.

### Secrets

Deploys need two repository secrets:

| Secret                  | What it is                                          | Set? |
| ----------------------- | --------------------------------------------------- | ---- |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account to deploy into                | yes  |
| `CLOUDFLARE_API_TOKEN`  | Token with the **Edit Cloudflare Workers** template  | no   |

To add the token: create it at
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

With no Cloudflare credentials at all you can still put a build online, on a
throwaway preview account that prints a claim URL:

```sh
npx wrangler deploy dist --temporary --name land-of-good-places
```
