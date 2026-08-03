import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCharacter } from './character.js';
import { PROJECTS as PROJECT_DATA } from './projects.js';
import { addStamp, initStampBoard, hasStamp, getStampCount, getTotalCount } from './stamps.js';
import { initBuildMarker } from './ui.js';
import { getGroundHeight, createBackgroundLayers } from './terrain.js';
import {
  POOL_DEFS, POOL_DEPTH, WATER_Y,
  CAMERA_DISTANCE, CAMERA_HEIGHT, CAMERA_FOV, MOUSE_SENSITIVITY, CAMERA_LERP,
  PROJECT_INTERACT_DIST, PIXEL_SIZE,
  GROUND_SIZE, GROUND_SUBDIVS, GRASS_REPEAT,
  SHADOW_MAP_SIZE, SHADOW_RANGE,
  FOG_NEAR, FOG_FAR, SKY_RADIUS,
} from './config.js';

// ─── PALETTE (from reference) ───
const P = {
  darkest:    0x0A0D0B,  // Deep shade (barely shifted)
  dark:       0x1F2520,  // Shadow gray-green
  midDark:    0x35482D,  // Muted leaf
  midCool:    0x3C4D42,  // Dusty sage
  midWarm:    0x595A4C,  // Warm gray-olive
  bright:     0x4E6A3A,  // Sage green (was vivid)
  brightPale: 0x858766,  // Pale olive
  hilight:    0xD5D3B8,  // Warm cream
  cream:      0xF0EFE2,  // Soft cream
  sky:        0x456278,  // Dusty steel blue
  warm:       0xB68470,  // Muted terracotta
};

// ─── TOON GRADIENT (3-step: shadow / mid / lit) ───
function makeToonGradient(steps) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
const toonGrad = makeToonGradient(3);


// ─── PROJECTS ───
const PROJECTS = PROJECT_DATA.map(p => ({ ...p, desc: p.description, color: P.bright }));

// ─── STATE ───
const keys = {};
const mouse = { x: 0, y: 0 };
let cameraAngleX = 0, cameraAngleY = 0.3;
let nearestProject = null, detailOpen = false, overlayOpen = false, started = true;
let clock, scene, camera, renderer, composer;
let character = null; // character controller from character.js
let projectSigns = [], steamParticles = [], waterMeshes = [], lanternMeshes = [];
let yuzuGroups = [], poolData = [];
let obstacles = []; // {x, z, r} for collision
let godRayMeshes = [];
let swayMeshes = []; // bushes/grass for wind sway
let sparkleParticles = []; // water surface sparkle
let debugColliders = null, debugVisible = false;

// ─── DAY/NIGHT ───
let isNoon = true, dayNightT = 1; // t: 0=night, 1=noon
const DAY = {
  bg: new THREE.Color(0x0A0D0B), fog: new THREE.Color(0x3A5A70),
  ambientI: 2.2, sunI: 1.2, skyTop: [0x2A,0x48,0x58], skyBot: [0x5A,0x8A,0x98],
};
const NOON = {
  bg: new THREE.Color(0x2A3A28), fog: new THREE.Color(0x8AC8E0),
  ambientI: 4.0, sunI: 2.5, skyTop: [0x55,0x99,0xDD], skyBot: [0xAA,0xDD,0xF0],
};
let ambientLight, sunLight, skyMesh;

// ─── INIT ───
function init() {
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(P.darkest);
  scene.fog = new THREE.Fog(0x8BBDD6, FOG_NEAR, FOG_FAR);

  camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 200);
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  composer = new EffectComposer(renderer);
  const px = new RenderPixelatedPass(PIXEL_SIZE, scene, camera);
  px.normalEdgeStrength = 0; px.depthEdgeStrength = 0;
  composer.addPass(px);
  composer.addPass(new OutputPass());

  buildScene().then(async () => {
    // Create character AFTER scene (so obstacles are populated)
    character = await createCharacter(scene, {
      obstacles, poolData, getGroundHeight, WATER_Y, creamColor: P.cream, camera,
    });
    setupEvents(); setupDayNight(); initStampBoard(); initBuildMarker(); animate();
    // Hide loading overlay
    const loadingEl = document.getElementById('loading-overlay');
    if (loadingEl) { loadingEl.classList.add('fade-out'); setTimeout(() => loadingEl.remove(), 700); }
    // Debug
    window.__toggleRays = (v) => godRayMeshes.forEach(r => r.visible = v);
    window.__teleport = (x, z) => { if (character) character.group.position.set(x, 0, z); };
    window.__obstacles = obstacles;
    window.__togglePixelation = () => {
      const px = composer.passes[0];
      px.enabled = !px.enabled;
      console.log('[DEBUG] pixelation', px.enabled ? 'ON' : 'OFF');
    };
  });
}

