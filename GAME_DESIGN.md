# Land of Good Places — Game Design

**By Eleri age 6, and Jim age 44** — July 2026. This credit line appears in
the game itself (title screen / credits / welcome panel).

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
  there** (tap-to-move), with tap-on-things to interact. **Double-tap a
  spot → the character RUNS there.**
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

**Ball pit physics (family spec, 26 July 2026):** real simple physics —
**AABB-only collision detection, simple forces, MTV-based collision
resolution** — and **at least 4× the original ball count** (190 → 800+).
Balls shove each other aside, pile up, and scatter properly when you land.

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
5. **Hat shop** — hats your character actually wears around the park.
   One of them is the **RiPika hat**: a large RiPika head worn on top of
   the wearer's own head.
6. **Sticker & pet shop** — cute stickers and a little pet that follows you.
   Among the pets: a **jiggly ball-shaped puff creature in pastel pink that
   likes to sing** (bursts into little songs with musical notes floating
   up). Available BOTH as a pet (follows you, sings) and as a hat in the
   hat shop (sits on your head, jiggles, occasionally sings). More
   pet-and-hat characters may follow this pattern.
7. **Surprise egg shop** — mystery eggs with a random cute toy inside

## The rides

### Space ferris wheel

The ferris wheel goes **all the way up to space**. On the way up you see the
park getting tiny, then the whole **Earth below**. At the top:

- **Twinkling stars, the Moon, and colourful planets**
- A **friendly alien** waves from their flying saucer
- **Space RiPika** floats past the window in a tiny astronaut helmet

At night the wheel lights up before it climbs.

## The train needs paths to its stations (27 July 2026 — queued, not started)

The two stations (Sunny Side and Bluebell Halt) sit out at the park edge
with **no paths leading to them** — you have to walk across open grass to
catch the train. Add proper paved paths from the park's existing path
network out to both platforms, in the same style as the rest of the park's
paths, so the stations read as places you are meant to go.

*Engineering note:* the path network is generated in `src/world/paths.ts`
from control points, and other systems read it — the NPC waypoint graph
validates its edges against the finished collision world, and stalls are
placed relative to path spurs. So adding these spurs is not purely
decorative: it should also give NPCs a sensible route to the platforms,
which the train's own NPC-riding behaviour currently has to improvise
(`wanderDriver` steers off-graph to reach the platforms and has stuck
detection precisely because there is no paving to walk).

## The train ride, first person (27 July 2026 — queued, not started)

- **Riding the train switches to FIRST PERSON** for the duration of the
  ride, then back to the normal fixed camera when you get off.
- **Alongside the track**: a range of **statues** and **real-life characters
  from the game** — RiPika, Biscuit, the balloons, the puff, the minis and
  the rest — in various poses, **dancing**, waving, mid-leap. The point is
  that the train ride becomes a little parade of everything you have
  collected or might still find, seen up close as you glide past.

*Engineering note:* the first-person switch should reuse the `RideCamera` +
`Game.cameraOverride` mechanism specified in ARCHITECTURE-DECISIONS.md
Decision 1 for the rollercoaster — one camera abstraction serving both rides
rather than two. Decision 1 also already rules that the park keeps updating
during an in-world ride (unlike a stall mini-game, which freezes it), which
is exactly what this needs: the statues and dancers are part of the living
park, not a separate scene.

## Ride queues (27 July 2026)

Every ride has a **queue area** with NPCs waiting in line — it's what makes
a theme park feel like a theme park.

- **NPCs join the queue as they walk past**, shuffle forward as it moves,
  board when they reach the front, ride, and get off — all at a natural,
  unhurried cadence, so the park always looks busy and alive.
- **The player joins the queue like everyone else** to get on a ride.
- **A fast-forward button** lets the player skip the waiting: press it and
  time speeds up until it's their turn (the same fast-forward idea as the
  tap-stairs climb).

### Space ferris wheel — upgrade (27 July 2026)

- **Gondolas are mostly window**: a light frame with big windows all round,
  so you can see out in every direction rather than through one pane.
