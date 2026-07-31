// ─── BUILD VERSION (bump this each build) ───
export const BUILD_VERSION = 'v26';

// Tunable game parameters — adjust values here, not scattered in code

// Character
export const MOVE_SPEED = 8;
export const JUMP_FORCE = 12;
export const GRAVITY = -30;
export const CAPY_RADIUS = 0.5;
export const ACCEL_TIME = 0.12;    // seconds to reach max speed
export const DECEL_TIME = 0.15;    // seconds to stop

// Camera
export const CAMERA_DISTANCE = 11;
export const CAMERA_HEIGHT = 5.5;
export const MOUSE_SENSITIVITY = 0.003;
export const CAMERA_LERP = 3.5;    // follow smoothness (lower = smoother)

// Rendering
export const PIXEL_SIZE = 1;       // RenderPixelatedPass resolution divisor

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

// Vegetation
export const CLOUD_BUSH_COUNT = 18;
export const GRASS_PATCH_COUNT = 50;
export const BOULDER_COUNT = 15;
export const EDGE_WALL_COUNT = 35;
