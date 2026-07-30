import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCharacter } from './character.js';
import { PROJECTS as PROJECT_DATA } from './projects.js';
import { addStamp, initStampBoard, hasStamp, getStampCount, getTotalCount } from './stamps.js';

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

const SIGN_WOOD = 0x6B5744; // Wooden sign board base color
const MOVE_SPEED = 8, JUMP_FORCE = 12, GRAVITY = -30;
const CAMERA_DISTANCE = 11, CAMERA_HEIGHT = 5.5, MOUSE_SENSITIVITY = 0.003;
const PROJECT_INTERACT_DIST = 8, PIXEL_SIZE = 1;

// ─── POOL DEFINITIONS (shared between ground & pool creation) ───
const POOL_DEFS = [
  { x: 6, z: 0, r: 4.5 }, { x: -8, z: -6, r: 3.5 },
  { x: -4, z: 10, r: 3 }, { x: 14, z: -20, r: 3 },
];
const POOL_DEPTH = 0.7;
const WATER_Y = -0.15;

// ─── PROJECTS ───
const PROJECTS = PROJECT_DATA.map(p => ({ ...p, desc: p.description, color: P.bright }));

// ─── STATE ───
const keys = {};
const mouse = { x: 0, y: 0 };
let cameraAngleX = 0, cameraAngleY = 0.3;
let nearestProject = null, detailOpen = false, started = true;
let clock, scene, camera, renderer, composer;
let character = null; // character controller from character.js
let projectSigns = [], steamParticles = [], waterMeshes = [], lanternMeshes = [];
let yuzuGroups = [], poolData = [];
let obstacles = []; // {x, z, r} for collision
let godRayMeshes = [];
let debugColliders = null, debugVisible = false;

// ─── DAY/NIGHT ───
let isNoon = true, dayNightT = 1; // t: 0=night, 1=noon
const DAY = {
  bg: new THREE.Color(0x0A0D0B), fog: new THREE.Color(0x2A4050),
  ambientI: 2.2, sunI: 1.2, skyTop: [0x2A,0x48,0x58], skyBot: [0x5A,0x8A,0x98],
};
const NOON = {
  bg: new THREE.Color(0x2A3A28), fog: new THREE.Color(0x88BBAA),
  ambientI: 4.0, sunI: 2.5, skyTop: [0x55,0x99,0xDD], skyBot: [0xAA,0xDD,0xF0],
};
let ambientLight, sunLight, skyMesh;

// ─── INIT ───
function init() {
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(P.darkest);
  scene.fog = new THREE.Fog(0x2A4050, 30, 75); // Lighter teal fog

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
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
    setupEvents(); setupDayNight(); initStampBoard(); animate();
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
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
  sun.shadow.camera.left = -35; sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35; sun.shadow.camera.bottom = -35;
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
}