// ─── BUILD SCENE ───
async function buildScene() {
  // === LIGHTING ===
  ambientLight = new THREE.AmbientLight(P.midDark, 2.2);
  scene.add(ambientLight);
  scene.add(new THREE.HemisphereLight(P.hilight, P.dark, 0.6));
  sunLight = new THREE.DirectionalLight(P.hilight, 1.2);
  const sun = sunLight;
  sun.position.set(20, 35, -15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = SHADOW_RANGE * 2;
  sun.shadow.camera.left = -SHADOW_RANGE; sun.shadow.camera.right = SHADOW_RANGE;
  sun.shadow.camera.top = SHADOW_RANGE; sun.shadow.camera.bottom = -SHADOW_RANGE;
  scene.add(sun);

  createSky();
  createGround();
  createVegetation();
  createGodRays();
  createOnsenPools();
  PROJECTS.forEach((p, i) => createProjectSign(p, i));
  createUndergrowth();
  createOnsenProps();
  createSteamSystem();
  createBackgroundLayers(scene, toonGrad);
}

// ─── SKY (barely visible through canopy) ───
function createSky() {
  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  // Vertex color gradient: brighter at horizon, darker at zenith
  const colors = new Float32Array(skyGeo.attributes.position.count * 3);
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const y = skyGeo.attributes.position.getY(i);
    const t = Math.max(0, Math.min(1, (y + 5) / SKY_RADIUS)); // 0 at horizon, 1 at top
    // Horizon: warm teal #5A8A98, Zenith: deep #2A4858
    const r = (0x5A + (0x2A - 0x5A) * t) / 255;
    const g = (0x8A + (0x48 - 0x8A) * t) / 255;
    const b = (0x98 + (0x58 - 0x98) * t) / 255;
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.position.y = -5;
  scene.add(skyMesh);
}

// ─── GROUND (deep green grass + moss) ───
function createGround() {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SUBDIVS, GROUND_SUBDIVS);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, getGroundHeight(x, y));
  }
  geo.computeVertexNormals();

  // Procedural moss/grass texture
  const tc = document.createElement('canvas'); tc.width = 64; tc.height = 64;
  const cx = tc.getContext('2d'); cx.imageSmoothingEnabled = false;
  cx.fillStyle = '#253D22'; cx.fillRect(0, 0, 64, 64);
  const grassCols = ['#253D22', '#294225', '#233A20', '#274024'];
  for (let y = 0; y < 64; y += 2) {
    for (let x = 0; x < 64; x += 2) {
      cx.fillStyle = grassCols[Math.floor(Math.random() * grassCols.length)];
      cx.fillRect(x, y, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(tc);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GRASS_REPEAT, GRASS_REPEAT); tex.generateMipmaps = false;

  const ground = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
    map: tex, color: 0x6DBB6D, gradientMap: toonGrad,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

}

// ─── VEGETATION (low forest floor — no pointed objects) ───
function createVegetation() {
  const bushGeo = new THREE.SphereGeometry(1, 5, 4);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const bushLight = 0x8DC63F, bushDark = 0x2B6B30;

  // Track all placed items for overlap prevention
  const placed = [];
  function canPlace(x, z, r) {
    for (const p of placed) {
      if (Math.hypot(x - p.x, z - p.z) < r + p.r + 0.3) return false;
    }
    return true;
  }
  function placeAt(x, z, r) { placed.push({ x, z, r }); }

  // Helper: near pools/signs/start = restricted
  function isClear(x, z) {
    if (Math.hypot(x, z) < 6) return false;
    for (const p of POOL_DEFS) { if (Math.hypot(x - p.x, z - p.z) < p.r + 3) return false; }
    for (const pr of PROJECTS) { if (Math.hypot(x - pr.position[0], z - pr.position[2]) < 5) return false; }
    return true;
  }
  // Near edge or near pool cluster = good bush placement
  function isEdgeOrCluster(x, z) {
    const d = Math.hypot(x, z);
    if (d > 25) return true; // near edge
    for (const p of POOL_DEFS) { if (Math.hypot(x - p.x, z - p.z) < p.r + 6) return true; }
    return false;
  }

  // 1. Cloud-shaped bushes — halved, near edges/pools only
  for (let i = 0; i < 18; i++) {
    const r = 6 + Math.random() * 32;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isClear(x, z) || !isEdgeOrCluster(x, z)) continue;
    if (!canPlace(x, z, 1.0)) continue;
    placeAt(x, z, 1.0);
    const baseS = 0.5 + Math.random() * 0.5;
    const clumpCount = 2 + Math.floor(Math.random() * 2);
    for (let j = 0; j < clumpCount; j++) {
      const cs = baseS * (0.6 + Math.random() * 0.4);
      const col = j % 2 === 0 ? bushLight : bushDark;
      const blob = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({ color: col, gradientMap: toonGrad }));
      blob.scale.set(cs, cs * 0.7, cs);
      blob.position.set(x + (Math.random()-0.5)*baseS*0.6, getGroundHeight(x, z) + cs*0.3, z + (Math.random()-0.5)*baseS*0.6);
      blob.userData.swayPhase = Math.random() * Math.PI * 2;
      scene.add(blob);
      swayMeshes.push(blob);
    }
  }

  // 2. Low round grass patches — knee-height, no collision
  for (let i = 0; i < 50; i++) {
    const r = 3 + Math.random() * 38;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isClear(x, z)) continue;
    const s = 0.2 + Math.random() * 0.4;
    const patch = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({
      color: [bushLight, 0x6AA035, 0x4A8A30][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
    }));
    patch.scale.set(s * 1.2, s * 0.3, s * 1.2); // very flat
    patch.position.set(x, getGroundHeight(x, z) + s * 0.05, z);
    patch.userData.swayPhase = Math.random() * Math.PI * 2;
    scene.add(patch);
    swayMeshes.push(patch);
  }

  // 3. Boulders — warm gray, with collision (reduced for cleaner lawn)
  for (let i = 0; i < 5; i++) {
    const r = 5 + Math.random() * 30;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isClear(x, z)) continue;
    let inPool = false;
    for (const pool of POOL_DEFS) { if (Math.hypot(x - pool.x, z - pool.z) < pool.r + 0.5) { inPool = true; break; } }
    if (inPool) continue;
    const s = 0.5 + Math.random() * 1.0;
    if (!canPlace(x, z, s * 0.5)) continue;
    placeAt(x, z, s * 0.5);
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshToonMaterial({
      color: [0x6B6560, 0x7A7168, 0x5E5850][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
    }));
    rock.scale.setScalar(s);
    rock.position.set(x, getGroundHeight(x, z) + s * 0.3, z);
    rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.5);
    rock.castShadow = true;
    scene.add(rock);
    if (s > 0.8) obstacles.push({ x, z, r: s * 0.5 });
  }

  // 4. Edge wall — boundary ring
  for (let i = 0; i < 35; i++) {
    const a = (i / 35) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
    const dist = 38 + Math.random() * 8;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    const s = 1.5 + Math.random() * 1.5;
    const wall = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({
      color: [bushDark, 0x2A5A2A, P.midDark][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
    }));
    wall.scale.set(s * 1.5, s, s * 1.5);
    wall.position.set(x, getGroundHeight(x, z) + s * 0.4, z);
    scene.add(wall);
    obstacles.push({ x, z, r: s * 0.8 });
  }

  // Export placed items for cross-module overlap checking
  window.__vegPlaced = placed;
}

// ─── GOD RAYS (light beams through canopy) ───
function createGodRays() {
  const rayGeo = new THREE.CylinderGeometry(0.3, 1.5, 18, 6, 1, true);
  const rayMat = new THREE.MeshBasicMaterial({
    color: P.hilight, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false,
  });

  const rayPositions = [
    [5, -1], [-7, -5], [-3, 9], [13, -19],
  ];

  rayPositions.forEach(([x, z]) => {
    const ray = new THREE.Mesh(rayGeo, rayMat.clone());
    ray.position.set(x + (Math.random() - 0.5) * 3, 9, z + (Math.random() - 0.5) * 3);
    ray.rotation.set(
      (Math.random() - 0.5) * 0.15,
      Math.random() * Math.PI,
      (Math.random() - 0.5) * 0.15,
    );
    ray.material.opacity = (0.015 + Math.random() * 0.015); // halved for subtlety
    ray.renderOrder = -1; // render before sprite
    scene.add(ray);
    godRayMeshes.push(ray);
  });
}

// ─── UNDERGROWTH (ferns, moss rocks, bushes) ───
function createUndergrowth() {
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);

  // Mossy rocks scattered (reduced — cleaner lawn)
  for (let i = 0; i < 8; i++) {
    const r = 3 + Math.random() * 40;
    const a = Math.random() * Math.PI * 2;
    const s = 0.3 + Math.random() * 1;
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshToonMaterial({
      color: [0x6B6560, 0x7A7168, 0x5E5850][Math.floor(Math.random() * 3)],
      gradientMap: toonGrad,
    }));
    rock.scale.setScalar(s);
    const rx = Math.cos(a) * r, rz = Math.sin(a) * r;
    // Skip if inside onsen area or overlapping existing obstacles (incl. stone lanterns)
    let skip = false;
    for (const pool of POOL_DEFS) { if (Math.hypot(rx - pool.x, rz - pool.z) < pool.r + 1) { skip = true; break; } }
    if (!skip) { for (const obs of obstacles) { if (Math.hypot(rx - obs.x, rz - obs.z) < s * 0.6 + obs.r + 0.3) { skip = true; break; } } }
    if (skip) continue;
    rock.position.set(rx, getGroundHeight(rx, rz) + s * 0.25, rz);
    rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.5);
    rock.castShadow = true;
    scene.add(rock);
    if (s > 0.7) obstacles.push({ x: rx, z: rz, r: s * 0.6 }); // big rock collision
  }

  // Bush clusters (small sphere groups on ground — reduced)
  const bushGeo = new THREE.SphereGeometry(1, 5, 4);
  for (let i = 0; i < 12; i++) {
    const r = 2 + Math.random() * 45;
    const a = Math.random() * Math.PI * 2;
    const s = 0.4 + Math.random() * 0.8;
    const bush = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({
      color: [P.midDark, P.dark, P.midCool, P.midDark][Math.floor(Math.random() * 4)],
      gradientMap: toonGrad,
    }));
    bush.scale.set(s, s * 0.6, s);
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    // Skip if inside onsen area or overlapping obstacles
    let skip2 = false;
    for (const pool of POOL_DEFS) { if (Math.hypot(bx - pool.x, bz - pool.z) < pool.r + 1) { skip2 = true; break; } }
    if (!skip2) { for (const obs of obstacles) { if (Math.hypot(bx - obs.x, bz - obs.z) < s * 0.4 + obs.r + 0.2) { skip2 = true; break; } } }
    if (skip2) continue;
    bush.position.set(bx, getGroundHeight(bx, bz) + s * 0.2, bz);
    scene.add(bush);
  }
}

