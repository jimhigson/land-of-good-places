/**
 * Central tuning values for Land of Good Places.
 *
 * Anything a designer (or a six-year-old play-tester) might want to nudge lives
 * here rather than being buried in a system. Keep this file free of imports so
 * every module can depend on it without creating cycles.
 */

// ------------------------------------------------------------------ world

/** Half-width of the playable garden, in metres. The garden is square. */
export const GARDEN_HALF_SIZE = 62;

/** Player is pushed back inside this radius from the centre (soft boundary). */
export const GARDEN_PLAY_RADIUS = 58;

/**
 * Where the ground stops.
 *
 * The park is a diorama on a hilltop: the terrain is a disc that ends a little
 * beyond the boundary wall, so that walking to the edge of the park reveals the
 * sky, the sunset and the distant hills. With an orthographic camera an endless
 * ground plane would fill the frame forever and the sky would never be seen.
 * The cut edge is hidden behind the treeline (see Scenery).
 */
export const TERRAIN_RADIUS = 83.5;

/**
 * How far the ground falls away across the hilltop crest, in metres.
 *
 * Steeper than the camera pitch, so the slope hides itself and the horizon
 * appears just past the crest. Where that fall happens is
 * {@link RIM_OUTSET_START} to {@link RIM_OUTSET_END}.
 *
 * **The crest moved out on 2 August 2026**, and the terrain disc with it (72 m
 * to 83.5 m). The Rail Race's two rings circle the park *outside* the boundary
 * masonry rather than flying over the crowded band inside it. The old crest
 * started 11 m inside the wider ring: its trestles would have had to stand on a
 * 60° hillside on legs half again as long as the ones they replace, and the
 * treeline (which used to run 63–70.5 m) would have grown straight through the
 * track. So the hilltop keeps an apron outside the wall wide enough to stand
 * the ride on, and the treeline (see {@link TREELINE_INNER_RADIUS}) moved out
 * past the rings to go on screening the cut edge. What changes on screen is
 * that the ground beyond the wall now runs on to a coaster instead of stopping
 * at a horizon a metre past the masonry.
 */
export const RIM_DROP = 17;

/**
 * The hilltop crest, as a distance **outside the park's edge** rather than as a
 * radius from the origin.
 *
 * Once the boundary stopped being a circle (issue #115) a radius could no
 * longer say where the ground falls away: the edge is 58 m out on one bearing
 * and 110 m on another, so a single crest radius would cut through the park on
 * one side while leaving a plain outside it on the other.
 *
 * These are the crest's old radii (72 m and 82 m) re-measured from the masonry
 * at `GARDEN_HALF_SIZE - 2` (60 m): it began 12 m outside the wall and finished
 * 22 m outside it. The hill is unchanged; only what it is measured from moved.
 * The radius forms were deleted rather than kept — they had no consumers left,
 * and a constant kept "in case" is one a reader has to prove is dead before
 * touching anything near it. (The note that they survived for the castle
 * interior was simply wrong: the interior uses {@link INTERIOR_PLAY_RADIUS}.)
 */
export const RIM_OUTSET_START = 12;
export const RIM_OUTSET_END = 22;

/**
 * Where the woodland that hides the terrain's cut edge begins.
 *
 * Was `GARDEN_HALF_SIZE + 1` — one metre outside the park, which was the right
 * answer while there was nothing outside the park. There is now: both Rail Race
 * rings stand on the apron, the wider reaching 70.2 m. Trees are planted beyond
 * them instead of among them, close enough behind the ride to still read as the
 * edge of the world.
 */
export const TREELINE_INNER_RADIUS = 71.5;

/** Rings on the terrain disc. Higher = smoother hills. */
export const TERRAIN_SEGMENTS = 72;

/** Vertical scale of the gentle rolling hills. Deliberately small — "flat-ish". */
export const TERRAIN_HEIGHT_SCALE = 0.55;

// ----------------------------------------------------------------- player

export const PLAYER_DEFAULT_NAME = 'Eleri';

/** Top walking speed, metres/second. */
export const PLAYER_MAX_SPEED = 7.4;

/**
 * Extra speed multiplier while the sprint action is held.
 *
 * Out here beside the speed it multiplies rather than inside `Player`, because
 * "how far can she possibly move in one frame?" is a question the collision
 * world has to answer too — see {@link PLAYER_LONGEST_STEP}.
 */
export const PLAYER_SPRINT_MULTIPLIER = 1.5;

/** Acceleration towards the desired velocity, metres/second². */
export const PLAYER_ACCELERATION = 46;

