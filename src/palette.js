// Color palette — single source of truth for all colors in the scene
import * as THREE from 'three';

export const P = {
  darkest:    0x0A0D0B,
  dark:       0x1F2520,
  midDark:    0x35482D,
  midCool:    0x3C4D42,
  midWarm:    0x595A4C,
  bright:     0x4E6A3A,
  brightPale: 0x858766,
  hilight:    0xD5D3B8,
  cream:      0xF0EFE2,
  sky:        0x456278,
  warm:       0xB68470,
};

// Vegetation
export const BUSH_LIGHT = 0x8DC63F;
export const BUSH_DARK  = 0x2B6B30;
export const ROCK_COLORS = [0x6B6560, 0x7A7168, 0x5E5850];
export const POOL_ROCK_COLORS = [0x7A7168, 0x6B6560, 0x8A8078];
export const GRASS_COLORS = ['#253D22', '#294225', '#233A20', '#274024'];
export const GRASS_BASE = '#253D22';
export const GROUND_TINT = 0x6DBB6D;

// Water
export const WATER_COLOR = 0x6BD4F0;
export const TUB_WATER_COLOR = 0x8FD3E8;

// Wood
export const SIGN_WOOD = 0x6B5744;
export const GATE_WOOD = 0x5A4030;

// Day/Night presets
export const DAY = {
  bg: new THREE.Color(0x0A0D0B), fog: new THREE.Color(0x2A4050),
  ambientI: 2.2, sunI: 1.2, skyTop: [0x2A,0x48,0x58], skyBot: [0x5A,0x8A,0x98],
};
export const NOON = {
  bg: new THREE.Color(0x2A3A28), fog: new THREE.Color(0x88BBAA),
  ambientI: 4.0, sunI: 2.5, skyTop: [0x55,0x99,0xDD], skyBot: [0xAA,0xDD,0xF0],
};

// Toon gradient
export function makeToonGradient(steps) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