// ─── ONSEN POOLS (forest clearing) ───
function createOnsenPools() {
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);

  POOL_DEFS.forEach(p => {
    poolData.push(p);

    // Pool floor — sized to fully cover rock-ring interior + ripple margin
    const floorR = p.r + 0.7;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(floorR, 48),
      new THREE.MeshBasicMaterial({ color: P.dark }),
    );
    floor.position.set(p.x, WATER_Y - 0.05, p.z); // just below water, above depressed ground
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Border rocks — bigger, at pool rim to cover edge
    const rc = Math.floor(p.r * 6);
    for (let i = 0; i < rc; i++) {
      const a = (i / rc) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const d = p.r + (Math.random() - 0.5) * 0.5;
      const s = 0.5 + Math.random() * 0.5;
      const rock = new THREE.Mesh(rockGeo, new THREE.MeshToonMaterial({
        color: [0x7A7168, 0x6B6560, 0x8A8078][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
      }));
      rock.scale.set(s * (0.9 + Math.random() * 0.3), s * 0.8, s * (0.9 + Math.random() * 0.3));
      rock.position.set(p.x + Math.cos(a) * d, s * 0.15 - 0.1, p.z + Math.sin(a) * d);
      rock.rotation.set(Math.random() * 0.5, Math.random() * Math.PI * 2, Math.random() * 0.3);
      scene.add(rock);
    }

    // Water — light sky blue, covers full rock-ring interior
    const waterR = p.r + 0.3;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(waterR, 48),
      new THREE.MeshBasicMaterial({
        color: 0x6BD4F0, transparent: true, opacity: 0.85,
      }),
    );
    water.position.set(p.x, WATER_Y, p.z);
    water.rotation.x = -Math.PI / 2;
    water.userData.baseY = WATER_Y;
    scene.add(water);
    waterMeshes.push(water);

    // Water sparkle — bright specular-like dots drifting on surface
    {
      const sparkCount = 20;
      const sparkGeo = new THREE.BufferGeometry();
      const sparkPos = new Float32Array(sparkCount * 3);
      for (let si = 0; si < sparkCount; si++) {
        const sa = Math.random() * Math.PI * 2, sd = Math.random() * (p.r - 0.5);
        sparkPos[si * 3]     = Math.cos(sa) * sd;
        sparkPos[si * 3 + 1] = 0.03;
        sparkPos[si * 3 + 2] = Math.sin(sa) * sd;
      }
      sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
      const sparkMat = new THREE.PointsMaterial({
        color: 0xFFFFFF, size: 0.08, transparent: true, opacity: 0.5,
        depthWrite: false, sizeAttenuation: true,
      });
      const sparkles = new THREE.Points(sparkGeo, sparkMat);
      sparkles.position.set(p.x, WATER_Y + 0.02, p.z);
      scene.add(sparkles);
      sparkleParticles.push({ mesh: sparkles, pool: p, count: sparkCount });
    }

    // (stick lanterns removed — stone lanterns in createOnsenProps)

    // Yuzu — detailed: yellow-orange sphere + green leaf on top
    const yuzuGroup = new THREE.Group();
    const yuzuBodyGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const yuzuLeafGeo = new THREE.SphereGeometry(0.05, 4, 3);
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      const a = Math.random() * Math.PI * 2, d = 0.5 + Math.random() * (p.r - 1.5);
      const sVar = 0.85 + Math.random() * 0.3;
      const yg = new THREE.Group();
      // Body
      const body = new THREE.Mesh(yuzuBodyGeo, new THREE.MeshToonMaterial({
        color: [0xF0A020, 0xF5C830, 0xE89020][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
      }));
      body.scale.set(sVar, sVar * 0.8, sVar);
      yg.add(body);
      // Leaf 1
      const leaf1 = new THREE.Mesh(yuzuLeafGeo, new THREE.MeshToonMaterial({ color: 0x4A8A30, gradientMap: toonGrad }));
      leaf1.position.set(0.02, sVar * 0.28, 0.02);
      leaf1.scale.set(1.2, 0.5, 0.8);
      yg.add(leaf1);
      // Leaf 2 (smaller, angled)
      const leaf2 = new THREE.Mesh(yuzuLeafGeo, new THREE.MeshToonMaterial({ color: 0x3A7A25, gradientMap: toonGrad }));
      leaf2.position.set(-0.04, sVar * 0.25, -0.02);
      leaf2.scale.set(0.8, 0.4, 0.6);
      leaf2.rotation.z = 0.3;
      yg.add(leaf2);
      yg.position.set(Math.cos(a) * d, 0.02, Math.sin(a) * d);
      yg.userData = { angle: a, dist: d, speed: 0.04 + Math.random() * 0.06, bobPhase: Math.random() * Math.PI * 2, spinSpeed: 0.1 + Math.random() * 0.15 };
      yuzuGroup.add(yg);
    }
    yuzuGroup.position.set(p.x, WATER_Y + 0.1, p.z);
    scene.add(yuzuGroup);
    yuzuGroups.push(yuzuGroup);
  });

  // ── Validation: every pool's water must cover its rock-ring interior ──
  POOL_DEFS.forEach((p, i) => {
    const waterR = p.r + 0.3;
    const floorR = p.r + 0.7;
    const rockInnerR = p.r - 0.75;  // conservative inner edge of rocks
    const ok = waterR >= rockInnerR && floorR > waterR;
    console.log(
      `[Pool ${i}] r=${p.r}  waterR=${waterR.toFixed(2)}  floorR=${floorR.toFixed(2)}  rockInner≈${rockInnerR.toFixed(2)}  ${ok ? '✓ PASS' : '✗ FAIL'}`,
    );
  });
}

// ─── TUB FACTORY (unified creation — upright gets water, tilted is dry) ───
function createTub(upright) {
  const tub = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.5, 8, 1, true),
    new THREE.MeshToonMaterial({ color: 0x6B5744, gradientMap: toonGrad }));
  body.position.y = 0.25; tub.add(body);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.38, 8),
    new THREE.MeshToonMaterial({ color: 0x5A4835, gradientMap: toonGrad }));
  bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0.02; tub.add(bottom);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.03, 4, 8),
    new THREE.MeshToonMaterial({ color: 0x8B7754, gradientMap: toonGrad }));
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.5; tub.add(rim);

  if (upright) {
    const tubWater = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 12),
      new THREE.MeshBasicMaterial({ color: 0x8FD3E8, transparent: true, opacity: 0.8 }),
    );
    tubWater.rotation.x = -Math.PI / 2;
    tubWater.position.y = 0.47;
    tub.add(tubWater);
    if (!window.__tubWaters) window.__tubWaters = [];
    window.__tubWaters.push(tubWater);
    tub.userData.hasWater = true;
  } else {
    tub.rotation.z = 0.15;
    tub.userData.hasWater = false;
  }
  tub.userData.isTub = true;
  return tub;
}