/** Deceleration applied when there is no input, metres/second². */
export const PLAYER_DECELERATION = 34;

/** How fast the character swivels to face travel direction, radians/second. */
export const PLAYER_TURN_SPEED = 13;

/** Radius used for pushing the player out of scenery. */
export const PLAYER_RADIUS = 0.62;

/**
 * An NPC child's collision radius. Lives here rather than in
 * `entities/npc/NpcCharacter.ts` (which re-exports it) so that leaf modules
 * loaded under Node's strip-only TypeScript (`check:waypoints` and friends)
 * can read the number without dragging in a class full of parameter
 * properties the stripper cannot parse.
 */
export const NPC_RADIUS = 0.5;

/**
 * A parade follower's collision radius — a toy or a pet walking behind the
 * child. Small, because they are small.
 *
 * Here rather than in `entities/parade/Parade.ts` (which reads it) for the
 * same reason {@link NPC_RADIUS} is: `world/hotel/petBedFit.ts` needs it to
 * work out how much floor to leave between two pet beds — the strip a
 * companion has to walk down to reach its own — and it must be the *same*
 * number the parade shoves that companion about with, not a second copy of it.
 */
export const PARADE_MEMBER_RADIUS = 0.22;

// ------------------------------------------------------- the drawn footpath
//
// How the park's one path ribbon sits on whatever it is draped over. Owned by
// `world/pathGraph.ts`, which draws it — but declared here, in a leaf with no
// imports, because `world/train/bridges.ts` has to build its own road bed to
// fit under the same ribbon and cannot import `pathGraph.ts`: that module's
// evaluation *is* the walk-graph solve (see its header), so a bridge module
// asking it for a float would run the whole park's path solve to get one. Same
// reasoning as `train/trainDimensions.ts` and `train/clearance.ts`, and the
// same disease avoided: a hand-copied 0.055 in the bridge builder is exactly
// CLAUDE.md's "two definitions of one thing, kept in step by hand".

/** How far the sandy path surface is lifted above the ground it is draped on. */
export const PATH_SURFACE_LIFT = 0.055;

/** How far the cream kerb under it is lifted — deliberately less, so the
 * surface reads as sitting *on* the kerb rather than z-fighting it. */
export const PATH_KERB_LIFT = 0.03;

/** How far the kerb reaches out past the paved surface it borders, each
 * side. Anything that has to carry the path (a bridge deck) has to carry
 * this much more than the paving's own width, or the kerb tears off at the
 * edge of the thing carrying it. */
export const PATH_KERB_OVERHANG = 0.425;

/**
 * Slack a carrier of the path adds on top of {@link PATH_KERB_OVERHANG}
 * before deciding a kerb vertex is its own to lift.
 *
 * The ribbon's edges are offset along the *drawn curve's* own perpendicular
 * while a bridge measures across along its resampled spine's, so on a curve
 * the two disagree by a few millimetres and the kerb's outer edge lands
 * exactly on the boundary — measured on the canonical seed's first build of
 * this, 85 of the kerb's 161 covered vertices made the cut and the other
 * half stayed on the terrain, tearing the kerb in half down the middle of
 * each bridge. A boundary two decisions land on from opposite sides is not
 * a boundary; this is the stride that stops it being one.
 */
export const PATH_CARRIER_SLACK = 0.25;

/** Full bob cycles per metre travelled — drives the walk animation phase. */
export const PLAYER_BOB_CYCLES_PER_METRE = 0.42;

/** Peak vertical bob height in metres. */
export const PLAYER_BOB_HEIGHT = 0.16;

// ------------------------------------------------------------- the building

/**
 * The big building.
 *
 * Its plot centre comes from `world/anchors.ts` ('building'), but the shell is
 * nudged towards the middle of the park so that every interior corner stays
 * inside GARDEN_PLAY_RADIUS — otherwise the soft park boundary would push the
 * player out of the far end of their own shopping centre.
 */
/**
 * DERIVED since Decision 5 — do not import these two from here.
 * `world/building/layout.ts` computes the real centre from the placed
 * 'building' anchor (nudged {@link BUILDING_CENTRE_NUDGE} towards the park
 * middle so every interior corner stays inside GARDEN_PLAY_RADIUS) and
 * re-exports under the same names. These remain only so the derivation has
 * the nudge magnitude the authored park used.
 */
export const BUILDING_CENTRE_NUDGE = 3.54;

/** Exterior half-extents in metres — a 24 x 18 m footprint. */
export const BUILDING_HALF_X = 12;
export const BUILDING_HALF_Z = 9;