// ─── SKY (barely visible through canopy) ───
function createSky() {
  const skyGeo = new THREE.SphereGeometry(85, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  // Vertex color gradient: brighter at horizon, darker at zenith
  const colors = new Float32Array(skyGeo.attributes.position.count * 3);
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const y = skyGeo.attributes.position.getY(i);
    const t = Math.max(0, Math.min(1, (y + 5) / 85)); // 0 at horizon, 1 at top
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

// ─── GROUND HEIGHT HELPER ───
function getGroundHeight(wx, wz) {
  let h = Math.sin(wx * 0.08) * Math.cos(wz * 0.08) * 0.4 + Math.sin(wx * 0.2 + wz * 0.15) * 0.2;
  for (const p of POOL_DEFS) {
    const dist = Math.hypot(wx - p.x, wz - p.z);
    if (dist < p.r + 0.5) {
      const t = Math.max(0, 1 - dist / (p.r + 0.3));
      h = Math.min(h, -POOL_DEPTH * Math.pow(t, 0.5));
    }
  }
  return h;
}

// ─── GROUND (deep green grass + moss) ───
function createGround() {
  const geo = new THREE.PlaneGeometry(120, 120, 100, 100);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    // Base terrain noise
    let z = Math.sin(x * 0.08) * Math.cos(y * 0.08) * 0.4 + Math.sin(x * 0.2 + y * 0.15) * 0.2;
    // Depress pool areas
    for (const p of POOL_DEFS) {
      const dist = Math.hypot(x - p.x, y - p.z);
      if (dist < p.r + 0.5) {
        const t = Math.max(0, 1 - dist / (p.r + 0.3));
        z = Math.min(z, -POOL_DEPTH * Math.pow(t, 0.5));
      }
    }
    pos.setZ(i, z);
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
  tex.repeat.set(50, 50); tex.generateMipmaps = false;

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
      blob.position.set(x + (Math.random()-0.5)*baseS*0.6, cs*0.3, z + (Math.random()-0.5)*baseS*0.6);
      scene.add(blob);
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
    patch.position.set(x, s * 0.05, z);
    scene.add(patch);
  }

  // 3. Boulders — warm gray, with collision
  for (let i = 0; i < 15; i++) {
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
    rock.position.set(x, s * 0.3, z);
    rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.5);
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
    wall.position.set(x, s * 0.4, z);
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

  // Mossy rocks scattered
  for (let i = 0; i < 25; i++) {
    const r = 3 + Math.random() * 40;
    const a = Math.random() * Math.PI * 2;
    const s = 0.3 + Math.random() * 1;
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshToonMaterial({
      color: [0x6B6560, 0x7A7168, 0x5E5850][Math.floor(Math.random() * 3)],
      gradientMap: toonGrad,
    }));
    rock.scale.setScalar(s);
    const rx = Math.cos(a) * r, rz = Math.sin(a) * r;
    // Skip if inside onsen area
    let inPool = false;
    for (const pool of POOL_DEFS) { if (Math.hypot(rx - pool.x, rz - pool.z) < pool.r + 1) { inPool = true; break; } }
    if (inPool) continue;
    rock.position.set(rx, s * 0.25, rz);
    rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.5);
    scene.add(rock);
    if (s > 0.7) obstacles.push({ x: rx, z: rz, r: s * 0.6 }); // big rock collision
  }

  // Bush clusters (small sphere groups on ground)
  const bushGeo = new THREE.SphereGeometry(1, 5, 4);
  for (let i = 0; i < 40; i++) {
    const r = 2 + Math.random() * 45;
    const a = Math.random() * Math.PI * 2;
    const s = 0.4 + Math.random() * 0.8;
    const bush = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({
      color: [P.midDark, P.dark, P.midCool, P.midDark][Math.floor(Math.random() * 4)],
      gradientMap: toonGrad,
    }));
    bush.scale.set(s, s * 0.6, s);
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    // Skip if inside onsen area
    let inPool = false;
    for (const pool of POOL_DEFS) { if (Math.hypot(bx - pool.x, bz - pool.z) < pool.r + 1) { inPool = true; break; } }
    if (inPool) continue;
    bush.position.set(bx, s * 0.2, bz);
    scene.add(bush);
  }
}