// ─── ONSEN VILLAGE PROPS ───
function createOnsenProps() {
  POOL_DEFS.forEach((p, pi) => {
    // Include vegetation placements in overlap check
    const placedProps = window.__vegPlaced ? [...window.__vegPlaced] : [];
    function tryPlace(x, z, r) {
      for (const pp of placedProps) {
        if (Math.hypot(x - pp.x, z - pp.z) < r + pp.r + 0.3) return false;
      }
      placedProps.push({ x, z, r });
      return true;
    }
    // === Traditional stone lanterns (6-part: 받침–기둥–중대석–화사석–지붕–구슬) ===
    for (let i = 0; i < 1 + (pi % 2); i++) {
      let a = (pi * 1.7 + i * 2.5) % (Math.PI * 2);
      const d = p.r + 1.8;
      let lx, lz, placed = false;
      // Try up to 6 angles to guarantee placement
      for (let attempt = 0; attempt < 6 && !placed; attempt++) {
        lx = p.x + Math.cos(a) * d; lz = p.z + Math.sin(a) * d;
        if (tryPlace(lx, lz, 0.55)) { placed = true; break; }
        a += Math.PI / 3; // rotate 60°
      }
      if (!placed) continue;

      const g = new THREE.Group();
      // Height budget: total ~4.2  (1.5× capybara 2.8)
      // 받침 15%=0.63, 기둥 30%=1.26, 중대석 8%=0.34, 화사석 25%=1.05, 지붕 17%=0.71, 구슬 5%=0.21
      const stoneColors = [0x7A7168, 0x6B6560, 0x8A8078];
      const stoneC = (idx) => stoneColors[idx % stoneColors.length];
      let y = 0;

      // 1. 받침돌 — low, wide natural stone
      const baseH = 0.63;
      const base = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.55, 0),
        new THREE.MeshToonMaterial({ color: stoneC(0), gradientMap: toonGrad }),
      );
      base.scale.set(1.0, baseH / 0.55 * 0.5, 1.0); // flatten
      base.position.y = baseH * 0.45;
      g.add(base);
      y = baseH;

      // 2. 기둥부 — 4 splayed legs
      const pillarH = 1.26;
      const legCount = 4;
      const legR = 0.08;
      for (let li = 0; li < legCount; li++) {
        const la = (li / legCount) * Math.PI * 2;
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(legR, legR * 1.3, pillarH, 5),
          new THREE.MeshToonMaterial({ color: stoneC(1), gradientMap: toonGrad }),
        );
        // Splay outward: bottom wider, top narrower
        const bottomOff = 0.22, topOff = 0.10;
        const bx = Math.cos(la) * bottomOff, bz = Math.sin(la) * bottomOff;
        const tx = Math.cos(la) * topOff, tz = Math.sin(la) * topOff;
        leg.position.set((bx + tx) / 2, y + pillarH / 2, (bz + tz) / 2);
        // Tilt each leg inward
        const tilt = Math.atan2(bottomOff - topOff, pillarH);
        leg.rotation.x = Math.sin(la) * tilt;
        leg.rotation.z = -Math.cos(la) * tilt;
        g.add(leg);
      }
      y += pillarH;

      // 3. 중대석 — trapezoid platform (wider at top)
      const midH = 0.34;
      const mid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.30, midH, 6),
        new THREE.MeshToonMaterial({ color: stoneC(2), gradientMap: toonGrad }),
      );
      mid.position.y = y + midH / 2;
      g.add(mid);
      y += midH;

      // 4. 화사석 — hexagonal fire chamber with glowing window slits
      const chamberH = 1.05;
      const chamberR = 0.35;
      const chamberSides = 6;
      // Outer stone shell
      const chamberShell = new THREE.Mesh(
        new THREE.CylinderGeometry(chamberR, chamberR, chamberH, chamberSides),
        new THREE.MeshToonMaterial({ color: stoneC(0), gradientMap: toonGrad }),
      );
      chamberShell.position.y = y + chamberH / 2;
      g.add(chamberShell);
      // Glowing window slits on each face — wide enough to read at game-camera distance
      const windowGroup = new THREE.Group();
      windowGroup.position.y = y + chamberH / 2;
      const faceW = 2 * chamberR * Math.sin(Math.PI / chamberSides); // face width
      const winW = faceW * 0.40, winH = chamberH * 0.60;
      const winGeo = new THREE.PlaneGeometry(winW, winH);
      for (let wi = 0; wi < chamberSides; wi++) {
        const wa = (wi / chamberSides) * Math.PI * 2 + Math.PI / chamberSides;
        const winMat = new THREE.MeshBasicMaterial({
          color: 0xC67652, side: THREE.DoubleSide,
        });
        const win = new THREE.Mesh(winGeo, winMat);
        const apothem = chamberR * Math.cos(Math.PI / chamberSides) + 0.01;
        win.position.set(Math.cos(wa) * apothem, 0, Math.sin(wa) * apothem);
        win.rotation.y = -wa + Math.PI / 2;
        windowGroup.add(win);
      }
      g.add(windowGroup);
      // Push chamber group ref for day/night control (windows + shell)
      lanternMeshes.push({ shell: chamberShell, windows: windowGroup, isLanternV2: true });
      y += chamberH;

      // 5. 지붕 — wide hexagonal roof with upturned eaves
      const roofH = 0.71;
      const roofR = 0.62; // wider than chamber for prominent silhouette
      // Main roof cone
      const roofGeo = new THREE.CylinderGeometry(0.08, roofR, roofH * 0.7, 6);
      const roof = new THREE.Mesh(roofGeo,
        new THREE.MeshToonMaterial({ color: 0x5A5550, gradientMap: toonGrad }));
      roof.position.y = y + roofH * 0.35;
      g.add(roof);
      // Eave lip — flared ring at roof bottom for upturn effect
      const eave = new THREE.Mesh(
        new THREE.TorusGeometry(roofR - 0.05, 0.05, 4, 6),
        new THREE.MeshToonMaterial({ color: 0x5A5550, gradientMap: toonGrad }),
      );
      eave.rotation.x = -Math.PI / 2;
      eave.position.y = y + 0.05;
      g.add(eave);
      y += roofH;

      // 6. 꼭대기 구슬
      const jewelR = 0.09;
      const jewel = new THREE.Mesh(
        new THREE.SphereGeometry(jewelR, 6, 4),
        new THREE.MeshToonMaterial({ color: stoneC(2), gradientMap: toonGrad }),
      );
      jewel.position.y = y + jewelR;
      g.add(jewel);

      // Point light at fire chamber center
      const light = new THREE.PointLight(0xC67652, 0.8, 7, 2);
      light.position.y = y - roofH - chamberH / 2; // center of chamber
      g.add(light);

      g.position.set(lx, getGroundHeight(lx, lz), lz);
      g.scale.setScalar(0.65); // scale down to ~1.0x capybara height visually
      // Enable shadow casting on key parts
      base.castShadow = true; chamberShell.castShadow = true; roof.castShadow = true;
      scene.add(g);
      obstacles.push({ x: lx, z: lz, r: 0.40 });
    }

    // === Wooden bath tubs (2 per pool) — factory ensures water on upright tubs ===
    {
      let wetTubPlaced = false;
      for (let i = 0; i < 2; i++) {
        let a = (pi * 2.1 + i * 3.0 + 1.0) % (Math.PI * 2);
        const td = p.r + 2.2;
        let tx, tz, tubOk = false;
        for (let att = 0; att < 8 && !tubOk; att++) {
          tx = p.x + Math.cos(a) * td; tz = p.z + Math.sin(a) * td;
          if (tryPlace(tx, tz, 0.45)) { tubOk = true; break; }
          a += Math.PI / 4;
        }
        if (!tubOk) continue;

        const tub = createTub(!wetTubPlaced); // upright+water or tilted+dry
        tub.position.set(tx, getGroundHeight(tx, tz), tz);
        scene.add(tub);
        obstacles.push({ x: tx, z: tz, r: 0.45 });
        if (!wetTubPlaced) wetTubPlaced = true;
      }
    }

    // === Wooden bench (1 per pool) ===
    {
      const a = (pi * 1.3 + 4.0) % (Math.PI * 2);
      const d = p.r + 2.5;
      const bx = p.x + Math.cos(a) * d, bz = p.z + Math.sin(a) * d;

      const bench = new THREE.Group();
      // Seat (flat box)
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.6),
        new THREE.MeshToonMaterial({ color: 0x6B5744, gradientMap: toonGrad }));
      seat.position.y = 0.45; bench.add(seat);
      // Legs (4)
      const legGeo = new THREE.BoxGeometry(0.08, 0.45, 0.08);
      const legMat = new THREE.MeshToonMaterial({ color: 0x5A4835, gradientMap: toonGrad });
      [[-0.7, -0.25], [-0.7, 0.25], [0.7, -0.25], [0.7, 0.25]].forEach(([lx2, lz2]) => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(lx2, 0.225, lz2);
        bench.add(leg);
      });

      seat.castShadow = true;
      if (tryPlace(bx, bz, 0.5)) {
        bench.position.set(bx, getGroundHeight(bx, bz), bz);
        bench.rotation.y = a + Math.PI / 2;
        scene.add(bench);
        obstacles.push({ x: bx, z: bz, r: 0.5 });
      }
    }

    // === Rubber ducks (1-2 per pool) — big, detailed ===
    for (let i = 0; i < 1 + (pi % 2); i++) {
      const da = Math.random() * Math.PI * 2;
      const dd = 0.8 + Math.random() * (p.r - 2.0);
      const duck = new THREE.Group();
      // Body — round, classic rubber duck
      const dBody = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6),
        new THREE.MeshToonMaterial({ color: 0xF0D040, gradientMap: toonGrad }));
      dBody.scale.set(1, 0.75, 1.3);
      duck.add(dBody);
      // Tail bump (raised back)
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.10, 5, 4),
        new THREE.MeshToonMaterial({ color: 0xF0D040, gradientMap: toonGrad }));
      tail.position.set(0, 0.10, -0.25);
      duck.add(tail);
      // Head — round
      const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 5),
        new THREE.MeshToonMaterial({ color: 0xF0D040, gradientMap: toonGrad }));
      dHead.position.set(0, 0.20, 0.22);
      duck.add(dHead);
      // Beak — flat orange wedge
      const beak = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.08),
        new THREE.MeshToonMaterial({ color: 0xE07020, gradientMap: toonGrad }));
      beak.position.set(0, 0.17, 0.37);
      duck.add(beak);
      // Eyes — tiny black dots
      const eyeGeo = new THREE.SphereGeometry(0.02, 4, 3);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
      eyeL.position.set(-0.08, 0.24, 0.30);
      duck.add(eyeL);
      const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
      eyeR.position.set(0.08, 0.24, 0.30);
      duck.add(eyeR);

      duck.position.set(
        p.x + Math.cos(da) * dd,
        WATER_Y + 0.05,
        p.z + Math.sin(da) * dd,
      );
      duck.userData = { angle: da, dist: dd, speed: 0.03 + Math.random() * 0.02, bobPhase: Math.random() * Math.PI * 2, tiltPhase: Math.random() * Math.PI * 2 };
      scene.add(duck);
      if (!window.__ducks) window.__ducks = [];
      window.__ducks.push({ mesh: duck, pool: p });
    }
  });
}

