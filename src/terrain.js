// ─── Terrain module: noise, ground height, background layers ───
import * as THREE from 'three';
import {
  POOL_DEFS, POOL_DEPTH,
  TERRAIN_AMP, TERRAIN_DETAIL_AMP, TERRAIN_FREQ, TERRAIN_DETAIL_FREQ,
  SPAWN_FLAT, POOL_FLAT_OFFSET, POOL_FLAT_TRANS, EDGE_TAPER,
  FAR_MTN_COUNT, MID_MTN_COUNT, FOREST_RING_COUNT,
} from './config.js';

// ─── PROCEDURAL NOISE ───
function _nh(n) { const s = Math.sin(n) * 43758.5453; return s - Math.floor(s); }
function _nh2(x, y) { return _nh(x * 127.1 + y * 311.7); }
function _sm(t) { return t * t * (3 - 2 * t); }

export function noise2D(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = _sm(fx), sy = _sm(fy);
  const a = _nh2(ix, iy), b = _nh2(ix + 1, iy);
  const c = _nh2(ix, iy + 1), d = _nh2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(x, y, oct) {
  let v = 0, a = 1, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) { v += a * noise2D(x * f, y * f); tot += a; a *= 0.5; f *= 2; }
  return v / tot;
}

export function smoothstep(lo, hi, x) {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

// ─── POOL DEPRESSION ───
export function poolDepth(dist, r) {
  const flatR = Math.max(0, r - 0.5);
  const edgeR = r + 0.8;
  if (dist >= edgeR) return 0;
  if (dist <= flatR) return -POOL_DEPTH;
  const t = (dist - flatR) / (edgeR - flatR);
  return -POOL_DEPTH * (1 - t * t * t);
}

// ─── GROUND HEIGHT ───
export function getGroundHeight(wx, wz) {
  let h = (fbm(wx * TERRAIN_FREQ, wz * TERRAIN_FREQ, 4) * 2 - 1) * TERRAIN_AMP;
  h += (fbm(wx * TERRAIN_DETAIL_FREQ + 7.3, wz * TERRAIN_DETAIL_FREQ + 3.1, 2) * 2 - 1) * TERRAIN_DETAIL_AMP;

  h *= smoothstep(SPAWN_FLAT[0], SPAWN_FLAT[1], Math.hypot(wx, wz));
  for (const p of POOL_DEFS) {
    h *= smoothstep(p.r + POOL_FLAT_OFFSET, p.r + POOL_FLAT_TRANS, Math.hypot(wx - p.x, wz - p.z));
  }
  h *= 1 - smoothstep(EDGE_TAPER[0], EDGE_TAPER[1], Math.hypot(wx, wz));

  for (const p of POOL_DEFS) {
    const dist = Math.hypot(wx - p.x, wz - p.z);
    if (dist < p.r + 1.0) {
      h = Math.min(h, poolDepth(dist, p.r));
    }
  }
  return h;
}

// ─── BACKGROUND DEPTH LAYERS ───
export function createBackgroundLayers(scene, toonGrad) {
  const hemiGeo = new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);

  // Layer 1: FAR MOUNTAINS (distance 85-100)
  for (let i = 0; i < FAR_MTN_COUNT; i++) {
    const angle = (i / FAR_MTN_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    const dist = 85 + Math.random() * 15;
    const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
    const h = 8 + Math.random() * 12;
    const w = 12 + Math.random() * 20;
    const mountain = new THREE.Mesh(hemiGeo, new THREE.MeshToonMaterial({
      color: [0x1A2A2E, 0x162428, 0x1E3035][Math.floor(Math.random() * 3)],
      gradientMap: toonGrad,
    }));
    mountain.scale.set(w, h, w * (0.5 + Math.random() * 0.5));
    mountain.position.set(x, -2, z);
    scene.add(mountain);
  }

  // Layer 2: MID MOUNTAINS (distance 65-80)
  for (let i = 0; i < MID_MTN_COUNT; i++) {
    const angle = (i / MID_MTN_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
    const dist = 65 + Math.random() * 15;
    const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
    const h = 4 + Math.random() * 8;
    const w = 8 + Math.random() * 14;
    const mountain = new THREE.Mesh(hemiGeo, new THREE.MeshToonMaterial({
      color: [0x223830, 0x1E3428, 0x2A4035][Math.floor(Math.random() * 3)],
      gradientMap: toonGrad,
    }));
    mountain.scale.set(w, h, w * (0.5 + Math.random() * 0.5));
    mountain.position.set(x, -1, z);
    scene.add(mountain);
  }

  // Layer 3: DENSE FOREST RING (distance 48-58)
  const bushGeo = new THREE.SphereGeometry(1, 5, 4);
  for (let i = 0; i < FOREST_RING_COUNT; i++) {
    const angle = (i / FOREST_RING_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
    const dist = 48 + Math.random() * 10;
    const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
    const s = 2.5 + Math.random() * 3.5;
    const treeBush = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({
      color: [0x1E3A1E, 0x2A5A2A, 0x1A4520, 0x254A25][Math.floor(Math.random() * 4)],
      gradientMap: toonGrad,
    }));
    treeBush.scale.set(s * 1.3, s * 1.2, s * 1.3);
    treeBush.position.set(x, s * 0.5, z);
    scene.add(treeBush);
  }
}
