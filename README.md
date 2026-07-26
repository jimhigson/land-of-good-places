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

Deploys need two repository secrets:

| Secret                  | What it is                                        |
| ----------------------- | ------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account to deploy into              |
| `CLOUDFLARE_API_TOKEN`  | Token with the **Edit Cloudflare Workers** template |

To deploy by hand from a laptop instead: `npm run build && npx wrangler deploy`
(after `npx wrangler login`).