- **Look around** while riding: drag to turn the view (like the dodgems
  on-screen joystick), or keys on a keyboard.
- **Events happen in ALL directions**, not just out of one window — turning
  to look around is how you find more of them.
- **New sights**: a **nebula made of sweeties**, and a group of **space
  Bulba-squirt** — a turtle with a plant growing on its back — flying past.
  (Original design, like RiPika: our own creature, not a copy.)

**Queued follow-up (27 July 2026) — after the look-around lands:**

- **Off-screen pointers.** When something is happening outside the current
  view, show a **labelled arrow at the edge of the screen** pointing the way,
  so the player knows which way to turn to see more. (e.g. an arrow reading
  "Alien!" or "Space RiPika" at the screen edge.)
- **A companion rides with you.** Another NPC child joins the ride and sits
  **opposite the player** in the gondola, looking around at the attractions
  in space too — turning their head towards whatever is happening, so the
  ride feels shared rather than solitary.

### Dodgems

Crash the cars into each other and into the **fake wooden tree**. When you
bonk the tree, all at once:

- It **wobbles** about
- **Apples** bonk down and bounce off the cars
- **Leaves** rain down over everyone
- A surprised little **bird** pops out of the top going "TWEET!?"

Other dodgems have cute drivers — sometimes RiPika drives one.

**Feedback (27 July 2026) — same fix as the water fight.** The labels in
the middle of the screen cover up too much of the ride. Replace them with
**portraits of the other drivers showing their mood** at the edge of the
HUD, and **do not annotate apple bonks with text** — the wobble, the
falling apples, the leaves and the startled bird already show it in-game.

### Water fight garden

A place in the garden for water fights with the other children, using **very
big water guns**. When you splash someone:

- They **giggle and splash back** — the fight gets bigger
- You earn **splash points** and try to beat your best score
- Splashed kids get funny **drippy soaked hair** for a moment
- When lots of water flies, a little **rainbow** appears

**Feedback (27 July 2026) — replace the pop-up messages.** The messages
that pop up during a water fight obscure too much of the game. Instead:

- Show each character's **head at the edge of the HUD** (a row of little
  portraits — the player and every child in the fight).
- When someone gets **splashed, show water on their portrait** (dripping,
  soaked hair) so you can see at a glance who just got got.
- When someone **scores a point, their portrait smiles**.

**Layout feedback (27 July 2026):** the heads and names on the portraits
need to be **bigger**. Place the portraits **down the left and right sides,
half on each side, in landscape**, and **along the top and bottom in
portrait** — never bunched in one corner, and never over the middle of the
play area.

No more pop-ups over the play area.

## The spooky house

A **spooky house** attraction (fun-spooky, not scary-scary): inside, a big
scary face appears. **Tap its eye → the eye pops out** (boing!). **Tap its
mouth → water squirts out at YOU** (splashes the screen/player). **Tap the
mouth twice very quickly → CANDY comes pouring out** (collectible sweets).

## The snake room

Inside the castle there is a **room full of friendly snakes** — smiley,
colourful, wiggly. You can adopt a snake as a **pet** and it appears in
the Cute-o-dex like any cute thing.

## Rides count towards the Cute-o-dex (27 July 2026 — queued, not started)

Riding a ride should **fill in an entry in the Cute-o-dex**, the same way
buying a cute thing does. Ride the dodgems, the space ferris wheel, the
water fight, the ginormous slide, the train, the spooky house, the rail
racer — each one you have ridden gets ticked off; ones you have not are
adorable `???` silhouettes like everything else.

*Design note:* this changes what the Cute-o-dex IS — no longer only a
collection of owned objects, but a record of everything you have *done*.
The completion prize below must therefore count rides too, or it becomes
unachievable by collecting alone. Whoever implements this needs to check
how the dex derives its catalogue (it currently reads the shop catalogue,
with flowers added as a separate section) and give rides their own section
rather than pretending a ride is an inventory item.

## Cute-o-dex completion prize

If the player collects **ALL the items in the Cute-o-dex**, the game shows
a special celebration screen that tells their **mummy or daddy to give
them sweeties in real life**. 🍬