/**
 * The building is bigger on the inside.
 *
 * Walking through the front door does not walk you into the shell above — it
 * transitions you into the building's *own space*, which lives at
 * (INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z), six hundred metres from the park and
 * therefore utterly separate from it. Nothing about the two spaces is
 * continuous, which is the whole point: the interior floor plate is 60 x 44 m
 * inside a shell that is 24 x 18 m outside.
 *
 * Six hundred is chosen to be far past TERRAIN_RADIUS *and* past FOG_FAR, so
 * neither space can ever appear in a frame of the other, while staying small
 * enough that single-precision float positions are still exact to a millimetre.
 */
export const INTERIOR_ORIGIN_X = 600;
export const INTERIOR_ORIGIN_Z = 600;

/** Interior half-extents in metres — a roomy 60 x 44 m floor plate. */
export const INTERIOR_HALF_X = 30;
export const INTERIOR_HALF_Z = 22;

/** How far the interior's plaza floor sits below the ground-floor deck. */
export const INTERIOR_PLAZA_DROP = 1.2;

/**
 * Where the interior's ground stops.
 *
 * Same reasoning as TERRAIN_RADIUS out in the park: the camera is orthographic,
 * so an endless ground plane fills the frame forever and the sky is never seen.
 * The top floor here is the *roof* and it is meant to be outdoors, so the ground
 * has to end inside the view — and at this distance the fog has already faded
 * its rim into the horizon colour, so the cut never shows.
 */
export const INTERIOR_PLAZA_RADIUS = 52;

/**
 * The Land Hotel's own spaces (issue #236). One X for all of them, rooms
 * strung along +Z at 260 m spacing — far past every fog plane and far from
 * both the garden and the castle's interior, exactly the "bigger on the
 * inside" trick the castle proved. Each ROOM is its own disjoint space
 * (Jim's ruling): lobby, the floor-25 breakfast room, the floor-50 corridor
 * and the suite behind its "yours" door, joined only by the lift portal and
 * the doors themselves.
 */
export const HOTEL_ORIGIN_X = -600;
/**
 * Nudged +`LOBBY_FOYER_GROWTH` (17 August 2026 — the lobby's own foyer/hall
 * regrow): `LOBBY.halfZ` grew by the same amount so the entrance foyer could
 * hold two visible wall paintings again (issue #271's original fix had left
 * it with none). See {@link LOBBY_FOYER_GROWTH}'s own doc in `layout.ts` for
 * the arithmetic — moving the origin **and** growing the half-extent by the
 * same amount is what keeps the north wall, the mezzanine and everything
 * north of the foyer/hall partition at *exactly* the world position they
 * were already built and proven at (`check:nav-routes`), while a foyer
 * fixture's own *local* z shifts by that same amount again to end up twice
 * as far from the lift in world terms. 260 m of clearance to the next room
 * either side swallows a shift this size without comment.
 *
 * **The `+ 7` here must equal `LOBBY_FOYER_GROWTH` exactly.** It cannot be
 * written as `600 + LOBBY_FOYER_GROWTH` — `layout.ts` imports *from* this
 * file, so the reverse import would cycle — which makes this the one
 * legitimate case of CLAUDE.md's "two definitions" trap in this feature: a
 * mismatch is not silent, though. It moves the north wall (`check:nav-routes`
 * fails hard, not quietly, because that suite proves exact world positions
 * for the mezzanine's connectors) rather than degrading gracefully, so a
 * drift here is caught at the next build, not found by a child.
 *
 * **The trailing `+ 6` is the same trap a second time**, added 18 August
 * 2026 for issue #280's reception room: it must equal `RECEPTION_ORIGIN_SHIFT`
 * (`layout.ts`, `= RECEPTION_ROOM_DEPTH / 2`) exactly, for the same
 * unavoidable reason (the reverse import still cycles). Shifting the origin
 * without this term moved the room's own outer walls but left the mezzanine,
 * the stairs and every hand-placed hall fixture standing exactly where they
 * were — `check:hotel` caught it (a wall sconce hiding standable floor with
 * nothing fading it) before `check:nav-routes` had to.
 */
