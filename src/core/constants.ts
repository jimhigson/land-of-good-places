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

/** Number of segments per side on the terrain mesh. Higher = smoother hills. */
export const TERRAIN_SEGMENTS = 96;

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
export const CAMERA_VIEW_HEIGHT = 26;

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
export const FAIRY_LIGHT_ON = 0.76;
export const FAIRY_LIGHT_OFF = 0.26;

// ---------------------------------------------------------------- renderer

/** Device pixel ratio is clamped to this to keep 60fps on laptops. */
export const MAX_PIXEL_RATIO = 2;

export const SHADOW_MAP_SIZE = 2048;

/** Half-extent of the sun's shadow frustum; it follows the player. */
export const SHADOW_AREA = 34;

/** Fog distances at the default zoom. Scaled by zoom at runtime. */
export const FOG_NEAR = 46;
export const FOG_FAR = 168;

// ------------------------------------------------------------------ input

/** Radial dead-zone applied to gamepad sticks. */
export const GAMEPAD_DEADZONE = 0.22;

/** Threshold above which a trigger/analogue button counts as pressed. */
export const GAMEPAD_BUTTON_THRESHOLD = 0.5;

// ------------------------------------------------------------------- loop

/** Frame delta is clamped to this many seconds to survive tab-switching. */
export const MAX_FRAME_DELTA = 1 / 12;