// ─── PROJECT SIGNS (low wooden nameplates, 1 per pool) ───
const _usedPools = new Set(); // track pool assignment to avoid duplicates
function createProjectSign(project, index) {
  const group = new THREE.Group();
  const [px, , pz] = project.position;

  // Find nearest UNASSIGNED pool
  let nearPool = null, nearDist = Infinity;
  for (const pool of POOL_DEFS) {
    const key = `${pool.x},${pool.z}`;
    if (_usedPools.has(key)) continue;
    const d = Math.hypot(px - pool.x, pz - pool.z);
    if (d < nearDist) { nearDist = d; nearPool = pool; }
  }
  if (!nearPool) { console.warn(`[SIGN] No pool for project ${project.name}`); return; }
  _usedPools.add(`${nearPool.x},${nearPool.z}`);

  // Low nameplate: single thick post + wide board at waist height
  const postH = 2.2; // waist-height sign post
  const boardW = 2.0, boardH = 0.8;

  // Post
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, postH, 6),
    new THREE.MeshToonMaterial({ color: 0x5A4030, gradientMap: toonGrad }),
  );
  post.position.y = postH / 2;
  group.add(post);

  // Board
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(boardW, boardH, 0.1),
    new THREE.MeshToonMaterial({ color: 0x6B5744, gradientMap: toonGrad }),
  );
  board.position.y = postH - boardH / 2 - 0.1;
  group.add(board);

  // Text — big, fills the board
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#6B5744'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(90,70,50,0.3)';
  for (let gy = 0; gy < 128; gy += 6) ctx.fillRect(0, gy, 256, 1);
  ctx.font = '64px "DungGeunMo", "Press Start 2P", monospace';
  ctx.fillStyle = '#F0EFE2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(project.shortName || project.name, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(boardW - 0.1, boardH - 0.1), new THREE.MeshBasicMaterial({ map: tex }));
  tp.position.set(0, postH - boardH / 2 - 0.1, 0.06); group.add(tp);
  const tb = tp.clone(); tb.rotation.y = Math.PI; tb.position.z = -0.06; group.add(tb);

  // Warm accent
  const accent = new THREE.PointLight(0xD4C8A0, 0.3, 4, 2);
  accent.position.y = postH - 0.5;
  group.add(accent);

  // Position at pool rim
  const dirX = px - nearPool.x, dirZ = pz - nearPool.z;
  const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
  const gx = nearPool.x + (dirX / dirLen) * (nearPool.r + 1.2);
  const gz = nearPool.z + (dirZ / dirLen) * (nearPool.r + 1.2);
  post.castShadow = true; board.castShadow = true;
  const signY = getGroundHeight(gx, gz);
  group.position.set(gx, signY, gz);
  group.lookAt(nearPool.x, signY, nearPool.z);
  group.userData = { project };
  scene.add(group); projectSigns.push(group);
  obstacles.push({ x: gx, z: gz, r: 0.3 });
}