## The park is full of children (NPCs)

**Chatting (27 July 2026):** if the player **stands still**, nearby NPCs
should come over and **chat with them** — approach, turn to face, say
something cute in a little speech bubble, maybe wave or bounce, then
wander off again. Standing still should feel like being noticed, not
like being ignored.

The park should feel **alive and busy**: lots of other children wander it
doing everything the player can do — riding the rides (dodgem drivers,
ferris wheel passengers, slide riders), browsing and buying in shops,
carrying balloons and candy floss, walking pets, splashing in water fights,
hopping about. They're generated cute kids (same character system as the
player, varied colours/hair/hats).

**Design note for the future:** these NPCs may later be replaced by real
networked players, so their control layer should be cleanly separated
(an NPC is "a character driven by a behaviour script"; a networked player
would be "a character driven by a remote input stream"). Build characters
so the driver is swappable.

## Fairground stalls: mini-games

Dotted around the park are **fun-fair stalls** that open interactive
sub-games. Each mini-game lives in **its own little world** — not the
global park space — usually a 2D-style playfield rendered with the 3D
engine (side-on or similar), so each game can look and play however it
likes. Walk up / tap a stall to play; leaving returns you to the park.

### Mini-game 1: the rail racer

- You ride along a **rail**, racing others.
- **Hold one button to accelerate; let go to coast** — you must release
  at the right moments to get safely past hazards.
- It's a race, but **not too difficult** — cheerful, forgiving, fun.
- Side-view 2D-style world, rendered in 3D, own colours and scenery.

(More stall games to come — the stall system should make adding new
mini-games easy.)

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
- **Rainbow hop** — a rainbow effect radiates out from the player whenever
  they jump
- **Flowers grow and can be picked** — flowers on the ground grow
  constantly, slowly but noticeably, up to a limit of objects; new ones
  sprout as others are picked. Tap/walk up to pick a flower, and picked
  flowers can be **worn in your hair**.

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
12. **Fairground stalls & mini-games** — the stall framework (enter/leave a
    self-contained mini-game world) plus the first game: the one-button
    rail racer

## Design feedback from the family (26 July 2026) — to implement

1. **Bigger heads:** character heads should be roughly **double** their
   current size — more cartoonish. (Updates the ART_DIRECTION proportion
   rules; applies to all characters.)
2. **The world should feel closer:** characters currently read too small
   against the space. Make most items larger / bring the camera closer so
   the scene feels full and near, not a tiny figure in a big empty park.
   Tune by eye against screenshots.
3. **Stairs are a ride, not a challenge:** tapping stairs opens a small
   menu — "Climb" or "Descend". Choosing one auto-walks the character up or
   down while the game speeds up (fast-forward) so they arrive quickly. No
   precise stair movement ever needed.
4. **The building is bigger on the inside** (like many classic games —
   strict physics need not apply): the interior is its OWN space, not
   continuous with the outside world. Enter through the door → transition
   to a roomy interior that can be far larger than the exterior shell.
5. **The top floor is the roof** — actually outdoors, open to the sky.
6. **Double-tap to run** — a double-tap sends the character running to the
   destination (single tap walks).
7. **Controls hint hidden by default** — behind a small circular "?"
   button; tap to show/hide. Never permanently on screen.
8. **Tap a sign to read it** — tapping any sign zooms and aligns the camera
   to the sign so it fills the screen; tapping anywhere returns to play.
9. **Name labels: larger and screen-constant** — character name text is too
   small and must NOT shrink when zooming out; size is relative to the
   screen, not the world.
10. **Jump over walls** — the player can jump over walls up to a moderate
    maximum height (clears garden walls when airborne high enough; tall
    walls still block).
11. **Stairs and escalators get side rails** — solid walls you cannot go
    over, so you can't accidentally walk off the sides and fall.
12. **The fountain is jumpable** — you can jump into the middle of the
    fountain, with basic particle splash effects.
13. **The big rides are mini-games** — dodgems, the space ferris wheel and
    the water fight are implemented as mini-games like the Rail Racer
    (own self-contained worlds, entered from their plots in the park).