export const HOTEL_LOBBY_Z = 600 + 7 + 6;
export const HOTEL_BREAKFAST_Z = 860;
export const HOTEL_CORRIDOR_Z = 1120;
export const HOTEL_SUITE_Z = 1380;
/**
 * Two more floors a child can actually press a button for — Jim, 7 August
 * 2026: *"you should be able to go to certain other floors with their own
 * schemes."* Floor 12 is the garden floor and Floor 33 the ocean floor
 * (`world/hotel/layout.ts` owns what they look like).
 *
 * **Same 260 m step as every room above**, continuing the one axis: the
 * spacing is what keeps a room's warm fill (`hotel/lighting.ts`'s 34 m
 * `POOL_DISTANCE`) and its play boundary (`HOTEL_PLAY_RADIUS`, 24 m) from
 * ever reaching its neighbour, and `spaces.ts`'s 70 m room radius from ever
 * matching two rooms at once. A floor added at any other spacing would be a
 * floor that quietly lights the one next door.
 */
export const HOTEL_GARDEN_Z = 1640;
export const HOTEL_OCEAN_Z = 1900;
/** The rooms' shared floor level. Terrain out there is ~-16 m; a flat plate
 * at zero keeps every hotel Y a plain human number. */
export const HOTEL_FLOOR_Y = 0;
/**
 * Soft play boundary radius inside any hotel room.
 *
 * **24 → 30, 18 August 2026**, issue #280's reception room: `LOBBY`'s own
 * far corner (`±halfX, +halfZ` = `±13, 25.4`) is now `√(13² + 25.4²) ≈
 * 28.5 m` from the room's origin — past the old 24 m boundary entirely, so
 * the front door itself (dead centre of that far wall, 25.4 m out) sat
 * outside the circle `Hotel.boundTo` clamps her to. She could never reach
 * it: every one of `check:hotel`'s front-door portal walks failed, silently
 * clamped short of the doorway band on every phase and stride, until this
 * was raised to give the new, deeper `LOBBY` room-real headroom (30 m, ~1.5
 * m of margin outside the actual 28.5 m corner) rather than the bare
 * minimum. Every other hotel room's own far corner is well inside even the
 * old 24 m, so this only ever *widens* their boundary — still nowhere near
 * `spaces.ts`'s 70 m room-matching radius or the 260 m spacing between
 * rooms (`HOTEL_GARDEN_Z`'s own doc).
 */
export const HOTEL_PLAY_RADIUS = 30;

/** Radius of the interior's soft boundary, mirroring GARDEN_PLAY_RADIUS. */
export const INTERIOR_PLAY_RADIUS = 46;

/** Number of walkable decks. Deck 0 is the ground floor, deck 4 is the roof. */
export const BUILDING_FLOOR_COUNT = 5;

/** Deck-to-deck rise in metres. */
export const BUILDING_FLOOR_HEIGHT = 3.6;

/** How far the ground floor sits above the highest terrain under the footprint. */
export const BUILDING_PLINTH = 0.3;

/** Thickness of a deck slab, and of the perimeter wall. */
export const BUILDING_SLAB = 0.3;
export const BUILDING_WALL_THICKNESS = 0.45;

/**
 * Height of the solid painted wall; a band of glass fills the gap up to the
 * deck above.
 *
 * This number is the whole look of the building. Too low and the tower reads as
 * a grey glass office block; too high and the 38° camera cannot see over the
 * near wall into the floor you are standing on. Just over two metres loses about
 * 2.8 m of the eighteen-metre-deep floor plate, which is a fair trade.
 */
export const BUILDING_PARAPET = 2.15;

/** The biggest step the player can walk up without jumping. */
export const BUILDING_STEP_UP = 0.62;

/** Seconds for a floor to fade out / in when the cutaway view changes. */
export const BUILDING_FADE_SECONDS = 0.22;

/** Seconds the iris takes to close, and to open again, on a space change. */
export const IRIS_CLOSE_SECONDS = 0.28;
export const IRIS_OPEN_SECONDS = 0.42;

/**
 * How much faster the world runs while a stair ride is carrying you.
 *
 * Fast enough that four metres of switchback is over before a six-year-old
 * wonders what is happening, slow enough that the walk cycle still reads as
 * walking rather than as a glitch.
 */
export const STAIR_RIDE_TIME_SCALE = 3.5;

/** Seconds the fast-forward whoosh takes to fade in and out. */
export const STAIR_RIDE_FADE_SECONDS = 0.18;

/** Launch speed off the trampoline, first bounce and hardest bounce (m/s). */
export const TRAMPOLINE_MIN_LAUNCH = 9;
export const TRAMPOLINE_MAX_LAUNCH = 17;

/**
 * Glass lift: metres per second.
 *
 * Was 2.4 with a 3.2-second dwell at every floor, and the lift trundled up and
 * down on its own whether anybody wanted it or not — which is how a child at
 * the ground floor could end up waiting the best part of half a minute for a
 * car that was sitting on the roof. The family's ruling is "it comes quickly;
 * never make a child wait" (GAME_DESIGN.md, "Riding the lift"), so it now sits
 * still until it is called and then comes non-stop at this speed: the whole
 * four-storey height in about two seconds, which is quick enough not to be a
 * wait and slow enough that you can still watch the park slide past the glass.
 */
