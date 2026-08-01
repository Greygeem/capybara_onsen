// ─── BUILD VERSION (bump this each build) ───
export const BUILD_VERSION = 'v31';

// Tunable game parameters — adjust values here, not scattered in code

// Character
export const MOVE_SPEED = 8;
export const JUMP_FORCE = 12;
export const GRAVITY = -30;
export const CAPY_RADIUS = 0.5;
export const ACCEL_TIME = 0.12;
export const DECEL_TIME = 0.15;

// Camera
export const CAMERA_DISTANCE = 12;
export const CAMERA_HEIGHT = 4.5;
export const CAMERA_FOV = 50;
export const MOUSE_SENSITIVITY = 0.003;
export const CAMERA_LERP = 3.5;

// Rendering
export const PIXEL_SIZE = 1;

// Interaction
export const PROJECT_INTERACT_DIST = 8;

// Pools
export const POOL_DEFS = [
  { x: 6, z: 0, r: 4.5 },
  { x: -8, z: -6, r: 3.5 },
  { x: -4, z: 10, r: 3 },
  { x: 14, z: -20, r: 3 },
  { x: -2, z: -24, r: 3 },
  { x: 2, z: 24, r: 3.5 },
];
export const POOL_DEPTH = 0.7;
export const WATER_Y = -0.15;

// Sprite
export const CAPY_HEIGHT = 2.8;

// Terrain
export const TERRAIN_AMP = 1.2;
export const TERRAIN_DETAIL_AMP = 0.25;
export const TERRAIN_FREQ = 0.035;
export const TERRAIN_DETAIL_FREQ = 0.12;
export const SPAWN_FLAT = [5, 14];
export const POOL_FLAT_OFFSET = 3;
export const POOL_FLAT_TRANS = 8;
export const EDGE_TAPER = [38, 52];

// Ground mesh
export const GROUND_SIZE = 160;
export const GROUND_SUBDIVS = 100;
export const GRASS_REPEAT = 66;

// Shadows
export const SHADOW_MAP_SIZE = 1024;
export const SHADOW_RANGE = 45;

// Fog
export const FOG_NEAR = 50;
export const FOG_FAR = 130;

// Sky
export const SKY_RADIUS = 120;

// Background layers
export const FAR_MTN_COUNT = 12;
export const MID_MTN_COUNT = 14;
export const FOREST_RING_COUNT = 28;
