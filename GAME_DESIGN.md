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
- **HIGHLIGHT RULE — absolute, applies everywhere (27 July 2026):**
  **Everything you can interact with is outlined in a rainbow effect when
  it is about to be used, and the cursor becomes a pointer.**
  - **Mouse:** anything clickable is outlined **on hover**, and the cursor
    turns into a **pointer** at the same moment.
  - **Keyboard/controller:** anything that pressing **E** would use right
    now is outlined while E is primed — so you can always see what the key
    is pointing at before you press it. No cursor changes: there is no
    cursor involved. The same goes for whatever the UI has **focus** on.
  - **This covers the interface as well as the park.** Not only the
    interactables in the 3D world: every button, swatch, tile and tappable
    row in the UI too — HUD pills, the map, the backpack, shop panels, the
    Cute-o-dex, character creation, what's-new, mini-game HUDs. Anything a
    child can click. In the DOM it applies on `:hover` **and**
    `:focus-visible`, so a child driving the UI from a keyboard or a
    controller sees the same highlight on whatever is focused.
  - **When something is actually used — tapped, clicked or activated by key
    — it flashes the same outline for about half a second afterwards**,
    radiating outward with a few particles. On a phone there is no hover at
    all, so this is what tells a child her tap registered; it is the version
    of this rule that matters most on the device she mostly plays on. It
    fires on every input method, not just pointers. Hover is quiet and
    steady ("you can touch this"); the flash expands and fades ("you touched
    it").

  The outline is a **rainbow**, matching the game's existing rainbow motifs
  (the hop ring, the water-fight rainbow). Build it **once** as a shared
  highlight system that every interactable registers with, so anything added
  later is outlined automatically and nobody has to remember the rule — and
  for the DOM half, one global CSS rule over "things you can press" rather
  than a class each panel has to remember. The two halves must **look like
  the same thing**: same six rainbow bands, same sweep speed. A child should
  learn one thing — rainbow means you can press it.
  *Note: an inverted-hull outline already exists for characters in
  ART_DIRECTION (ink-tinted, never black); this is a different, brighter,
  animated thing for interaction feedback — decide whether to extend that
  machinery or build alongside it, and say which.*
  **As built (27 July 2026):** it extends that machinery rather than
  replacing it — same inverted hull, in rainbow, on a shared shell built once
  per object. `src/world/highlight.ts` is the registration API,
  `src/world/Highlights.ts` the system, `src/art/effects/rainbowOutline.ts`
  the drawing, and the DOM half is one global rule at the top of
  `src/style.css`. The activation flash reuses the hop ring's own pool
  (`art/effects/rainbowRing.ts`) rather than a second rainbow.
- **TEXT RULE — absolute, applies everywhere (27 July 2026):** set a
  **minimum font size and apply it throughout the whole game**, with no
  exceptions. It should be **generously large** — this is a game for a
  six-year-old, and some text is currently too small even for an adult
  reading an ordinary web page. Nothing may be smaller than the minimum:
  not HUD pills, not shop panels, not the Cute-o-dex, not the map, not
  labels, not the what's-new panel, not captions on portraits, not
  canvas-painted text on in-world signs. Define it once as a shared value
  (a CSS custom property for DOM text, and a matching constant for
  canvas-drawn text) and use it everywhere, so a future addition cannot
  quietly reintroduce small text. Large, friendly and easy to read is the
  house style.

  **The whole UI scales with the screen (27 July 2026 — part of this same
  rule).** A lot of the dialogs are simply too small. The minimum size is a
  floor, not the whole answer: **every UI element must be reactive to screen
  size**, so on a very large screen everything scales *up* in proportion —
  text, panels, buttons, icons, portraits, padding, the lot. A dialog that
  sits as a small box in the middle of a big monitor is a bug. Nothing may
  be a fixed pixel size that ignores the screen it is on.

  *How, so this is done once rather than argued about per panel: derive one
  root scale from the viewport, and express every size in the UI as a
  multiple of it, rather than sprinkling media queries. Sizes should grow
  smoothly with the screen — but **clamped at both ends**, so a phone stays
  usable and a very large monitor does not end up with a comically enormous
  dialog. This is the same underlying fix as the character-creation screen
  scrolling when it has plenty of room, so whoever does one should do both.*
- **CONTROL RULE — absolute, applies everywhere (27 July 2026):**
  **Never tank controls.** Pressing a direction means "go that way", not
  "rotate towards that way". A six-year-old presses left because they want
  to go left, and should go left immediately.
  **Rotation controls are permitted ONLY in first person** — the ferris
  wheel look-around, the coaster, the first-person train. Nowhere else, in
  any ride or mode, now or in future. Any existing control scheme that turns
  a vehicle by holding a direction must be converted to "press a direction,
  travel that way".

  *Where this lives in the code (27 July 2026):* `src/core/screenBasis.ts` —
  the one place that answers "which way is up the screen, on the ground",
  and where the rule and its reasoning are written down for whoever builds
  the next steerable thing. Every camera rig (the park, the dodgems rink,
  the water-fight garden) reads its ground axes from it, so a direction
  means the same thing in every scene and in the castle interior, which
  sits six hundred metres away in world space but under the same camera.
- **Controls:** Keyboard (WASD/arrows), game controller via the Gamepad
  API, **and touch on phones/tablets: tap a spot and the character walks
  there** (tap-to-move), with tap-on-things to interact. **Double-tap a
  spot → the character RUNS there.**
- **PWA:** Installable as a Progressive Web App so it can play full-screen
  on phones.
- **Day & night:** The time of day changes. At night, fairy lights come on
  and the ferris wheel lights up.

## Saving and coming back (27 July 2026 — queued, not started)

- **Auto-save to local storage every 5 seconds**, and again when the window
  is unloading, so nothing is ever lost.
- **Reloading the page — or coming back later — offers a choice:**
  **continue from the last save**, or **start again** and run character
  creation afresh.
- What must be saved: the character (name, hair, skin, eyes, clothes, worn
  hat), everything owned, the Cute-o-dex, the parade and what is stowed,
  splash-point bests, where the player was standing, the time of day, and
  which one-time things have already been seen (the what's-new panel and
  the cat-bus arrival both already persist flags — fold them in rather than
  keeping three separate schemes).
- *Note: this needs a **versioned** save format from day one. The game is
  changing fast; a save written today must not break the game next week —
  on an unreadable or older save, fall back to offering a fresh start
  rather than crashing.*

## The player

At the start you choose to play as either:

1. **A kid you customise** — pick hair colour, clothes, and a name, or
   **More hair styles needed (27 July 2026 — queued):** a **long ponytail
   with physics** that swings and reaches the ground (like Rumi in KPop
   Demon Hunters), **long hair hanging naturally**, a **regular ponytail**,
   a **bowl cut**, **spiky hair** (Bart Simpson-ish), and **messy hair**.
   *The physics ponytail is the only hard one — a springy chain like the
   balloon strings, not a rigid mesh. Everything else is modelling. Applies
   to NPCs too, so the crowd varies.*
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

### Riding the lift (27 July 2026 — BUG/usability, queued)

**The elevator is too difficult to ride.** It should work like this:

- **Walk near it** and a **call button appears, styled like a real elevator
  control panel** — a lovely toy version of one, in the house style.
- **Press it** and the lift **comes quickly**. Never make a child wait.
- **The character gets on automatically** — no walking in and lining up.
- **The panel then shows all the floors.** Press one and you go **straight
  there** — no holding, no stopping on the way, no fiddling.

*Note: keep the panel and its "take me to floor N" contract decoupled from
the lift's internals, because the castle floor-split decision may re-conceive
every traversal device underneath it. The UX above must survive either
ruling.*

### It is "collect", not "buy" (27 July 2026 — built)

Money is meaningless in normal play, so the word is wrong. **Change "Buy" to
"Collect" everywhere** — buttons, labels, shop copy, the Cute-o-dex, anywhere
the game talks about acquiring a thing. **Only in the grown-ups-only Mayhem
mode** (not yet implemented, where money is finite) should it say "Buy".

*Note: build it so the word is chosen in one place from whether Mayhem is on,
rather than hard-coding "Collect" everywhere and having to find them all again
when Mayhem arrives. The coin/price display probably wants the same treatment
— a price a child can always afford is decoration, not information.*

*Built: `src/state/wording.ts` is the one place. It keys off `moneyIsFinite`
rather than the mode name, so `setMode('mayhem')` flips every label back at
once. The price display is routed through the same switch
(`ShopWords.showPrice`) but deliberately left **on** — the family asked to be
consulted on whether prices should show at all rather than have it decided for
them. **Open question for the family:** the shop rows still show a bare number
(40, 8, 22…) in a yellow lozenge. Money is invisible in the HUD, nothing can
ever be unaffordable, and the number names no currency — so it teaches a child
that some cuties are "worth more" than others without that meaning anything.
The recommendation is to hide it in normal mode and keep it for Mayhem, which
is a one-line change to `showPrice`.*

### Buying things (27 July 2026 — BUG/usability, queued)

**Buying is too fiddly** — selecting an item and then clicking Buy is two
steps too many. Replace it with **a list of items and their descriptions,
each with a Buy button next to it. One click buys.** No selection state, no
confirmation. Money is infinite in normal play, so buying should feel
generous. Give immediate, obvious feedback that the thing is now yours, and
make the button big enough for a small finger.

### Getting where you tapped (27 July 2026 — HIGH PRIORITY, queued)

**Route finding needs to be much better.** A young player expects to **click
once and go there** — but the character gets **stuck on scenery** on the way.
The playable character must **work out a route around obstacles** rather than
walking into them and stopping.

*This is a core-feel item, not a polish item: tap-to-move is the main way a
six-year-old plays this game, and every time it fails she has to work out why
and steer manually, which is exactly the fiddliness we keep removing
elsewhere. It ranks above most of the queued features.*

*Notes: the NPCs already navigate a validated waypoint graph (`poiGraph`,
whose every edge is walked against the finished collision world at build
time), while the player's tap-to-move steers more or less straight at the
target — so the game already contains a working solution the player cannot
use. Making the player a consumer of real pathfinding is the obvious move.
Whatever is built must cope with: the auto-jump over small walls (an existing
feature — a wall the player can hop is not an obstacle); the castle interior,
which is about to become one space per floor (Decision 3); and the park
replan (Decision 4), which moves everything and adds a railway the player
must never route across. It must also handle "no route exists" gracefully —
walk as close as possible and stop, never freeze or jitter.*

### Updates are not optional (27 July 2026 — built)

**A new version must be unskippable.** The notification becomes **full
screen**, with **only one option: go to the new version**. No dismiss, no
"later", no way to keep playing the old one.

*Note: this replaces the small toast that currently sits over the character
creation controls (which was separately reported as obstructing them — this
supersedes that fix). Practically: `vite-plugin-pwa` is configured with
`registerType: 'prompt'` and `injectRegister: false`, so the prompt is ours to
render. Make the single button reload into the new version, and make sure a
child cannot get behind it — no Escape, no click-outside, no focus escape. It
should look like a friendly part of the game, not a browser error.*

*Built: `ui/UpdateGate.ts` replaces `ui/UpdateToast.ts`. The toast-covering-
the-character-creation-controls bug is superseded and closed with it.*

### The top bar takes too much space (27 July 2026 — queued)

The row of pills across the top of the screen takes up too much room. **Hide
them all behind a single menu button** that expands to show them. The game is
the thing worth looking at; the controls should get out of its way.

**The clock is to be removed entirely** — the family's words: *"the clock icon
isn't even useful so remove it entirely."* Not moved into the menu, removed.

*Notes: the pills are the title, the clock, the backpack, the Cute-o-dex and
the map. The menu button must be big enough for a small finger, must obey the
minimum text size and the root UI scale, and must pick up the rainbow
highlight and pointer cursor for free by being an ordinary button. Opening and
closing it must not leave the game unresponsive — there is prior history of a
panel doing exactly that (the backpack input-lock bug), so the pause/input
state has to be re-derived rather than toggled. The day/night cycle stays; only
its readout goes. If the day counter is judged worth keeping later it can
return inside the menu, but the default is gone.*

### Night is still too dark (27 July 2026 — queued)

Lamp posts helped but **night is still too dark**. Three things, together:

- **More lights** generally, so the park stays readable and cosy after dark
  rather than gloomy. This is a game with no losing in it; night should feel
  magical, not frightening.
- **Strings of lights between the trees.** These must be **procedurally
  generated from wherever the trees actually are**, not hand-placed — the
  park is about to be replanned around a real railway (Decision 4) and the
  trees will move. A hand-authored set of light strings would be thrown away;
  a generated one simply re-strings itself.
- **Fireflies** drifting about at night.

*Notes: the lights should be pooled and instanced — a park full of bulbs is
exactly the sort of thing that lands on the GC-pause suspect list. Fireflies
want a small pool of drifting points that fade in as `nightFactor` rises and
are gone by morning. The string-hanging routine should pick tree pairs by
proximity with a maximum span so it cannot draw a wire across the whole park,
and must keep clear of the railway and of anywhere a child walks.*

### Toilets

The building has cute toilets. When you use one, a **flushing sound** plays,
then a **tap/faucet sound** as you wash your hands at the basin. (Good
manners are part of the game!)

**Privacy, and the roof that covers it (27 July 2026 — queued):** you do not
use the toilet from the doorway. **The character walks into the room and
goes in**, and once they are inside **a roof slides over the room so you
cannot see them**. You hear the **flush**. Then, as they move to the basin to
**wash their hands, the roof vanishes again** and you can see them once more.

*Note: this is the game's one moment of deliberate privacy, and it is funny
precisely because the roof is doing the discretion — so the timing carries
it. Roof on before the character is out of sight, not after. The sequence is
walk in > roof covers > flush > roof lifts > wash hands > leave, and the
existing flush and tap sounds slot straight into it.*

*Implementation note: the toilets already have a room region
(`TOILET_ROOM`/`TOILET_DECK` in `world/building/layout.ts`), so the roof is a
lid over that rectangle rather than anything new to place. Fade it rather
than snapping it — the cutaway that hides the floors above already fades, so
match that. Two things must hold: the camera must not end up inside the lid,
and **the player must never be stuck under it** if they walk out early or the
game is saved mid-visit — the roof follows the character's state, so if they
leave the room it lifts, whatever point the sequence had reached. Worth
letting NPCs use it too; a queue outside a covered toilet is funnier than
anything we could script.*

### The space ferris wheel — the pet's seat (27 July 2026 — queued)

In the ferris wheel car, **the pet sits on its own chair, lower than the
player's**, so its head does not block the view. **Restructure the car** to
fit properly rather than nudging the pet down into the floor. All pets are
size-normalised, so build the chair to fit the pet, never the reverse — and
an empty chair should still look deliberate. *The ferris wheel's look-around
directions are confirmed CORRECT; do not disturb them.*

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
4. **Ice cream parlour** — silly flavours, triple-decker rainbow cones.
   **Food is eaten, not carried (27 July 2026 — queued, not started):**
   keeping an ice cream in a backpack makes no sense. Buying one should
   **play an eating sound**, **show the 3D ice cream** held for a few
   seconds while the character enjoys it, then it is **gone** — the player
   does not carry it around. It is recorded in the Cute-o-dex as **eaten**,
   so it still counts towards the collection.
   *Applies to the other food too — candy floss and the spooky house's
   candy are the same case. Sits naturally alongside the change making
   rides count towards the dex: the dex becomes a record of what you have
   done and tasted, not only what you own.*
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

## Replan the whole park around a real railway (27 July 2026 — queued;
## ARCHITECT DECISION REQUIRED before any of it is built)

The train currently runs a plain circle around the park edge. Replace it
with a **genuinely interesting route**: it should wind, it should **dive
into tunnels beneath the park's paths** rather than everything politely
avoiding everything else, and it should feel like a railway laid through a
park rather than a ring drawn around one.

**This means redrawing the park map, and that is fine** — every existing
attraction, path, wall and plot may be moved to a new location to make a
good route possible. Treat the current layout as provisional.

Also:

- **The player can no longer walk onto the track.** Use a mix of **visible
  barriers** (fences, hedges, embankments — things that read as "not for
  you") and **invisible walls** where a visible one would spoil the view.
- **The track stays interesting to look at**: statues and items of interest
  dotted along it, per the first-person train ride note below.
- **This ties directly into the rollercoaster rework** (item 30g): that ride
  is also becoming a railed ride running through the real park. The two
  rail systems should be planned **together, once**, not laid out
  independently and then reconciled.

### Why this needs the architect first

ARCHITECTURE-DECISIONS.md Decision 1 already rules on train-versus-coaster:
the train owns the outer band (r ≈ 48–58) at ground level, the coaster the
middle band (r ≈ 15–45) elevated, crossing exactly twice. **This request
supersedes the premise of that decision** — a winding, tunnelled route is
not a band. Decision 1's routing section, its "legible at a glance" argument
(height, territory, speed) and its PR plan all need revisiting.

**The visibility problem is already answered (27 July 2026).** The concern
was that a fixed 38° isometric camera cannot see into a tunnel, so a player
inside one would simply vanish. The family's answer resolves it:

- **The train ride is FIRST PERSON with look-around**, exactly like the
  space ferris wheel — so while you are on the train you *are* the camera.
  Being underground is a feature, not a blackout. Reuse the same
  `RideCamera` mechanism.
- **Where a path crosses the railway, a small bridge carries the path over
  the track** — and a small bridge does not obscure a player walking on it.
  So the crossings work in both directions: the rider sees the bridge pass
  overhead, the walker stays visible.

The architect should still rule on: the new park layout as a whole; both
rail routes together; what happens to the anchor-plot system that every ride
currently registers against; and how much of the existing world generation
survives. It should also fold in the already-queued items that
touch placement: paths to the stations, the spooky house moving to the edge,
and the trackside statues.

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

**Steering is wrong in two ways (27 July 2026 — BUG, queued).**

1. **Left and right are inverted.** Confirmed by play: **the ferris wheel
   now reads correctly, the dodgems do not** — so the two rides disagree
   with each other. The ferris wheel was fixed by negating its yaw input
   (three.js turns an object *left* as `rotation.y` increases, so feeding
   screen-space "right" straight into yaw reverses it); the dodgems still
   has the unfixed version of that same mistake. `dodgems/steering.ts` is
   the file the ferris wheel's `look.ts` was originally modelled on, which
   is exactly how the error propagated. Apply the same correction there, and
   check nothing else copied `steering.ts` before it was fixed.
2. **The car cannot keep turning** — with the keyboard it sticks at a
   minimum and maximum angle instead of rotating freely, so you cannot
   simply drive in a circle.

**Both are superseded by the control rule** at the top of this document:
the dodgems should not be steered by rotation at all. Press a direction and
the car drives that way. Fixing the inversion and the clamp is worth doing
only if the rework is delayed — otherwise go straight to direction-pressing,
which removes both bugs by construction.

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

## The spooky house — it looks like a stall (27 July 2026 — queued, not started)

From the outside the spooky house currently reads as **just another stall**,
which undersells it. Two changes:

1. **Make the building a giant GHOST HEAD** — a big friendly-spooky ghost
   face you walk into, with **a spider sitting on top**. It should be
   unmistakable from across the park, the way the ferris wheel is, not a
   striped booth you could confuse with the rail racer or the dodgems
   kiosk.
2. **Move it further towards the EDGE of the park.** It currently stands on
   the lawn a short walk north-east of the fountain plaza, in the middle of
   everything. Out at the edge suits it better — a spooky house should feel
   slightly set apart.

*Engineering note:* it is registered through the mini-game stall framework
(`src/minigames/stalls.ts`), which builds a standard striped booth prop for
every entry — that is exactly why it looks like a stall. It needs its own
prop, the way the ferris wheel got one, rather than a re-skin of the booth.
When re-placing it, check clearance against the anchor plots, the wall runs
and the seeded tree/bush scatter (an earlier stall placement *looked* clear
on paper and had a bush planted on top of it once the scatter ran), and
against the train's track loop, which now occupies the park edge.

## The spooky house

A **spooky house** attraction (fun-spooky, not scary-scary): inside, a big
scary face appears. **Tap its eye → the eye pops out** (boing!). **Tap its
mouth → water squirts out at YOU** (splashes the screen/player). **Tap the
mouth twice very quickly → CANDY comes pouring out** (collectible sweets).

## The snake room

Inside the castle there is a **room full of friendly snakes** — smiley,
colourful, wiggly. You can adopt a snake as a **pet** and it appears in
the Cute-o-dex like any cute thing.

## You cannot wear things from the backpack (27 July 2026 — BUG, queued)

There is currently **no way to put on a hat, or wear anything, from the
backpack**. Items go in and stay there. Whatever you happen to be wearing
when you buy it is what you wear.

Needed: tapping an item in the backpack should **wear it** (hats, hair
flowers, face paint if it belongs there), and tapping a worn item should
**take it off**. Same for pets and parade members where relevant — the
parade already supports stow/recall by tapping, so the backpack should feel
the same way rather than being a dead end.

*Note for whoever picks this up:* the wearing machinery already exists —
`WornHat`, `WornFlower` and `CarriedItem` all attach things to the player,
and character creation writes a starting hat straight into the worn state.
What is missing is the **UI route from the backpack to those systems**. The
backpack panel is `src/ui/InventoryDrawer.ts`. Mind the close-path
discipline in QA-PLAYBOOK.md — that panel is where the original
input-freeze bug lived.

## Rides count towards the Cute-o-dex (27 July 2026 — queued, not started)

**And things you DO, not only things you ride (27 July 2026).**
**"Climb a tree" should be an aim in the Cute-o-dex** — a thing to
discover and tick off, alongside the rides. That opens the door to a whole
category of little achievements the park already supports but never
rewards: jump in the fountain, get your face painted, ride the ginormous
slide, wear a hat, have a chat with another child, eat an ice cream, pick
a flower, land in the ball pit, wave at RiPika. Each is a `???` until you
manage it.

*Design note: this is the third thing widening what the dex is — owned
objects, then rides, now deeds. It should probably be organised in
sections (Cute Things · Rides · Things To Do) rather than one flat list,
and the completion prize must count all three or it becomes unachievable.*


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
  found and what's still missing. *The book's **Secrets** page holds things
  you have **done** rather than things you own (27 July 2026 — built): they
  are listed in `state/secrets.ts`, count towards the total and the
  completion prize, and show only a silhouette until you happen upon them.
  The dust cloud is the first.*
- Can be displayed in **your own bedroom** in the building, arranged on shelves
- You can **carry your favourite** in your hands as you walk

### Other cute features

- **RiPika roams the park** — spot it running around; wave and it bursts into
  confetti sparks
- **Photo mode** — a camera button that snaps you and your toys in a cute frame
- **Rainbow hop** — a rainbow effect radiates out from the player whenever
  they jump
- **Dust cloud when running** (27 July 2026 — built) — little puffs of
  dust kick up behind the player while they run, fading as they settle.
  Only while running, not walking, so running feels different rather than
  just faster. *Note: the pooled, no-allocation particle pattern already
  used by the hop's rainbow ring and the water-fight spray is the one to
  follow — see the GC work, this must not allocate per puff.* *Built:
  `art/effects/dustPuff.ts`, a pool of twelve. Puffs are timed off
  `walkPhase`, so one lands per footfall; "running" is a speed rather than
  the sprint key, so wading with sprint held does not count. It is also the
  first entry in the Cute-o-dex's Secrets page — see below.*
- **Picking a flower is a little animation** (27 July 2026 — queued, not
  started): the character **bends down** to pick it, then **lifts it up and
  smells it**, with a happy expression, before it goes into the collection.
  Not an instant pop — a small moment worth watching. *Note: the character
  already has an expression system (happy/blink/surprised via face-texture
  swaps) and a limb animator that carries lean, roll and head-lag, so this
  is a pose sequence rather than new machinery. Picking currently fires a
  sparkle and shrinks the flower to the player; the animation should own
  that timing instead, and tap-to-move should not fight it mid-bend.*
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
17b. **Jumping over a wall sometimes flings the player (27 July 2026 —
    BUG, queued).** Clearing a wall occasionally produces a burst of
    extreme speed. The player should simply land, at ordinary walking or
    running speed, every time.
    *Almost certainly the same root cause as item 17, and the fix for that
    is already in the codebase and known to work: `Collision.resolve()`
    used to correct any overlap in a single frame, and `Player.update()`
    derives velocity from how far `resolve()` just moved the position — so
    a deep correction read back as an enormous velocity, which then got
    integrated forward. The fix was a capped, gentle escort plus a flag
    telling `Player` **not** to re-derive velocity while escorting. The
    likely gap: the airborne / jump-clearance path added later (colliders
    carrying `topHeight`, `resolve()` taking a `clearance` argument) does
    not go through that same escorting guard, so a mid-air correction still
    banks itself as momentum. Check that path specifically rather than
    re-capping speed at the end — clamping the symptom would also clamp
    legitimate movement.*

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
20a. **Novelty shopfronts, concretely (27 July 2026 — queued, not started).**
    The **ice cream parlour** should look like a **giant ice cream** and the
    **balloon shop** like a **giant balloon** — the whole building is the
    thing it sells. Each has **an opening cut into it for the attendant to
    stand in**, so a shopkeeper is framed by a doorway in the cone or the
    balloon rather than standing beside a normal counter. Same treatment for
    the rest as item 20 describes: giant hat on the hat shop, giant egg for
    the surprise eggs, and so on.
    *Note:* the interior work already left a named `getTopperHook()` anchor
    per shop for exactly this, but a topper sitting on a kiosk is not what
    is being asked for here — the **building itself** should be the shape,
    with the counter inside its opening. Whoever takes this should also
    check the interior has the ceiling height for it (the interior PR flagged
    that a tall topper would need more headroom).
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
    **Scrolling is fine; overlap is not (27 July 2026 — the settled rule).**
    The family, seeing controls overlap each other: *"It's ok to scroll, just
    don't scroll while there's screen space available."* So: **use the space
    genuinely available first** — wrap rows, reflow columns — and once the
    screen honestly cannot fit the content, **scrolling is the correct
    answer**. Never contort a layout, shrink text below the minimum, or drop
    content merely to avoid a scrollbar. **Controls overlapping or covering
    each other is always a bug**, at any screen size.

    **It scrolls when it does not need to (27 July 2026 — BUG, queued):**
    the chooser scrolls even when there is plenty of screen to show the
    whole thing at once. **Use the space that is actually available** — on a
    roomy screen everything should be visible without scrolling at all, and
    scrolling should only appear when the screen genuinely cannot fit it.
    *Note: the card is currently capped at `min(760px, 96vw)` wide and
    `min(680px, 92vh)` tall with the body set to `overflow-y: auto`, so it
    refuses to grow into a large window and scrolls instead. Let it use the
    room: widen the card on wide screens and lay the controls out in
    columns rather than one tall stack. Ties into the sticky-preview fix
    (already landed) and the preview framing below — if nothing scrolls,
    stickiness stops mattering on desktop and only earns its keep on a
    phone.*

    **Preview framing (27 July 2026 — BUG + feature, queued):** the hat you
    are choosing is currently **cropped out of the preview** — you cannot
    see the thing you are picking. The preview camera should **follow
    whatever you last changed**:
    - changed a **hat** → zoom in on the **head** and hold there until
      something else changes
    - changed the **pet** → zoom in on the **pet**
    - changed **eye colour** → zoom in on the **face**
    - changed clothes, or nothing recently → pull back to the whole
      character
    Move between framings smoothly rather than snapping, and make sure the
    chosen thing is fully in frame — a tall hat must not clip the top.
    *Note: the preview has its own small scene and camera (disposed on
    close), so this is a camera-target change local to
    `src/ui/CharacterCreation.ts`, not anything to do with the park camera.*

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
31c-BUG. **Using the face painting stall CRASHES the game (27 July 2026 —
    P0, live).** It freezes completely at the moment of use. Merged today
    **build-verified only** — the browser was locked, so it was never seen
    running, and this is exactly what the QA sweep exists to catch.
    *First places to look: `createFacePaintOverlay` is called with a 512px
    canvas for the player and 256px per NPC, and the crowd bakes a shared
    face-texture set — a freeze at the moment of use smells like synchronous
    canvas work, or a per-NPC overlay being built for the whole crowd at
    once. The texture budget is already ~4x over, so an allocation storm is
    plausible. Confirm by profiling rather than guessing.*
31c. **Face painting stall** outside in the garden — the player AND NPCs
    visit and get their faces painted in various cute designs.
31d. **Player–NPC collision** — the player and NPCs cannot walk through
    each other.
31h. **Stairs and escalators become a route to discover (27 July 2026 —
    queued, with 31f).** Three changes, all pulling the same way:
    - **Tapping stairs simply ascends or descends** — no Climb/Descend menu
      to choose from, just tap and go the way the stairs lead. (Same
      tap-and-go spirit as the trampolines in 31g.)
    - **On keyboard, simply WALKING ONTO the stairs is enough** to
      transition to the next floor — no tap, no prompt, no button. You walk
      at the stairs and you end up on the floor above (or below). Since each
      floor is its own space (31f), this is a transition between two models
      rather than a climb up a physical ramp.
    - **All stairs are STRAIGHT.** No switchbacks, no turning a corner
      halfway up — a single straight flight, to keep it simple to read and
      simple to walk into.
    - **Never both between the same two floors.** Between any given pair of
      floors there are stairs *or* an escalator, never both. Each connection
      is one thing.
    - **Spread them around the floor, not stacked.** At the moment the
      stairwell and the escalator well sit in the same place on every deck,
      so going up is a matter of standing still and repeating. Scatter the
      connections so the way up from floor two is somewhere else entirely
      from the way up from floor one — **the point is to make finding the
      route up an act of exploration**, which is most of what makes a big
      building fun to be inside.
    *Note:* this depends on 31f. While the floors are one continuous stacked
    space, a stairwell has to be a hole punched through a slab in a fixed
    place; once each floor is its own space, a connection can be anywhere on
    each side and need not line up at all. Do 31f first, or this fights the
    deck-hole invariant in `layout.ts`.

31f. **Each castle floor becomes its OWN space (27 July 2026 — queued;
    needs an architect decision first).** The floors should stop existing
    in one continuous 3D space stacked on top of each other. Each floor is
    its own separate space, the way the interior as a whole is already
    separate from the park. **They do not have to line up with each other** —
    a floor can be any shape or size regardless of the one below it. This is
    the same "bigger on the inside" idea applied one level down.
31g. **Trampolines become tap-and-go (27 July 2026 — queued).** No manual
    fine control: **tap a trampoline and the character walks there and
    bounces up one floor automatically.** One tap, one floor. The current
    version needs you to walk onto the pad and time repeated bounces, which
    is fiddly for a six-year-old. Same spirit as the tap-stairs Climb /
    Descend menu.
    *Note:* this becomes much simpler once 31f lands — with floors as
    separate spaces, "go up one floor" is a transition rather than a
    physical arc that has to clear a hole in a slab.

    **Why 31f needs the architect first:** a great deal currently assumes
    one continuous interior — `WalkSurfaces` samples the highest walkable
    surface within a step of your feet across all decks, the floor-fader
    hides decks above you for the cutaway view, and the lift, escalators,
    stairs, bubble, helter-skelter, ginormous slide and ball pit are all
    built as things that physically span between deck heights. Splitting the
    floors changes what every one of those *is*. It also interacts with the
    just-landed shaft guards and the deck-hole invariant in `layout.ts`. The
    architect should rule on how floors connect, what happens to each
    traversal device, and whether this is one refactor or a staged one,
    before any of it is built.

31i. **From inside, the castle's outer wall still looks like a shopping
    mall (27 July 2026 — queued, not started).** The exterior was rebuilt as
    a palace, but **only the facade** — the interior shell was deliberately
    left untouched, so standing inside you are still surrounded by the old
    mall-style wall. It must use the **new castle appearance**: the same
    stonework, arches, battlements and rose windows, seen from within.
    **Sliced to the current floor plus the floors below it** — you should
    see the castle wall as it exists at your height and beneath you, not the
    whole tower stacked above your head. Goes hand in hand with 31e (the
    interior rooms) and 31f (floors as separate spaces): once a floor is its
    own space, its perimeter wall can be built as exactly the slice of
    castle that belongs at that height.

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