export const LIFT_SPEED = 7;

/** Seconds the character takes to step into the car, and to step back out. */
export const LIFT_BOARD_SECONDS = 0.5;

/** Escalator carry speed, metres per second along the ramp. */
export const ESCALATOR_SPEED = 1.1;

/** How fast you travel down a slide, in metres of spline per second. */
export const SLIDE_SPEED = 12;

/**
 * Number of squishy balls in the ball pit. Four-plus times the old
 * spring-based pit's count — comfortably inside the per-frame physics budget
 * on a desktop core with the AABB/MTV solver (see `BallPit.ts`).
 */
export const BALL_PIT_COUNT = 900;

// ----------------------------------------------------------------- camera

/**
 * Pseudo-isometric rig, Theme Park style: an orthographic camera at one fixed
 * downward pitch and one fixed compass angle. It never rotates, in 90° steps
 * or otherwise — see ARCHITECTURE.md, "One camera angle, forever".
 */
export const CAMERA_IS_ORTHOGRAPHIC = true;

/** Downward pitch of the camera in degrees. Theme Park sat around 35–40°. */
export const CAMERA_PITCH_DEGREES = 38;

/**
 * The camera's one and only compass angle, in degrees (45° gives the classic
 * iso diamond). Fixed for the life of the app.
 *
 * This is also the yaw everything else in the park turns to face: the camera
 * looks back down this same diagonal, so a sign, a shop counter or a stall
 * awning authored at roughly this angle reads its painted face square-on
 * rather than edge-on. See ARCHITECTURE.md, "One camera angle, forever".
 */
export const CAMERA_YAW_DEGREES = 45;

/**
 * The exact yaw a camera-facing thing turns to — `CAMERA_YAW_DEGREES` in
 * radians, dead down the camera's own diagonal, and nothing else (issue
 * #269). Before this, a sign or a counter's yaw was drawn per plot from a
 * random range and then rescaled again for a booth's counter — two more
 * numbers that only ever *approximated* "faces the camera" instead of
 * stating it. One owner: `parkLayout.ts`'s solver gives every entry this
 * exact yaw, `stallPlacement.ts`'s face-paint stall and `ferrisKiosk` read
 * it the same way, and nothing else defines its own approximation.
 */
export const CAMERA_FACING_YAW = (CAMERA_YAW_DEGREES * Math.PI) / 180;

/**
 * Vertical world-units visible at default zoom (orthographic frustum height).
 *
 * Was 22, which put a 1.86 m character at 8% of the screen — the park read as a
 * plain with a speck in it, and the family said so. At 15 the (now 2.12 m) kid
 * fills about 14% of the height, the fountain and the nearest walls are properly
 * in shot, and you can see the paint on things. Anything below about 13 and the
 * building stops fitting on screen when you walk up to it.
 */
export const CAMERA_VIEW_HEIGHT = 15;

/**
 * The narrowest the view is ever allowed to get, in world metres across.
 *
 * The frustum is driven by its *height*, so on a portrait phone (aspect ≈ 0.46)
 * the width falls out at less than half of it — at CAMERA_VIEW_HEIGHT alone a
 * phone would see under 7 m of park and the player would be walking down a
 * letterbox. This is a floor, not a target: on any landscape screen the height
 * already wins and this number does nothing.
 */
export const CAMERA_MIN_VIEW_WIDTH = 11;

/**
 * Zoom bounds. Rebalanced around the closer default: the old 0.55 floor now
 * means "a bit further out", so it drops to 0.42 to keep a proper overview, and
 * the ceiling rises because a close-up of a character is worth having now that
 * there is something to look at up close.
 *
 * Raised again, 2.4 → 4.6, for `world/KeychainShop.ts`'s locked view: Jim's
 * "character and stall both fit with only a small gap" framing for that shot
 * (`KEYCHAIN_VIEW_ZOOM`) needs a closer view than a person standing in the
 * open park was ever framed at, and that view drives the camera through this
 * same clamped `setZoomTarget`, not a bypass of it (see that constant's own
 * doc comment) — so the general ceiling had to rise to let it through rather
 * than silently capping the shot short. The side effect — a player can now
 * pinch/scroll a little closer everywhere, not only in this one view — is
 * the same trade the previous rise already made, in the same direction.
 */