// ─── ONSEN POOLS (forest clearing) ───
function createOnsenPools() {
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);

  POOL_DEFS.forEach(p => {
    poolData.push(p);

    // Pool floor (dark bottom visible through water)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(p.r, 24),
      new THREE.MeshBasicMaterial({ color: P.dark }),
    );
    floor.position.set(p.x, WATER_Y - 0.15, p.z); // below water surface
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

    // Water — light sky blue, sits inside the depression
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(p.r - 0.2, 24),
      new THREE.MeshBasicMaterial({
        color: 0x6BD4F0, transparent: true, opacity: 0.85,
      }),
    );
    water.position.set(p.x, WATER_Y, p.z);
    water.rotation.x = -Math.PI / 2;
    water.userData.baseY = WATER_Y;
    scene.add(water);
    waterMeshes.push(water);

    // (stick lanterns removed — stone lanterns in createOnsenProps)

    // Yuzu — detailed: yellow-orange sphere + green leaf on top
    const yuzuGroup = new THREE.Group();
    const yuzuBodyGeo = new THREE.SphereGeometry(0.35, 8, 6);
    const yuzuLeafGeo = new THREE.SphereGeometry(0.08, 4, 3);
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
    // === Stone lanterns (1-2 per pool, replace stick lanterns) ===
    for (let i = 0; i < 1 + (pi % 2); i++) {
      const a = (pi * 1.7 + i * 2.5) % (Math.PI * 2);
      const d = p.r + 1.8;
      const lx = p.x + Math.cos(a) * d, lz = p.z + Math.sin(a) * d;

      const g = new THREE.Group();
      // Base (square-ish)
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.6),
        new THREE.MeshToonMaterial({ color: 0x5a5a52, gradientMap: toonGrad }));
      base.position.y = 0.125; g.add(base);
      // Pillar
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.2, 6),
        new THREE.MeshToonMaterial({ color: 0x6a6a62, gradientMap: toonGrad }));
      pillar.position.y = 0.85; g.add(pillar);
      // Light chamber (wider box with warm color)
      const chamber = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5),
        new THREE.MeshBasicMaterial({ color: P.warm, transparent: true, opacity: 0.85 }));
      chamber.position.y = 1.65; g.add(chamber);
      lanternMeshes.push(chamber);
      // Roof
      const roof = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.5),
        new THREE.MeshToonMaterial({ color: 0x4a4a42, gradientMap: toonGrad }));
      roof.position.y = 1.85; g.add(roof);
      // Warm point light
      const light = new THREE.PointLight(0xC67652, 0.8, 7, 2);
      light.position.y = 1.65; g.add(light);

      if (!tryPlace(lx, lz, 0.4)) continue;
      g.position.set(lx, 0, lz);
      scene.add(g);
      obstacles.push({ x: lx, z: lz, r: 0.4 });
    }

    // === Wooden bath tubs (2 per pool) ===
    for (let i = 0; i < 2; i++) {
      const a = (pi * 2.1 + i * 3.0 + 1.0) % (Math.PI * 2);
      const d = p.r + 2.2;
      const tx = p.x + Math.cos(a) * d, tz = p.z + Math.sin(a) * d;

      const tub = new THREE.Group();
      // Tub body (cylinder, open top)
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.5, 8, 1, true),
        new THREE.MeshToonMaterial({ color: 0x6B5744, gradientMap: toonGrad }));
      body.position.y = 0.25; tub.add(body);
      // Bottom
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.38, 8),
        new THREE.MeshToonMaterial({ color: 0x5A4835, gradientMap: toonGrad }));
      bottom.rotation.x = -Math.PI / 2; bottom.position.y = 0.02; tub.add(bottom);
      // Rim (lighter band)
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.03, 4, 8),
        new THREE.MeshToonMaterial({ color: 0x8B7754, gradientMap: toonGrad }));
      rim.rotation.x = -Math.PI / 2; rim.position.y = 0.5; tub.add(rim);

      if (!tryPlace(tx, tz, 0.45)) continue;
      tub.position.set(tx, 0, tz);
      // Water inside upright tub
      if (i === 0) {
        const tubWater = new THREE.Mesh(
          new THREE.CircleGeometry(0.34, 12),
          new THREE.MeshBasicMaterial({ color: 0x8FD3E8, transparent: true, opacity: 0.8 }),
        );
        tubWater.rotation.x = -Math.PI / 2;
        tubWater.position.y = 0.47; // just below rim at 0.5
        tub.add(tubWater);
        if (!window.__tubWaters) window.__tubWaters = [];
        window.__tubWaters.push(tubWater);
      }
      // Tilt one slightly
      if (i === 1) tub.rotation.z = 0.15;
      scene.add(tub);
      obstacles.push({ x: tx, z: tz, r: 0.45 });
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

      if (tryPlace(bx, bz, 0.5)) {
        bench.position.set(bx, 0, bz);
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
      const dBody = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6),
        new THREE.MeshToonMaterial({ color: 0xF0D040, gradientMap: toonGrad }));
      dBody.scale.set(1, 0.75, 1.3);
      duck.add(dBody);
      // Tail bump (raised back)
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.15, 5, 4),
        new THREE.MeshToonMaterial({ color: 0xF0D040, gradientMap: toonGrad }));
      tail.position.set(0, 0.15, -0.35);
      duck.add(tail);
      // Head — round
      const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 5),
        new THREE.MeshToonMaterial({ color: 0xF0D040, gradientMap: toonGrad }));
      dHead.position.set(0, 0.28, 0.3);
      duck.add(dHead);
      // Beak — flat orange wedge
      const beak = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.12),
        new THREE.MeshToonMaterial({ color: 0xE07020, gradientMap: toonGrad }));
      beak.position.set(0, 0.24, 0.52);
      duck.add(beak);
      // Eyes — tiny black dots
      const eyeGeo = new THREE.SphereGeometry(0.03, 4, 3);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
      eyeL.position.set(-0.12, 0.34, 0.42);
      duck.add(eyeL);
      const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
      eyeR.position.set(0.12, 0.34, 0.42);
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

