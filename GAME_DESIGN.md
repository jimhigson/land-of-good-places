# Land of Good Places — Game Design

Designed by **Eleri** (age 6) and her dad, July 2026. Eleri is credited in
the game itself (title screen / credits).

A cute, cosy theme-park game you play in a web browser. You can't lose and you
can't die — you just explore, ride rides, and collect lots of cute things.
Unless the grown-ups turn on **Mayhem mode**…

## The basics

- **Name:** Land of Good Places. The park inside the game is also called
  "Land of Good Places" by default, but when you start you can rename it to
  anything you like — "RiPika's Park" is offered as a suggestion.
- **Tech:** Runs in a web browser. Built with Vite 8.1 and three.js.
- **Look:** Inspired by *Theme Park* — pseudo-isometric camera, but really
  rendered in 3D. Very cute, Pokémon-inspired style: bright colours, big
  eyes, chunky shapes, soft shadows.
- **Art approach (decided):** true 3D models built procedurally from chunky
  primitives with canvas-painted faces — not sprites — because the camera
  moves (space wheel, slides) and lighting is dynamic. Billboard sprites are
  used only for particles (confetti, splashes, hearts). The Artist agent's
  ART_DIRECTION.md is the style bible all builders must follow.
- **Art style APPROVED by Eleri** (26 July 2026): the full sample set —
  RiPika, Biscuit, the player kid, all three balloons, the Mini, and the
  props — was reviewed and she really likes all of it.
- **Controls:** Keyboard (WASD/arrows), game controller via the Gamepad
  API, **and touch on phones/tablets: tap a spot and the character walks
  there** (tap-to-move), with tap-on-things to interact.
- **PWA:** Installable as a Progressive Web App so it can play full-screen
  on phones.
- **Day & night:** The time of day changes. At night, fairy lights come on
  and the ferris wheel lights up.

## The player

At the start you choose to play as either:

1. **A kid you customise** — pick hair colour, clothes, and a name, or
2. **A cute animal** — e.g. a bunny, kitten, or little mouse.

The default character name is **Eleri**.

## The world

A **big tall building with lots of floors**, next to a **big garden** with
rides in it.

### Getting between floors — every way imaginable

- A **glass lift** you can see the park through as you ride
- **Escalators** like a real shopping centre
- **Stairs**
- **Silly ways:** a trampoline that bounces you up, a slide to whoosh down,
  and a floating bubble that carries you up

### Toilets

The building has cute toilets. When you use one, a **flushing sound** plays,
then a **tap/faucet sound** as you wash your hands at the basin. (Good
manners are part of the game!)

### The ginormous slide

A **ginormous slide** runs from the very top floor all the way down into the
garden, where you land in a pit of **squishy balls**. If you're too scared to
go alone, a **grown-up can ride down with you**.

### Scenery

- **Wooden walls at various heights** to run around and hide behind
- **Cute pink stone walls**
- **Trees and bushes** dotted everywhere (fewer in Mayhem mode)
- A **wishing fountain** in the garden — toss in a coin and something cute
  happens

## The shops

Money **never runs out** in normal mode. Seven shops:

1. **Toy shop** — cute toys including **RiPika**, the electric yellow mouse,
   and **Biscuit**, a teddy bear wearing a red jumper top with two hearts on
   it (Biscuit joins your parade like any cute thing)
2. **Balloon shop** — three special balloons:
   - A **fire-fighting dalmatian pup**
   - A **small flying corgi** with pink flying glasses — holding it lets you
     jump high and float down slowly!
   - **"Chicken-looter"**, a white and red chicken
3. **Candy floss stand** — pink, blue, and a rare rainbow one that only
   appears sometimes
4. **Ice cream parlour** — silly flavours, triple-decker rainbow cones
5. **Hat shop** — hats your character actually wears around the park
6. **Sticker & pet shop** — cute stickers and a little pet that follows you
7. **Surprise egg shop** — mystery eggs with a random cute toy inside

## The rides

### Space ferris wheel

The ferris wheel goes **all the way up to space**. On the way up you see the
park getting tiny, then the whole **Earth below**. At the top:

- **Twinkling stars, the Moon, and colourful planets**
- A **friendly alien** waves from their flying saucer
- **Space RiPika** floats past the window in a tiny astronaut helmet