export const CAMERA_ZOOM_MIN = 0.42;
export const CAMERA_ZOOM_MAX = 4.6;
export const CAMERA_ZOOM_STEP = 0.16;

/** Distance the camera sits back from its target (affects clipping only). */
export const CAMERA_DISTANCE = 90;

/** Smoothing half-life in seconds for the camera following the player. */
export const CAMERA_FOLLOW_HALF_LIFE = 0.16;

/** Camera looks slightly ahead of the player, in metres per unit of speed. */
export const CAMERA_LOOK_AHEAD = 0.16;

// -------------------------------------------------------------- day/night

/**
 * Real-time seconds for one complete in-game day. Kept short so testers see a
 * sunset without waiting around. Bump this up for "real" play.
 */
export const DAY_LENGTH_SECONDS = 150;

/** Normalised time of day the game starts at (0 = midnight, 0.5 = noon). */
export const DAY_START_TIME = 0.34;

/** Normalised time when fairy lights switch on / off (dusk, dawn). */
export const FAIRY_LIGHT_ON = 0.735;
export const FAIRY_LIGHT_OFF = 0.245;

// ---------------------------------------------------------------- renderer

/** Device pixel ratio is clamped to this to keep 60fps on laptops. */
export const MAX_PIXEL_RATIO = 2;

export const SHADOW_MAP_SIZE = 2048;

/**
 * Half-extent of the sun's shadow frustum; it follows the player.
 *
 * Tightened from 34 alongside the closer camera. The same 2048² map now covers
 * 52 m instead of 68, so every shadow edge in shot got about 30% crisper for
 * free — which matters more now that you can see individual toys.
 */
export const SHADOW_AREA = 26;

/**
 * The render layer for things drawn **on top of the finished frame**.
 *
 * One customer so far: the ferris wheel's gondola, which the camera sits
 * inside, and which a twelve-metre cloud puff would otherwise be drawn in front
 * of while the ride flies through it (`world/ferrisWheel/FerrisWheelRide.ts`'s
 * `drawsCarInFront`). `Game.render` draws the world, clears the depth buffer,
 * and draws this layer again over the top.
 *
 * **Anything that lights such an object has to be on this layer too.** three.js
 * skips every object the camera's layers exclude, and a light is an object — so
 * a second pass on a layer with no lights on it renders pure black, which is
 * exactly what the first attempt did. `DayNight` enables it on all four of its
 * lights for that reason; a light that ever needs to reach a viewmodel must do
 * the same.
 *
 * Because the lights are on both layers, a viewmodel object moves **onto** this
 * layer rather than adding it: left on layer 0 as well it is drawn twice a
 * frame, once in the world pass and again over the top of itself.
 */
export const VIEWMODEL_LAYER = 1;

/**
 * Strength of the cool fill light, as a fraction of the key.
 *
 * The third light in the rig the art was authored and approved under
 * (ART_DIRECTION.md §6): hemisphere key, warm directional sun, cool opposite
 * fill. Under toon shading the ramp handles *shape* and the fill handles
 * *colour temperature on the shadow side* — without it the shadow band falls
 * back on the hemisphere's green ground bounce alone and skin goes grey-green.
 * 0.24 matches the gallery's 0.55-against-2.35. It casts no shadow, so it is
 * one extra light and no extra draw calls.
 */
export const FILL_LIGHT_RATIO = 0.24;

/**
 * Fog distances.
 *
 * Careful: fog is measured from the *camera*, and an orthographic rig parks its
 * camera CAMERA_DISTANCE away from the action. So these are offsets from that,
 * not from the player — otherwise the entire park sits inside the fog and the
 * whole game turns milky.
 */
export const FOG_NEAR = CAMERA_DISTANCE + 42;
export const FOG_FAR = CAMERA_DISTANCE + 168;