// ─── PROJECT SIGNS (onsen gates) ───
function createProjectSign(project, index) {
  const group = new THREE.Group();
  const [px, , pz] = project.position;
  const gateH = 3.5, gateW = 2.8;

  // Two wooden pillars
  const pillarGeo = new THREE.CylinderGeometry(0.12, 0.15, gateH, 6);
  const pillarMat = new THREE.MeshToonMaterial({ color: 0x5A4030, gradientMap: toonGrad });
  const pillarL = new THREE.Mesh(pillarGeo, pillarMat);
  pillarL.position.set(-gateW / 2, gateH / 2, 0);
  group.add(pillarL);
  const pillarR = new THREE.Mesh(pillarGeo, pillarMat);
  pillarR.position.set(gateW / 2, gateH / 2, 0);
  group.add(pillarR);

  // Horizontal beam (crossbar)
  const beamGeo = new THREE.BoxGeometry(gateW + 0.5, 0.2, 0.2);
  const beam = new THREE.Mesh(beamGeo, pillarMat);
  beam.position.y = gateH - 0.3;
  group.add(beam);

  // Hanging wooden sign (nameplate)
  const boardW = 2.2, boardH = 0.9;
  const boardGeo = new THREE.BoxGeometry(boardW, boardH, 0.08);
  const board = new THREE.Mesh(boardGeo, new THREE.MeshToonMaterial({ color: 0x6B5744, gradientMap: toonGrad }));
  board.position.y = gateH - 1.2;
  group.add(board);

  // Text on board
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#6B5744'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(90,70,50,0.3)';
  for (let gy = 0; gy < 128; gy += 6) ctx.fillRect(0, gy, 256, 1);
  ctx.font = '72px "DungGeunMo", "Press Start 2P", monospace';
  ctx.fillStyle = '#F0EFE2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(project.name, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(boardW - 0.1, boardH - 0.1), new THREE.MeshBasicMaterial({ map: tex }));
  tp.position.set(0, gateH - 1.2, 0.05); group.add(tp);
  const tb = tp.clone(); tb.rotation.y = Math.PI; tb.position.z = -0.05; group.add(tb);

  // Subtle warm accent light
  const signAccent = new THREE.PointLight(0xD4C8A0, 0.4, 5, 2);
  signAccent.position.y = gateH - 1;
  group.add(signAccent);

  // Move gate closer to nearest pool
  let nearPool = POOL_DEFS[0];
  let nearDist = Infinity;
  for (const pool of POOL_DEFS) {
    const d = Math.hypot(px - pool.x, pz - pool.z);
    if (d < nearDist) { nearDist = d; nearPool = pool; }
  }
  const dirX = px - nearPool.x, dirZ = pz - nearPool.z;
  const dirLen = Math.sqrt(dirX*dirX + dirZ*dirZ) || 1;
  const gx = nearPool.x + (dirX/dirLen) * (nearPool.r + 1.5);
  const gz = nearPool.z + (dirZ/dirLen) * (nearPool.r + 1.5);
  group.position.set(gx, 0, gz);
  group.lookAt(0, 0, 0); group.rotation.y += Math.PI;
  group.userData = { project };
  scene.add(group); projectSigns.push(group);
  // Colliders for both pillars
  const sinA = Math.sin(group.rotation.y), cosA = Math.cos(group.rotation.y);
  obstacles.push({ x: gx - sinA * gateW/2, z: gz - cosA * gateW/2, r: 0.3 });
  obstacles.push({ x: gx + sinA * gateW/2, z: gz + cosA * gateW/2, r: 0.3 });
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
      color: 0xF0E8D8, size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0.12, depthWrite: false,
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
    if (e.code === 'Escape' && detailOpen) closeProjectDetail();
    if (e.code === 'KeyC') toggleDebugColliders();
    if ((e.code === 'Enter' || e.code === 'KeyE') && nearestProject && !detailOpen) showProjectDetail(nearestProject);
  });
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active')); link.classList.add('active'); });
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
  el.classList.remove('hidden');
}
function closeProjectDetail() { detailOpen = false; document.getElementById('project-detail').classList.add('hidden'); }