// ─── STEAM ───
function createSteamSystem() {
  poolData.forEach(p => {
    const count = 30;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vels = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * (p.r - 0.5);
      pos[i * 3] = p.x + Math.cos(a) * d;
      pos[i * 3 + 1] = WATER_Y + 0.1 + Math.random() * 1.5;
      pos[i * 3 + 2] = p.z + Math.sin(a) * d;
      vels.push({ vy: 0.12 + Math.random() * 0.2, vx: (Math.random() - 0.5) * 0.03, vz: (Math.random() - 0.5) * 0.03, life: Math.random() });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const particles = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xF0E8D8, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.22, depthWrite: false,
    }));
    particles.userData = { velocities: vels, center: [p.x, p.z], count, radius: p.r };
    scene.add(particles); steamParticles.push(particles);
  });
}

// ─── EVENTS ───
function setupEvents() {
  const codeMap = { KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d', Space:'space', ArrowUp:'w', ArrowDown:'s', ArrowLeft:'a', ArrowRight:'d' };
  window.addEventListener('keydown', e => {
    const mapped = codeMap[e.code];
    if (mapped) { keys[mapped] = true; e.preventDefault(); }
  });
  // Mobile D-pad touch controls
  document.querySelectorAll('.dpad-btn').forEach(btn => {
    const dir = btn.dataset.dir;
    btn.addEventListener('touchstart', e => { e.preventDefault(); keys[dir] = true; }, { passive: false });
    btn.addEventListener('touchend', e => { e.preventDefault(); keys[dir] = false; }, { passive: false });
  });
  const jumpBtn = document.getElementById('mobile-jump');
  if (jumpBtn) {
    jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); keys['space'] = true; }, { passive: false });
    jumpBtn.addEventListener('touchend', () => { keys['space'] = false; });
  }
  // Tap on screen near gate = open project
  document.getElementById('scene').addEventListener('touchstart', e => {
    if (nearestProject && !detailOpen) showProjectDetail(nearestProject);
  });

  window.addEventListener('keyup', e => {
    const mapped = codeMap[e.code];
    if (mapped) { keys[mapped] = false; }
  });
  window.addEventListener('mousemove', e => { mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = (e.clientY / window.innerHeight) * 2 - 1; });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
  });
  window.addEventListener('click', e => {
    if (!started || detailOpen) return;
    if (e.target.closest('#top-nav') || e.target.closest('#left-hud')) return;
    if (nearestProject) showProjectDetail(nearestProject);
  });
  const cb = document.querySelector('.detail-close');
  if (cb) cb.addEventListener('click', closeProjectDetail);
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code === 'Escape' && (detailOpen || overlayOpen)) {
      if (detailOpen) closeProjectDetail();
      if (overlayOpen) { document.querySelectorAll('.page-overlay').forEach(o => o.classList.add('hidden')); overlayOpen = false; document.querySelector('.nav-link[data-page="explore"]').classList.add('active'); }
    }
    if (e.code === 'KeyC') toggleDebugColliders();
    if ((e.code === 'Enter' || e.code === 'KeyE') && nearestProject && !detailOpen && !overlayOpen) showProjectDetail(nearestProject);
  });
  // Nav tabs: WORKS / ABOUT overlays
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page = link.dataset.page;
      document.querySelectorAll('.page-overlay').forEach(o => o.classList.add('hidden'));
      if (page === 'works') {
        const wl = document.getElementById('works-list');
        wl.innerHTML = PROJECTS.map(p => `<div class="works-card"><h3>${p.name}</h3><p>${p.desc}</p><div class="detail-tags">${p.tags.map(t=>`<span class="detail-tag">${t}</span>`).join('')}</div>${p.link ? `<a href="${p.link}" target="_blank" rel="noopener" class="detail-link">Visit →</a>` : ''}</div>`).join('');
        document.getElementById('works-overlay').classList.remove('hidden');
        overlayOpen = true;
      } else if (page === 'about') {
        document.getElementById('about-overlay').classList.remove('hidden');
        overlayOpen = true;
      } else {
        // "explore" = close overlays
        overlayOpen = false;
      }
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
  document.querySelectorAll('.overlay-close').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.page-overlay').forEach(o => o.classList.add('hidden'));
      document.querySelector('.nav-link[data-page="explore"]').classList.add('active');
      overlayOpen = false;
    });
  });
}

function showProjectDetail(project) {
  detailOpen = true;
  // Stamp rally: mark as visited
  if (project.id) addStamp(project.id);
  const el = document.getElementById('project-detail');
  el.querySelector('.detail-title').textContent = project.name;
  el.querySelector('.detail-desc').textContent = project.desc;
  el.querySelector('.detail-tags').innerHTML = project.tags.map(t => `<span class="detail-tag">${t}</span>`).join('');
  // Visit link
  let linkEl = el.querySelector('.detail-link');
  if (!linkEl) { linkEl = document.createElement('a'); linkEl.className = 'detail-link'; el.appendChild(linkEl); }
  linkEl.href = project.link || '#';
  linkEl.target = '_blank';
  linkEl.rel = 'noopener';
  linkEl.textContent = 'Visit →';
  linkEl.style.display = project.link ? 'inline-block' : 'none';
  el.classList.remove('hidden');
}
function closeProjectDetail() { detailOpen = false; document.getElementById('project-detail').classList.add('hidden'); }