/**
 * Fog distances at midnight, interpolated towards by `nightFactor`.
 *
 * The family asked for "a dark fog so distant items are less visible while the
 * foreground is well lit by street lamps" — the point is the *contrast*, near
 * ground bright under the lamps and distance falling away into darkness.
 *
 * Expressed as offsets from CAMERA_DISTANCE for the same reason the daytime
 * pair are, and read the same way: by day the park fades between 42 m and
 * 168 m from the action, at night between 8 m and 50 m. Night fog used to be
 * the daytime distances scaled by 0.7 and 0.72, which put full fog 96 m out —
 * further than the far side of the park, so it never actually did anything.
 *
 * Both numbers were settled on screen at midnight rather than reasoned out,
 * after trying four pairs:
 *
 * - **`near` is exactly `CAMERA_DISTANCE`**, which is to say the fog starts at
 *   the player and everything nearer the camera than she is stays perfectly
 *   clear. Pulling `near` closer than this (86, and 78) put the child herself
 *   inside the haze, which looks like a mistake rather than like weather.
 * - **`far` is +32**, not the +50 first tried. The camera looks down at 38°,
 *   so a screenful of ground spans about 46 m of camera depth at the furthest
 *   zoom-out and only about 19 m at the default zoom. +50 put full fog beyond
 *   anything ever on screen and the distance barely darkened at all; +16 (the
 *   78/106 pair) swallowed the fountain plaza and the stalls whole. +32 lands
 *   the far plane just past the top of the frame: the treeline and the far
 *   side of the park go to darkness, the plaza is still legible as a place,
 *   and the ground the player is standing on is untouched.
 */
export const NIGHT_FOG_NEAR = CAMERA_DISTANCE;
export const NIGHT_FOG_FAR = CAMERA_DISTANCE + 32;

// ------------------------------------------------------------------ input

/** Radial dead-zone applied to gamepad sticks. */
export const GAMEPAD_DEADZONE = 0.22;

/** Threshold above which a trigger/analogue button counts as pressed. */
export const GAMEPAD_BUTTON_THRESHOLD = 0.5;

// ------------------------------------------------------------------- loop

/** Frame delta is clamped to this many seconds to survive tab-switching. */
export const MAX_FRAME_DELTA = 1 / 12;

/**
 * The furthest the player can move in a single integration step, in metres: a
 * flat-out sprint through the longest frame the loop will ever hand out.
 *
 * 0.93 m — **wider than any garden wall's whole footprint**, which is why
 * `CollisionWorld.resolveMovement` exists and why `Player` moves in sub-steps
 * rather than one leap. `CollisionWorld.checkSubstepBudget` is handed this
 * number at boot and complains if the park has grown something too thin for
 * it to be walked into safely.
 */
export const PLAYER_LONGEST_STEP = PLAYER_MAX_SPEED * PLAYER_SPRINT_MULTIPLIER * MAX_FRAME_DELTA;

/**
 * Half-life, in seconds, of the exponential damp `Player.update` runs the
 * character's height through so walking the gentle hills is not jittery.
 *
 * **It used to decide how steep a slope the game could have. Since #358 it does
 * not, and that is the point of the fix.** `Player.update` handed
 * `this.position.y` — the *damped, lagging* height — to the ground sampler, and
 * `WalkSurfaces.sample` will not return a surface more than
 * {@link BUILDING_STEP_UP} above what it is asked from. Climbing steadily the
 * damp never catches up: it keeps `2^(-dt / this)` of the gap each frame, so at
 * a clamped {@link MAX_FRAME_DELTA} the lag settled at 0.309x the per-frame
 * climb, and a sprinting child had to clear her own climb *plus* that lag — a
 * third of her step-up allowance spent on a smoothing filter.
 *
 * `Player` now keeps `groundHeight`, the surface she is actually standing on,
 * and asks the sampler from **that**. This half-life is once again only what it
 * says it is: how smoothly she is *drawn*, and it is no longer read by anything
 * that decides what the park may build — {@link SPRINT_PEAK_GRADE_BUDGET} was
 * a `Math.pow` away from this number until #358 and is now a frozen literal,
 * precisely so that changing this cannot re-plan a bridge behind your back.
 *
 * **It is still a feel change on a physics value, so measure it.** A longer
 * half-life makes her height lag further behind the ground, which is visible on
 * the steep bits and shows up in `npm run check:deck-fallthrough` as a changed
 * `true-surface reference only` row — that row is the one that still depends on
 * this. The ceiling of the shipping configuration does not.
 */
export const PLAYER_HEIGHT_DAMP_HALF_LIFE = 0.04;

/**
 * Drop further than this below the surface under your feet and you start
 * falling.
 *
 * One owner: `Player` and `NpcCharacter` each used to declare their own
 * identical copy, and `test/procgen/invariants.ts` needs the same number to
 * decide whether losing a bridge deck actually drops a child or merely sets
 * her down on the ground that was already under it.
 */
export const FALL_THRESHOLD = 0.5;