// ─── DAY/NIGHT TOGGLE ───
function setupDayNight() {
  const btn = document.getElementById('day-night-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    isNoon = !isNoon;
    btn.textContent = isNoon ? '☀' : '☾';
  });
  // Start as noon
  isNoon = true; dayNightT = 1;
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
      const st = Math.max(0, Math.min(1, (y + 5) / 85));
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
    const parent = l.parent;
    if (!parent) return;
    const light = parent.children.find(c => c.isLight);
    if (light) light.intensity = THREE.MathUtils.lerp(1.5, 0.05, t);
    // Chamber color: warm at night, muted at noon. Always opaque.
    l.material.color.setHex(t < 0.5 ? 0xC67652 : 0x7A6A5A);
    l.material.opacity = 1.0;
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
  if (started && !detailOpen && character) { character.update(dt, time, keys, cameraAngleX); updateCamera(dt); }
  // Day/night lerp
  const targetT = isNoon ? 1 : 0;
  if (Math.abs(dayNightT - targetT) > 0.001) { dayNightT += (targetT - dayNightT) * dt * 1.5; applyDayNight(dayNightT); }
  updateProximity(); updateSteam(dt, time); updateWater(dt, time); updateAnimations(time);
  composer.render();
  frameCount++; fpsTime += dt;
  if (fpsTime >= 0.5) { document.getElementById('fps-counter').textContent = `${Math.round(frameCount / fpsTime)} FPS`; frameCount = 0; fpsTime = 0; }
}

function updateCamera(dt) {
  cameraAngleX += mouse.x * MOUSE_SENSITIVITY * 60 * dt;
  cameraAngleY = THREE.MathUtils.clamp(0.2 + mouse.y * 0.3, 0.05, 0.8);
  if (!character) return;
  const t = character.position.clone();
  const target = new THREE.Vector3(
    t.x + Math.sin(cameraAngleX) * CAMERA_DISTANCE,
    t.y + CAMERA_HEIGHT + cameraAngleY * 4,
    t.z + Math.cos(cameraAngleX) * CAMERA_DISTANCE,
  );
  camera.position.lerp(target, 3.5 * dt); // softer follow (was 6)
  camera.lookAt(t.x, t.y + 1.5, t.z);
}

function updateProximity() {
  if (!character || detailOpen) return;
  let closest = null, closestDist = PROJECT_INTERACT_DIST;
  projectSigns.forEach(sign => {
    const dist = character.position.distanceTo(sign.position);
    if (dist < closestDist) { closestDist = dist; closest = sign.userData.project; }
    // Sign grows when close
    const near = dist < PROJECT_INTERACT_DIST;
    const targetScale = near ? 1.05 : 1.0;
    sign.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
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
    const parent = l.parent;
    if (!parent) return;
    const light = parent.children.find(c => c.isLight);
    if (light) light.intensity = 0.6 + Math.sin(time * 1.5 + i * 2.3) * 0.2 + Math.sin(time * 3.7 + i) * 0.1;
  });
}

init();
