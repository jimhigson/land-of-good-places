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

/** Interior half-extents in metres — a 24 x 18 m footprint. */
export const BUILDING_HALF_X = 12;
export const BUILDING_HALF_Z = 9;

/** Number of walkable decks. Deck 0 is the ground floor, deck 4 the slide deck. */
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

/** Launch speed off the trampoline, first bounce and hardest bounce (m/s). */
export const TRAMPOLINE_MIN_LAUNCH = 9;
export const TRAMPOLINE_MAX_LAUNCH = 17;

/** Glass lift: metres per second, and seconds it waits at each floor. */
export const LIFT_SPEED = 2.4;
export const LIFT_DWELL = 3.2;

/** Floating bubble: metres per second, and seconds it waits at each end. */
export const BUBBLE_SPEED = 1.5;
export const BUBBLE_DWELL = 3.6;

/** Escalator carry speed, metres per second along the ramp. */
export const ESCALATOR_SPEED = 1.1;

/** How fast you travel down a slide, in metres of spline per second. */
export const SLIDE_SPEED = 12;

/** Number of squishy balls in the ball pit. */
export const BALL_PIT_COUNT = 190;

// ----------------------------------------------------------------- camera

/**
 * Pseudo-isometric rig, Theme Park style: an orthographic camera at a fixed
 * downward angle that never rotates freely — only in 90° steps.
 */
export const CAMERA_IS_ORTHOGRAPHIC = true;

/** Downward pitch of the camera in degrees. Theme Park sat around 35–40°. */
export const CAMERA_PITCH_DEGREES = 38;

/** Starting compass rotation in degrees (45° gives the classic iso diamond). */
export const CAMERA_YAW_DEGREES = 45;

/** Vertical world-units visible at default zoom (orthographic frustum height). */
export const CAMERA_VIEW_HEIGHT = 22;

export const CAMERA_ZOOM_MIN = 0.55;
export const CAMERA_ZOOM_MAX = 1.9;
export const CAMERA_ZOOM_STEP = 0.16;

/** Distance the camera sits back from its target (affects clipping only). */
export const CAMERA_DISTANCE = 90;

/** Smoothing half-life in seconds for the camera following the player. */
export const CAMERA_FOLLOW_HALF_LIFE = 0.16;

/** Seconds for a 90° camera rotation snap. */
export const CAMERA_ROTATE_DURATION = 0.42;

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

/** Half-extent of the sun's shadow frustum; it follows the player. */
export const SHADOW_AREA = 34;

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
