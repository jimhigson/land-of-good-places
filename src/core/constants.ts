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
export const TERRAIN_RADIUS = 72;

/**
 * The hilltop crest. Between RIM_START and RIM_END the ground falls away by
 * RIM_DROP metres, which is steeper than the camera pitch — so the slope hides
 * itself and the horizon appears just above the boundary wall.
 */
export const RIM_START = 61;
export const RIM_END = 71;
export const RIM_DROP = 17;

/** Rings on the terrain disc. Higher = smoother hills. */
export const TERRAIN_SEGMENTS = 72;

/** Vertical scale of the gentle rolling hills. Deliberately small — "flat-ish". */
export const TERRAIN_HEIGHT_SCALE = 0.55;

// ----------------------------------------------------------------- player

export const PLAYER_DEFAULT_NAME = 'Eleri';

/** Top walking speed, metres/second. */
export const PLAYER_MAX_SPEED = 7.4;

/** Acceleration towards the desired velocity, metres/second². */
export const PLAYER_ACCELERATION = 46;

/** Deceleration applied when there is no input, metres/second². */
export const PLAYER_DECELERATION = 34;

/** How fast the character swivels to face travel direction, radians/second. */
export const PLAYER_TURN_SPEED = 13;

/** Radius used for pushing the player out of scenery. */
export const PLAYER_RADIUS = 0.62;

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
export const BUILDING_CENTRE_X = -28.5;
export const BUILDING_CENTRE_Z = -30.5;

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

/** Floating bubble: metres per second, and seconds it waits at each end. */
export const BUBBLE_SPEED = 1.5;
export const BUBBLE_DWELL = 3.6;

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
 */
export const CAMERA_ZOOM_MIN = 0.42;
export const CAMERA_ZOOM_MAX = 2.4;
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

// ------------------------------------------------------------------ input

/** Radial dead-zone applied to gamepad sticks. */
export const GAMEPAD_DEADZONE = 0.22;

/** Threshold above which a trigger/analogue button counts as pressed. */
export const GAMEPAD_BUTTON_THRESHOLD = 0.5;

// ------------------------------------------------------------------- loop

/** Frame delta is clamped to this many seconds to survive tab-switching. */
export const MAX_FRAME_DELTA = 1 / 12;