// ─── Pixel-art sun/moon icons (no system emoji) ───
function drawSunIcon(size) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const s = size / 16;
  ctx.fillStyle = '#F0D040';
  ctx.beginPath(); ctx.arc(8*s, 8*s, 4*s, 0, Math.PI*2); ctx.fill();
  // Rays (4 cardinal + 4 diagonal)
  ctx.fillRect(7*s, 1*s, 2*s, 2*s); ctx.fillRect(7*s, 13*s, 2*s, 2*s);
  ctx.fillRect(1*s, 7*s, 2*s, 2*s); ctx.fillRect(13*s, 7*s, 2*s, 2*s);
  ctx.fillRect(3*s, 3*s, 1*s, 1*s); ctx.fillRect(12*s, 3*s, 1*s, 1*s);
  ctx.fillRect(3*s, 12*s, 1*s, 1*s); ctx.fillRect(12*s, 12*s, 1*s, 1*s);
  return c;
}
function drawMoonIcon(size) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const s = size / 16;
  ctx.fillStyle = '#D5D3B8';
  ctx.beginPath(); ctx.arc(8*s, 8*s, 5*s, 0, Math.PI*2); ctx.fill();
  // Cut out for crescent
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(11*s, 7*s, 4*s, 0, Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

function setToggleIcon(btn, noon) {
  btn.innerHTML = '';
  const icon = noon ? drawSunIcon(24) : drawMoonIcon(24);
  icon.style.cssText = 'width:20px;height:20px;image-rendering:pixelated;';
  btn.appendChild(icon);
}

// ─── DAY/NIGHT TOGGLE ───
function setupDayNight() {
  const btn = document.getElementById('day-night-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    isNoon = !isNoon;
    setToggleIcon(btn, isNoon);
  });
  // Start as noon
  isNoon = true; dayNightT = 1;
  setToggleIcon(btn, true);
  applyDayNight(1); // apply noon immediately
}
function applyDayNight(t) {
  // t: 0=night, 1=noon
  scene.background.lerpColors(DAY.bg, NOON.bg, t);
  scene.fog.color.lerpColors(DAY.fog, NOON.fog, t);
  ambientLight.intensity = THREE.MathUtils.lerp(DAY.ambientI, NOON.ambientI, t);
  sunLight.intensity = THREE.MathUtils.lerp(DAY.sunI, NOON.sunI, t);
  // Sky gradient
  if (skyMesh) {
    const colors = skyMesh.geometry.attributes.color;
    for (let i = 0; i < colors.count; i++) {
      const y = skyMesh.geometry.attributes.position.getY(i);
      const st = Math.max(0, Math.min(1, (y + 5) / SKY_RADIUS));
      const topR = THREE.MathUtils.lerp(DAY.skyTop[0], NOON.skyTop[0], t) / 255;
      const topG = THREE.MathUtils.lerp(DAY.skyTop[1], NOON.skyTop[1], t) / 255;
      const topB = THREE.MathUtils.lerp(DAY.skyTop[2], NOON.skyTop[2], t) / 255;
      const botR = THREE.MathUtils.lerp(DAY.skyBot[0], NOON.skyBot[0], t) / 255;
      const botG = THREE.MathUtils.lerp(DAY.skyBot[1], NOON.skyBot[1], t) / 255;
      const botB = THREE.MathUtils.lerp(DAY.skyBot[2], NOON.skyBot[2], t) / 255;
      colors.setXYZ(i, botR + (topR-botR)*st, botG + (topG-botG)*st, botB + (topB-botB)*st);
    }
    colors.needsUpdate = true;
  }
  // God rays: dim in noon
  godRayMeshes.forEach(r => { r.material.opacity = THREE.MathUtils.lerp(0.015, 0.003, t); });
  // Lantern lights + chamber glow: bright at night, dim at noon
  lanternMeshes.forEach(l => {
    if (l.isLanternV2) {
      // V2: separate shell + window group
      const parent = l.shell.parent;
      if (!parent) return;
      const light = parent.children.find(c => c.isLight);
      if (light) light.intensity = THREE.MathUtils.lerp(1.5, 0.05, t);
      // Windows: warm glow at night, dark matte at noon
      l.windows.children.forEach(w => {
        w.material.color.setHex(t < 0.5 ? 0xC67652 : 0x4A4540);
      });
    } else {
      // Legacy fallback
      const parent = l.parent;
      if (!parent) return;
      const light = parent.children.find(c => c.isLight);
      if (light) light.intensity = THREE.MathUtils.lerp(1.5, 0.05, t);
      l.material.color.setHex(t < 0.5 ? 0xC67652 : 0x7A6A5A);
      l.material.opacity = 1.0;
    }
  });
}

// ─── DEBUG COLLIDERS ───
function toggleDebugColliders() {
  debugVisible = !debugVisible;
  if (!debugColliders) {
    debugColliders = new THREE.Group();
    const cylGeo = new THREE.CylinderGeometry(1, 1, 3, 12);
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.25, depthWrite: false });
    obstacles.forEach(obs => {
      const cyl = new THREE.Mesh(cylGeo, redMat);
      cyl.scale.set(obs.r, 1, obs.r);
      cyl.position.set(obs.x, 1.5, obs.z);
      debugColliders.add(cyl);
    });
    // Capybara radius indicator (blue)
    if (character) {
      const blueMat = new THREE.MeshBasicMaterial({ color: 0x3366ff, transparent: true, opacity: 0.3, depthWrite: false });
      const capyCyl = new THREE.Mesh(cylGeo, blueMat);
      capyCyl.scale.set(0.5, 1, 0.5);
      capyCyl.position.y = 1.5;
      character.group.add(capyCyl);
      debugColliders.userData = { capyCyl };
    }
    scene.add(debugColliders);
    console.log('[DEBUG] colliders visualized:', obstacles.length);
  }
  debugColliders.visible = debugVisible;
  if (debugColliders.userData?.capyCyl) debugColliders.userData.capyCyl.visible = debugVisible;
  console.log('[DEBUG] colliders', debugVisible ? 'ON' : 'OFF');
}

// ─── ANIMATE ───
let frameCount = 0, fpsTime = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), time = clock.getElapsedTime();
  if (started && !detailOpen && !overlayOpen && character) { character.update(dt, time, keys, cameraAngleX); updateCamera(dt); }
  // Day/night lerp
  const targetT = isNoon ? 1 : 0;
  if (Math.abs(dayNightT - targetT) > 0.001) { dayNightT += (targetT - dayNightT) * dt * 1.5; applyDayNight(dayNightT); }
  updateProximity(); updateSteam(dt, time); updateWater(dt, time); updateAnimations(time);
  composer.render();
  frameCount++; fpsTime += dt;
  if (fpsTime >= 0.5) { document.getElementById('fps-counter').textContent = `${Math.round(frameCount / fpsTime)} FPS`; frameCount = 0; fpsTime = 0; }
}

const _camTarget = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
function updateCamera(dt) {
  cameraAngleX += mouse.x * MOUSE_SENSITIVITY * 60 * dt;
  cameraAngleY = THREE.MathUtils.clamp(0.2 + mouse.y * 0.3, 0.05, 0.8);
  if (!character) return;
  const cp = character.position;
  _camTarget.set(
    cp.x + Math.sin(cameraAngleX) * CAMERA_DISTANCE,
    cp.y + CAMERA_HEIGHT + cameraAngleY * 4,
    cp.z + Math.cos(cameraAngleX) * CAMERA_DISTANCE,
  );
  // Keep camera above terrain
  const camGroundY = getGroundHeight(_camTarget.x, _camTarget.z);
  if (_camTarget.y < camGroundY + 2) _camTarget.y = camGroundY + 2;
  camera.position.lerp(_camTarget, CAMERA_LERP * dt);
  _camLookAt.set(cp.x, cp.y + 1.5, cp.z);
  camera.lookAt(_camLookAt);
}

const _signScale = new THREE.Vector3();
function updateProximity() {
  if (!character || detailOpen) return;
  let closest = null, closestDist = PROJECT_INTERACT_DIST;
  projectSigns.forEach(sign => {
    const dist = character.position.distanceTo(sign.position);
    if (dist < closestDist) { closestDist = dist; closest = sign.userData.project; }
    // Sign grows when close
    const near = dist < PROJECT_INTERACT_DIST;
    const targetScale = near ? 1.05 : 1.0;
    _signScale.set(targetScale, targetScale, targetScale);
    sign.scale.lerp(_signScale, 0.1);
  });
  nearestProject = closest;
  document.getElementById('proximity-hint').classList.toggle('hidden', !closest);
}

function updateSteam(dt, time) {
  steamParticles.forEach(particles => {
    const { velocities, center, count, radius } = particles.userData;
    const pos = particles.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      const v = velocities[i];
      pos.setX(i, pos.getX(i) + v.vx * dt + Math.sin(time * 0.5 + i) * 0.002);
      pos.setY(i, pos.getY(i) + v.vy * dt);
      pos.setZ(i, pos.getZ(i) + v.vz * dt + Math.cos(time * 0.5 + i) * 0.002);
      v.life += dt * 0.2;
      if (v.life > 1 || pos.getY(i) > 3) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * ((radius || 3) - 0.5);
        pos.setX(i, center[0] + Math.cos(a) * d); pos.setY(i, WATER_Y + 0.1); pos.setZ(i, center[1] + Math.sin(a) * d);
        v.life = 0; v.vy = 0.12 + Math.random() * 0.2;
      }
    }
    pos.needsUpdate = true;
  });
}