/**
 * **The steepest slope a sprinting child can climb without losing the surface
 * under her** — the ceiling every walkable ramp in the park is built to.
 *
 * ### What this number was, and why it is no longer the truth (#358)
 *
 * It used to be **0.512**, and that figure was the shape of a bug rather than a
 * fact about ramps. `Player` sampled the walking surface once per frame, at the
 * end of the whole frame's movement, asked from her *damped* height: so the
 * whole of one clamped frame's climb ({@link PLAYER_LONGEST_STEP}) had to fit
 * inside {@link BUILDING_STEP_UP} **plus** the damp's 0.309x lag, giving
 * `0.62 / 1.309 / 0.925` = 0.512. Past it a sprinting child fell through the
 * deck she was running across, and real browser QA watched it happen.
 *
 * That is fixed. The ground sample now rides the same sub-steps
 * `CollisionWorld.resolveMovement` already cut lateral movement into, and is
 * asked from the surface she is standing on rather than the damped height she
 * is drawn at. **Measured** by `scripts/measure-deck-fallthrough.mts` — real
 * `WalkSurfaces.sample`, 27 gradients x 5 frame rates x 64 start phases x
 * walk/sprint x up/down, against a control that reproduces the old behaviour:
 *
 * ```
 *   neither (as shipped before #358)   0.512
 *   sub-stepping only                  0.512
 *   true-surface reference only        0.670
 *   both (what ships now)              1.670
 * ```
 *
 * **Sub-stepping alone buys nothing**, and that is worth knowing before anyone
 * reverts the half that looks redundant: asked from the damped height, every
 * sub-step asks from the *same frozen number*, so the last one lands where the
 * single end-of-frame sample landed and answers identically. The two fixes are
 * interdependent, not additive.
 *
 * 1.670 matches the derived prediction of 1.676 — `BUILDING_STEP_UP` over the
 * worst sub-step (0.370 m, at 15 fps, against the park's thinnest 0.18 m
 * collider). The **park-independent floor**, if the park ever contained nothing
 * thin enough to force a sub-step at all, is `BUILDING_STEP_UP /
 * PLAYER_LONGEST_STEP` = **0.670** — still above the old ceiling, because the
 * damp lag no longer eats a third of the allowance.
 *
 * ### Why the value is still 0.512
 *
 * Because {@link MAX_RAMP_GRADIENT} is derived from it, and raising it re-plans
 * **every bridge on every seed** — more crossing sites prove out, `paths.ts`
 * reroutes, and the whole park's layout moves (measured on #349: crossing
 * counts changed on four of five seeds). That is a deliberate, separately
 * measured piece of work with real gameplay consequences, not a side effect of
 * a physics fix, so #358 deliberately leaves the number alone and only removes
 * the reason it had to be this low.
 *
 * **Whoever raises it**: the headroom is real and measured — anything up to
 * 0.670 is safe on any park whatever, and up to ~1.67 on this one — but re-run
 * `npm run check:deck-fallthrough` and the procgen invariants against the
 * geometry you actually end up with, because the safe ceiling is a function of
 * the park's thinnest collider and would fall if that ever got fatter.
 *
 * ### Why it is a frozen literal and not the arithmetic that produced it
 *
 * It used to be computed live:
 *
 * ```ts
 * const retention = Math.pow(2, -MAX_FRAME_DELTA / PLAYER_HEIGHT_DAMP_HALF_LIFE);
 * const lag = retention / (1 - retention);
 * return BUILDING_STEP_UP / (1 + lag) / PLAYER_LONGEST_STEP;
 * ```
 *
 * That arithmetic is **obsolete** — it models one ground sample per frame taken
 * from the damped height, and #358 made both halves of that untrue. Left live,
 * it was worse than merely wrong: it meant {@link PLAYER_HEIGHT_DAMP_HALF_LIFE},
 * a number whose entire remaining job is how smoothly the character is *drawn*,
 * still silently sized every ramp in the park. Nudging it from 0.04 to 0.06 for
 * feel would have moved this budget to 0.414 and `MAX_RAMP_GRADIENT` to 0.311,
 * re-planning every bridge on every seed as a side effect of an animation
 * tweak. Freezing it cuts that wire.
 *
 * The literal is the exact double the old expression produced, **not** a tidy
 * 0.512, and deliberately so: `MAX_RAMP_GRADIENT` feeds `SITE_RAMP_FLOOR`,
 * which is a *threshold* deciding whether a crossing site proves at all, so
 * even a 1e-4 rounding could flip a marginal site and silently re-plan a seed.
 * Frozen bit-identically, #358 provably changes no geometry anywhere.
 *
 * Change this number when you mean to change the park, and measure the bridges
 * when you do — that is issue #382's job, not something to arrive at by
 * arithmetic drift.
 */
export const SPRINT_PEAK_GRADE_BUDGET = 0.5121075476046892;