At night the wheel lights up before it climbs.

### Dodgems

Crash the cars into each other and into the **fake wooden tree**. When you
bonk the tree, all at once:

- It **wobbles** about
- **Apples** bonk down and bounce off the cars
- **Leaves** rain down over everyone
- A surprised little **bird** pops out of the top going "TWEET!?"

Other dodgems have cute drivers — sometimes RiPika drives one.

### Water fight garden

A place in the garden for water fights with the other children, using **very
big water guns**. When you splash someone:

- They **giggle and splash back** — the fight gets bigger
- You earn **splash points** and try to beat your best score
- Splashed kids get funny **drippy soaked hair** for a moment
- When lots of water flies, a little **rainbow** appears

## Collecting cute things

Every cute thing you buy or find:

- **Walks behind you in a little parade** — and they can go on rides with you!
- Or goes in your **backpack**, where they **stick their heads out of the top
  from time to time** to peek around
- Is recorded in the **Cute-o-dex**, a collection book showing what you've
  found and what's still missing
- Can be displayed in **your own bedroom** in the building, arranged on shelves
- You can **carry your favourite** in your hands as you walk

### Other cute features

- **RiPika roams the park** — spot it running around; wave and it bursts into
  confetti sparks
- **Photo mode** — a camera button that snaps you and your toys in a cute frame

## Mayhem mode (for grown-ups)

A difficult mode where you **can die** and **money runs out**.

- **Fewer shops** are open
- **Fewer trees and bushes** — the park feels barer and more serious
- Dangers:
  - **Rough dodgems** — crashes do real damage, drivers get aggressive
  - **Stinging water guns** — the water fight has health at stake
  - **Wobbly space wheel** — the ferris wheel malfunctions; survive the ride
  - **Chicken-looter comes alive** and tries to steal your money
  - **Minis** — small creatures that run up shouting **"MINI ATTACK!"**, grab
    your legs and make it hard to walk
- **When you die:** you respawn, but you drop coins and **Chicken-looter
  steals them** — chase it down to get them back

## Music & sound

- **Happy park music** that changes between the building, garden, and rides
- **Cute creature sounds** — RiPika squeaks, minis chatter, Chicken-looter clucks
- **Ride sounds** — dodgem bumps, water splashes, ferris wheel whooshes
- Rides play **"Entrance of the Gladiators"** (the clown music — public
  domain, we synthesise our own version) and other ride-appropriate tunes

## Build plan (technical)

Rough order of construction, each step playable:

1. **Skeleton** — Vite 8.1 + three.js project, isometric-style camera,
   keyboard + gamepad movement, a walkable test floor
2. **The garden** — terrain, paths, trees/bushes, wooden and pink stone
   walls, wishing fountain, day/night cycle
3. **The building** — floors, glass lift, escalators, stairs, trampoline,
   slide, bubble; the ginormous slide + ball pit
4. **Shops & money** — all seven shops, buying, the infinite purse
5. **Collection** — the parade of cute things, backpack peeking, Cute-o-dex,
   bedroom shelves
6. **Rides** — space ferris wheel (with the full space show), dodgems (with
   the tree), water fight garden (with splash points)
7. **Character select** — customisable kid or cute animal, park renaming
8. **Cute extras** — roaming RiPika, balloon powers, photo mode, candy floss
   rarities, surprise eggs
9. **Sound & music** — WebAudio-synthesised tunes and effects
10. **Mayhem mode** — health, finite money, dangers, minis, Chicken-looter
    coin chase
11. **Mobile & PWA** — **PRIORITISED: built immediately after step 3**, as
    the family plays on phones during the day. Tap-to-move touch controls
    (tap a spot to walk there, tap objects to interact) and PWA
    manifest/service worker for full-screen play on phones

## Deployment

- **Aim:** the game deploys autonomously and is viewable on Jim's phone
  throughout the day as features are added. The Deploy Manager agent is
  responsible for this end-to-end — there must always be a working live URL.
- Code lives in a **private GitHub repo** (created with `gh`)
- Deploys automatically on merge to `main`, to **Cloudflare Workers**
  (static assets) — or GitHub Pages if that turns out simpler
- After each build milestone, the latest game is deployed to the live URL