14. **"What's new" welcome** — on opening the game, a cute welcome panel
    lists what's new in the park since your last visit (kid-friendly
    lines, from a curated whatsnew file shipped with each release).
15. **Upgrade notice** — if a new version deploys while you're playing, a
    gentle in-game notice appears ("A new version of the park is ready!")
    with a tap-to-refresh.
16. **Static camera, no rotation** — replace camera rotation entirely with
    one fixed primary viewing angle; instead, everything in the world must
    be rotated/authored to read clearly from that angle (signs, shops,
    stalls face the camera). Remove Q/R keys and rotate buttons.
17. **Fix the "teleport" ejection** — the out-of-bounds/collider push-out
    is far too sensitive and flings the player somewhere else seemingly
    for no reason (e.g. near the fountain). Depenetration must be gentle
    and capped, never a fling.
18. **Day/night only outside** — interiors keep constant cosy lighting;
    the day/night cycle applies only when outdoors. This includes the
    **sun-shadow effect**: no moving sun shadows indoors — interior
    shadows come from fixed interior lights only.
19. **Analogue clock** — replace the time text with a cute analogue clock
    at the top of the screen; tapping it says the time OUT LOUD (speech).
20. **Shops are the main feature of their space** — not small side
    attractions. Novelty architecture: each shop is a little building
    shaped like what it sells — the hat shop has a GIANT HAT on top, the
    ice cream parlour is a giant ice-cream-shaped building, the balloon
    shop bulges like balloons, the surprise egg shop is a giant egg, and
    so on. They should dominate their rooms.
21. **Starting pet + pet conversations** — the player starts with a
    RiPika pet (chosen/confirmed at character creation). Tapping a pet
    (or facing it and pressing E) shows a FULL-SCREEN picture of the
    pet's current mood (their face, big) and the pet tells the player
    where they'd like to go next (e.g. "Let's ride the ferris wheel!").
22. **Tree climbing** — go near a tree and you're offered the option to
    climb it; your character's head pops out of the leaves at the top.
    NPCs also climb trees and peek out of the leaves.
23. **No money display when infinite** — in normal mode (money never runs
    out) the HUD simply doesn't show a money pill. It appears only in
    Mayhem, where money is real.
24. **The map** — the player has a map. Outdoors: a full-screen overlay
    of the whole outdoor area over the gameplay. Indoors: shows the
    current building floor-by-floor, up/down changes floor, starting on
    the player's current floor and location.
25. **The train** — a train rides around the edge of the park with a
    couple of stations. Player AND NPCs can ride it.
26. **DEV badge** — dev-server builds show a large red "DEV" text in the
    bottom-right corner so dev and production are never confused.
27. **Character creation screen** — at the start: choose name (default
    Eleri), hair colour and style, clothes, starting hat, and starting
    pet (RiPika featured as the suggested starter).
    **Also (27 July 2026):** choose **skin tone** and **eye colour**. The
    preview character should be alive — **blinking and cycling through
    expressions** while you customise them, not a frozen doll.
    *Engine note: the face system already provides eye styles (open,
    closedHappy, archHappy, worried, wide, sly), mouth styles (smile,
    bigSmile, grin, oh, cat, wobble, none) and composed expressions
    (neutral, blink, happy, surprised, sad); `KidOptions` already accepts
    `skin` and `eyeColour`. This is a matter of exposing and using what
    exists, not building a new face system.*
    **NPCs get the same treatment**: varied skin tones and eye colours
    across the crowd, and the same blinking/expression range.
28. **NPCs have names** — every NPC child has a name shown above their
    head exactly like the player's. There is ALWAYS a boy with blonde
    hair and blue eyes called **Ethan** somewhere in the park.
29. **Lamp posts** — night is currently too dark outside. Cute lamp posts
    around paths light up after dark and stay off in the day.