function updateWater(dt, time) {
  const off = Math.sin(time * 1.5) * 0.02;
  for (const w of waterMeshes) w.position.y = w.userData.baseY + off;
  yuzuGroups.forEach(group => { group.children.forEach(y => {
    const u = y.userData;
    u.angle += u.speed * 0.016;
    y.position.x = Math.cos(u.angle) * u.dist;
    y.position.z = Math.sin(u.angle) * u.dist;
    y.position.y = 0.02 + Math.sin(time * 1.8 + u.bobPhase) * 0.03;
    y.rotation.y += u.spinSpeed * 0.016; // slow spin
  }); });
  // Rubber duck bobbing
  if (window.__ducks) {
    window.__ducks.forEach(d => {
      const u = d.mesh.userData;
      u.angle += u.speed * 0.016;
      d.mesh.position.x = d.pool.x + Math.cos(u.angle) * u.dist;
      d.mesh.position.z = d.pool.z + Math.sin(u.angle) * u.dist;
      d.mesh.position.y = WATER_Y + 0.05 + Math.sin(time * 1.5 + u.bobPhase) * 0.03;
      d.mesh.rotation.y = u.angle + Math.PI / 2;
      d.mesh.rotation.z = Math.sin(time * 0.7 + (u.tiltPhase || 0)) * 0.08; // gentle tilt
    });
  }
  // Tub water ripple
  if (window.__tubWaters) {
    window.__tubWaters.forEach(tw => {
      tw.position.y = 0.4 + Math.sin(time * 2.5) * 0.008;
    });
  }

  // Pool submersion + head steam now handled in character.js
}

function updateAnimations(time) {
  // Lantern warm flicker — slow and subtle
  lanternMeshes.forEach((l, i) => {
    const parent = l.isLanternV2 ? l.shell.parent : l.parent;
    if (!parent) return;
    const light = parent.children.find(c => c.isLight);
    if (light) light.intensity = 0.6 + Math.sin(time * 1.5 + i * 2.3) * 0.2 + Math.sin(time * 3.7 + i) * 0.1;
  });

  // Vegetation sway — subtle wind
  swayMeshes.forEach(m => {
    const ph = m.userData.swayPhase || 0;
    m.rotation.z = Math.sin(time * 0.8 + ph) * 0.03;
    m.rotation.x = Math.sin(time * 0.6 + ph + 1.0) * 0.02;
  });

  // Water sparkle — drift + twinkle
  sparkleParticles.forEach(({ mesh, pool, count }) => {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      let x = pos.getX(i), z = pos.getZ(i);
      // Slow drift
      x += Math.sin(time * 0.3 + i * 1.7) * 0.004;
      z += Math.cos(time * 0.25 + i * 2.1) * 0.004;
      // Wrap within pool radius
      const d = Math.hypot(x, z);
      if (d > pool.r - 0.5) { x *= 0.1; z *= 0.1; }
      pos.setX(i, x); pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    // Twinkle opacity
    mesh.material.opacity = 0.3 + Math.sin(time * 2.0) * 0.2;
  });
}

// ─── RUNTIME AUDIT ───
window.auditOnsens = function () {
  const rows = [];
  POOL_DEFS.forEach((p, i) => {
    // Find matching project sign
    const sign = projectSigns.find(s => {
      const proj = s.userData.project;
      if (!proj) return false;
      // Sign placed near this pool?
      const d = Math.hypot(s.position.x - p.x, s.position.z - p.z);
      return d < p.r + 3;
    });
    const projName = sign ? sign.userData.project.name : '(none)';

    // Count component types in scene near this pool
    let waterCount = 0, floorCount = 0, rockCount = 0;
    let lanternCount = 0, yuzuCount = 0, duckCount = 0, tubCount = 0, benchCount = 0;
    let waterR = 0, waterY = 0;

    // Water meshes
    for (const w of waterMeshes) {
      if (Math.hypot(w.position.x - p.x, w.position.z - p.z) < 1) {
        waterCount++;
        waterR = w.geometry.parameters.radius || 0;
        waterY = w.position.y;
      }
    }

    // Floor: dark circle just below water
    scene.traverse(obj => {
      if (!obj.isMesh) return;
      const d = Math.hypot(obj.position.x - p.x, obj.position.z - p.z);
      if (d > p.r + 2) return;
      // Floor detection: CircleGeometry, dark, below water
      if (obj.geometry?.type === 'CircleGeometry' && obj.material?.color) {
        const c = obj.material.color.getHex();
        if (c < 0x303030 && obj.position.y < WATER_Y) floorCount++;
      }
    });

    // Lanterns
    for (const l of lanternMeshes) {
      const lm = l.isLanternV2 ? l.shell : l;
      const lp = lm.parent?.position;
      if (lp && Math.hypot(lp.x - p.x, lp.z - p.z) < p.r + 3) lanternCount++;
    }

    // Yuzu
    for (const yg of yuzuGroups) {
      if (Math.hypot(yg.position.x - p.x, yg.position.z - p.z) < 1) {
        yuzuCount = yg.children.length;
      }
    }

    // Ducks
    if (window.__ducks) {
      for (const d of window.__ducks) {
        if (d.pool === p || Math.hypot(d.pool.x - p.x, d.pool.z - p.z) < 1) duckCount++;
      }
    }

    // Sign
    const signCount = sign ? 1 : 0;

    const groundY = getGroundHeight(p.x, p.z);

    rows.push({
      pool: i,
      project: projName,
      water: waterCount > 0 ? '✓' : '✗',
      floor: floorCount > 0 ? '✓' : '✗',
      waterR: waterR.toFixed(1),
      ringInner: (p.r - 0.75).toFixed(1),
      waterY: waterY.toFixed(2),
      groundY: groundY.toFixed(2),
      lantern: lanternCount,
      yuzu: yuzuCount,
      duck: duckCount,
      sign: signCount,
      status: (waterCount > 0 && floorCount > 0 && lanternCount > 0 && yuzuCount >= 3 && duckCount >= 1 && signCount > 0) ? 'OK' : 'MISSING',
    });
  });
  console.table(rows);
  return rows;
};

// ─── PROP AUDIT (tubs) ───
window.auditProps = function () {
  const rows = [];
  scene.traverse(obj => {
    if (!obj.userData?.isTub) return;
    const tilted = Math.abs(obj.rotation.z) > 0.05;
    const hasWater = obj.userData.hasWater === true;
    rows.push({
      x: obj.position.x.toFixed(1),
      z: obj.position.z.toFixed(1),
      tilted: tilted ? 'yes' : 'no',
      water: hasWater ? '✓' : '✗',
      correct: (tilted && !hasWater) || (!tilted && hasWater) ? 'OK' : 'BUG',
    });
  });
  console.table(rows);
  const bugs = rows.filter(r => r.correct === 'BUG');
  console.log(`[AUDIT] ${rows.length} tubs, ${bugs.length} bugs`);
  return rows;
};

init();