30a. **Signs: REPLACE the zoom entirely (supersedes item 30).** Tapping a
    sign must not trigger anything. Instead: when the player is CLOSE TO
    and FACING a sign, an action button appears labelled **"Read"**.
    Choosing it shows the sign **overlaid full screen with NO transition
    animation** at all. Any dismiss returns instantly.
30b. **Arrive by cat bus** — the game starts with the player arriving on a
    bus themed like a CAT (face on the front, ears, tail), stepping off,
    and walking into the park through an entrance.
30c. **The castle interior is a separate continuum** — from outside the
    castle, NOTHING of the interior renders at all (the roof is the
    exception: it is genuinely outdoors). Interior and exterior are two
    disconnected worlds, not one building.
30d. **Map tap-to-travel** — pressing any location on the map makes the
    character automatically walk there.
30g. **Rail Racer becomes a REAL in-park ride** (major change): the rails
    are visible all around the park, twisting around the attractions —
    around the castle, around the ferris wheel. NPCs ride it. The ride
    itself switches to FIRST PERSON and takes place on those real rails,
    not in a separate mini-game world.
    **FAMILY DECISION (27 July 2026):** it is a **TWO-TRACK coaster —
    two rails running alongside each other the whole way** — so racing
    is a genuine side-by-side race with no passing loops needed. And
    **first person only**: no bird's-eye escape button, keep it simple.
30i. **Empty backpack looks broken** — with zero items the middle of the
    backpack dialog is invisible/see-through. It must always render as a
    complete panel with no gaps, even when empty (add a friendly empty
    state: "Your backpack is empty — go and find some cute things!").
30h. **Pet stroking** — when viewing a pet's mood, you can pet and stroke
    it to improve its mood.
30f. **Action buttons at rides and shops** — standing next to a ride or
    shop shows a button saying what it does ("Ride", "Enter", "Shop"),
    so it's obvious how to use the place. In keyboard mode the button
    shows the key to press. (Same pattern as the sign "Read" button.)
30e. **Auto-hop small walls** — when walking (especially tap-to-move) the
    character automatically jumps over a low wall if that's the shortest
    path; no need to press jump. Manual jump still works.
30. **Sign tapping is too sensitive and the zoom is jarring** — make sign
    taps harder to trigger by accident (tighter hit target and/or require
    the player to be nearby), and the camera move should be a simple
    LINEAR zoom. With the static camera (item 16), nothing ever faces
    away from the camera, so the sign transition can be greatly
    simplified: straight zoom in, no swooping rotation.
31a. **Escalator steps at least TWICE as big** — current steps are too
    fine and hard to see on smaller screens.
31b. **Arrows on the floor** near escalator tops and bottoms, so it's
    obvious what they are and which way they go.
31c. **Face painting stall** outside in the garden — the player AND NPCs
    visit and get their faces painted in various cute designs.
31d. **Player–NPC collision** — the player and NPCs cannot walk through
    each other.
31e. **The castle INTERIOR must be fairy-tale themed too.** Checked
    27 July 2026: it is not. Inside is a shopping centre — flat deck
    floors with alternating cream/blossom storeys, a floor roundel,
    planter rings and benches. No castle architecture at all. Needed:
    stone-block walls, vaulted or beamed ceilings, arched doorways and
    windows, chandeliers or torch sconces, hanging banners and
    tapestries, a grand staircase, patterned tiled floors, and
    stained-glass windows. The shops stay as they are (their novelty
    fronts are item 20) — this is about the rooms around them.
31. **The building is THE CASTLE** — renamed everywhere user-visible.
    From the outside it must NOT look like stacked floors: continuous
    decorated sides, a palace/castle look (towers, battlement bits,
    flags), since the inside is its own space and need not match the
    outside shape at all.

## Deployment

- **Aim:** the game deploys autonomously and is viewable on Jim's phone
  throughout the day as features are added. The Deploy Manager agent is
  responsible for this end-to-end — there must always be a working live URL.
- Code lives in a **private GitHub repo** (created with `gh`)
- Deploys automatically on merge to `main`, to **Cloudflare Workers**
  (static assets) — or GitHub Pages if that turns out simpler
- After each build milestone, the latest game is deployed to the live URL
