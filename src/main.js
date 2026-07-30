import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
const PROJECT_INTERACT_DIST = 8, PIXEL_SIZE = 4;

// ─── POOL DEFINITIONS (shared between ground & pool creation) ───
const POOL_DEFS = [
  { x: 6, z: 0, r: 4.5 }, { x: -8, z: -6, r: 3.5 },
  { x: -4, z: 10, r: 3 }, { x: 14, z: -20, r: 3 },
];
const POOL_DEPTH = 0.7;
const WATER_Y = -0.15;

// ─── PROJECTS ───
const PROJECTS = [
  { name: 'NEUN', desc: 'AI-powered insurance news aggregation platform.', tags: ['AI','MCP','News'], position: [18, 0, -14], color: P.bright },
  { name: 'IBANJIHA', desc: 'Telegram bot for community management.', tags: ['Telegram','Bot','Node.js'], position: [-16, 0, -18], color: P.sky },
  { name: 'JOBLOCK', desc: 'Web3 jobs platform with blockchain-verified credentials.', tags: ['Web3','Supabase','Next.js'], position: [22, 0, 14], color: P.warm },
  { name: 'POREVER', desc: 'Interactive bubble tea ordering experience.', tags: ['React','Animation','UX'], position: [-20, 0, 16], color: P.hilight },
  { name: 'PROJ 05', desc: 'Coming soon.', tags: ['TBD'], position: [0, 0, -28], color: P.midCool },
  { name: 'PROJ 06', desc: 'Coming soon.', tags: ['TBD'], position: [0, 0, 28], color: P.brightPale },
];

// ─── STATE ───
const keys = {};
const mouse = { x: 0, y: 0 };
let cameraAngleX = 0, cameraAngleY = 0.3;
let velocityY = 0, isGrounded = true;
let nearestProject = null, detailOpen = false, started = true;
let clock, scene, camera, renderer, composer;
let capybara, capybaraSprite, capybaraSteam, capybaraSteamVels = [];
let capybaraFrontTex, capybaraBackTex, capybaraSideTex;
let currentDir = 'front'; // 'front' | 'back' | 'side'
let projectSigns = [], steamParticles = [], waterMeshes = [], lanternMeshes = [];
let yuzuGroups = [], poolData = [];
let obstacles = []; // {x, z, r} for collision
let godRayMeshes = [];
let isMoving = false, facingRight = true;

// ─── INIT ───
function init() {
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(P.darkest);
  scene.fog = new THREE.Fog(P.dark, 25, 70); // Linear fog for depth

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  composer = new EffectComposer(renderer);
  const px = new RenderPixelatedPass(PIXEL_SIZE, scene, camera);
  px.normalEdgeStrength = 0; px.depthEdgeStrength = 0.15;
  composer.addPass(px);
  composer.addPass(new OutputPass());

  buildScene().then(() => {
    setupEvents(); animate();
    // Debug: expose toggle for god rays and teleport
    window.__toggleRays = (v) => godRayMeshes.forEach(r => r.visible = v);
    window.__teleport = (x, z) => { if (capybara) { capybara.position.set(x, 0, z); } };
    window.__obstacles = obstacles;
    console.log('[COLLISION] obstacles registered:', obstacles.length);
  });
}

// ─── TEXTURE HELPERS ───
function loadPixelTexture(path) {
  const loader = new THREE.TextureLoader();
  return new Promise(resolve => {
    loader.load(path, tex => {
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
      resolve(tex);
    }, undefined, () => {
      const c = document.createElement('canvas'); c.width = 16; c.height = 16;
      const x = c.getContext('2d'); x.fillStyle = '#B8862D'; x.fillRect(2,2,12,12);
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      resolve(t);
    });
  });
}

// ─── BUILD SCENE ───
async function buildScene() {
  // === LIGHTING: soft forest (for toon shading steps) ===
  scene.add(new THREE.AmbientLight(P.midDark, 2.2));
  scene.add(new THREE.HemisphereLight(P.hilight, P.dark, 0.6));
  const sun = new THREE.DirectionalLight(P.hilight, 1.2);
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
  await createCapybara();
  PROJECTS.forEach((p, i) => createProjectSign(p, i));
  createUndergrowth();
  createSteamSystem();
}

// ─── SKY (barely visible through canopy) ───
function createSky() {
  const skyGeo = new THREE.SphereGeometry(85, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const skyMat = new THREE.MeshBasicMaterial({ color: P.sky, side: THREE.BackSide });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.y = -5;
  scene.add(sky);
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
  cx.fillStyle = '#192717'; cx.fillRect(0, 0, 64, 64);
  const grassCols = ['#192717', '#1a2a18', '#162514', '#1e2e1a', '#142010', '#203218'];
  for (let y = 0; y < 64; y += 4) {
    for (let x = 0; x < 64; x += 4) {
      cx.fillStyle = grassCols[Math.floor(Math.random() * grassCols.length)];
      cx.fillRect(x, y, 4, 4);
    }
  }
  // Occasional brighter moss spot
  for (let i = 0; i < 15; i++) {
    cx.fillStyle = '#294C15';
    cx.fillRect(Math.random() * 60 | 0, Math.random() * 60 | 0, 4, 4);
  }
  const tex = new THREE.CanvasTexture(tc);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30); tex.generateMipmaps = false;

  const ground = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
    map: tex, color: 0x88aa88, gradientMap: toonGrad,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

// ─── VEGETATION (low forest floor — no tall trees) ───
function createVegetation() {
  const bushGeo = new THREE.SphereGeometry(1, 5, 4);
  const fernGeo = new THREE.ConeGeometry(0.5, 1, 4);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const grassGeo = new THREE.CylinderGeometry(0.02, 0.06, 1, 4);

  const greenCols = [P.midDark, P.midCool, P.bright, P.dark, 0x3D6A2A, 0x4A7535];

  // Helper: check if position is clear (away from pools, signs, start)
  function isClear(x, z, minDist) {
    if (Math.hypot(x, z) < 5) return false; // start area clearance
    for (const p of POOL_DEFS) { if (Math.hypot(x - p.x, z - p.z) < p.r + 2) return false; }
    for (const pr of PROJECTS) { if (Math.hypot(x - pr.position[0], z - pr.position[2]) < 4) return false; }
    return true;
  }

  // 1. Large ferns — tall, conical, capybara-height
  for (let i = 0; i < 35; i++) {
    const r = 4 + Math.random() * 35;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isClear(x, z, 2)) continue;
    const h = 1.5 + Math.random() * 2;
    const fern = new THREE.Mesh(fernGeo, new THREE.MeshToonMaterial({
      color: greenCols[Math.floor(Math.random() * greenCols.length)], gradientMap: toonGrad,
    }));
    fern.scale.set(0.8 + Math.random() * 0.6, h, 0.8 + Math.random() * 0.6);
    fern.position.set(x, h * 0.5, z);
    fern.rotation.y = Math.random() * Math.PI;
    scene.add(fern);
  }

  // 2. Low dense bushes — lots of them for floor coverage
  for (let i = 0; i < 80; i++) {
    const r = 2 + Math.random() * 40;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isClear(x, z, 1.5)) continue;
    const s = 0.4 + Math.random() * 0.8;
    const bush = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({
      color: greenCols[Math.floor(Math.random() * greenCols.length)], gradientMap: toonGrad,
    }));
    bush.scale.set(s, s * 0.5, s);
    bush.position.set(x, s * 0.15, z);
    scene.add(bush);
  }

  // 3. Wide-leaf shrubs — bigger, act as soft barriers
  for (let i = 0; i < 25; i++) {
    const r = 5 + Math.random() * 30;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isClear(x, z, 2.5)) continue;
    const s = 1.0 + Math.random() * 0.8;
    const shrub = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({
      color: [P.midDark, P.midCool, P.bright][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
    }));
    shrub.scale.set(s * 1.3, s * 0.7, s * 1.3);
    shrub.position.set(x, s * 0.25, z);
    scene.add(shrub);
    if (s > 1.2) obstacles.push({ x, z, r: s * 0.6 }); // big shrub collision
  }

  // 4. Tall grass clumps — vertical accents
  for (let i = 0; i < 60; i++) {
    const r = 3 + Math.random() * 35;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isClear(x, z, 1)) continue;
    const clusterSize = 3 + Math.floor(Math.random() * 5);
    for (let j = 0; j < clusterSize; j++) {
      const h = 0.8 + Math.random() * 1.5;
      const blade = new THREE.Mesh(grassGeo, new THREE.MeshToonMaterial({
        color: [P.bright, P.midCool, P.brightPale][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
      }));
      blade.position.set(
        x + (Math.random() - 0.5) * 0.5,
        h * 0.5,
        z + (Math.random() - 0.5) * 0.5,
      );
      blade.rotation.set((Math.random() - 0.5) * 0.3, Math.random() * Math.PI, (Math.random() - 0.5) * 0.2);
      scene.add(blade);
    }
  }

  // 5. Mossy boulders — scattered, some with collision
  for (let i = 0; i < 20; i++) {
    const r = 5 + Math.random() * 30;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isClear(x, z, 2)) continue;
    const s = 0.6 + Math.random() * 1.2;
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshToonMaterial({
      color: [P.midWarm, 0x3a3a35, P.midCool][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
    }));
    rock.scale.setScalar(s);
    rock.position.set(x, s * 0.3, z);
    rock.rotation.set(Math.random(), Math.random() * Math.PI, Math.random() * 0.5);
    scene.add(rock);
    if (s > 0.9) obstacles.push({ x, z, r: s * 0.5 }); // big rock collision
  }

  // 6. Edge wall — dense ring of tall bushes at boundary to block view of empty space
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
    const dist = 38 + Math.random() * 8;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    const s = 1.5 + Math.random() * 1.5;
    const wall = new THREE.Mesh(bushGeo, new THREE.MeshToonMaterial({
      color: [P.dark, P.midDark, P.midCool][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
    }));
    wall.scale.set(s * 1.5, s, s * 1.5);
    wall.position.set(x, s * 0.4, z);
    scene.add(wall);
    obstacles.push({ x, z, r: s * 0.8 }); // boundary collision
  }
}

// ─── GOD RAYS (light beams through canopy) ───
function createGodRays() {
  const rayGeo = new THREE.CylinderGeometry(0.3, 1.5, 18, 6, 1, true);
  const rayMat = new THREE.MeshBasicMaterial({
    color: P.hilight, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false,
  });

  const rayPositions = [
    [5, -3], [-7, 5], [12, 8], [-4, -12], [8, 12], [-10, -2], [0, 8],
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
      color: [P.midWarm, 0x3a3a35, P.midCool][Math.floor(Math.random() * 3)],
      gradientMap: toonGrad,
    }));
    rock.scale.setScalar(s);
    const rx = Math.cos(a) * r, rz = Math.sin(a) * r;
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
    bush.position.set(Math.cos(a) * r, s * 0.2, Math.sin(a) * r);
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
    floor.position.set(p.x, -POOL_DEPTH + 0.02, p.z);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Border rocks — bigger, at pool rim to cover edge
    const rc = Math.floor(p.r * 6);
    for (let i = 0; i < rc; i++) {
      const a = (i / rc) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const d = p.r + (Math.random() - 0.5) * 0.5;
      const s = 0.5 + Math.random() * 0.5;
      const rock = new THREE.Mesh(rockGeo, new THREE.MeshToonMaterial({
        color: [P.midWarm, 0x3a3a35, 0x4a4840][Math.floor(Math.random() * 3)], gradientMap: toonGrad,
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
        color: 0x8FD3E8, transparent: true, opacity: 0.8,
      }),
    );
    water.position.set(p.x, WATER_Y, p.z);
    water.rotation.x = -Math.PI / 2;
    water.userData.baseY = WATER_Y;
    scene.add(water);
    waterMeshes.push(water);

    // Warm lantern beside pool
    const la = Math.random() * Math.PI * 2;
    createWarmLantern(p.x + Math.cos(la) * (p.r + 1.2), p.z + Math.sin(la) * (p.r + 1.2));

    // Yuzu — orange-yellow pixel circles floating on water
    const yuzuGroup = new THREE.Group();
    const yuzuColors = [0xE89040, 0xE8B040, 0xD8A030, 0xF0C050];
    const yuzuGeo = new THREE.SphereGeometry(0.15, 6, 4);
    for (let i = 0; i < 5 + Math.floor(Math.random() * 4); i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * (p.r - 0.8);
      const yuzu = new THREE.Mesh(yuzuGeo, new THREE.MeshBasicMaterial({
        color: yuzuColors[Math.floor(Math.random() * yuzuColors.length)],
      }));
      yuzu.position.set(Math.cos(a) * d, 0.06, Math.sin(a) * d);
      yuzu.scale.set(1, 0.5, 1);
      yuzu.userData = { angle: a, dist: d, speed: 0.06 + Math.random() * 0.08, bobPhase: Math.random() * Math.PI * 2 };
      yuzuGroup.add(yuzu);
    }
    yuzuGroup.position.set(p.x, WATER_Y + 0.06, p.z);
    scene.add(yuzuGroup);
    yuzuGroups.push(yuzuGroup);
  });
}

function createWarmLantern(x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 4),
    new THREE.MeshToonMaterial({ color: 0x3a2a1a, gradientMap: toonGrad }));
  pole.position.y = 0.9; g.add(pole);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.4, 6),
    new THREE.MeshBasicMaterial({ color: P.warm, transparent: true, opacity: 0.9 }));
  lantern.position.y = 2; g.add(lantern); lanternMeshes.push(lantern);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.15, 6),
    new THREE.MeshToonMaterial({ color: 0x3a2a1a, gradientMap: toonGrad }));
  cap.position.y = 2.25; g.add(cap);
  g.position.set(x, 0, z); scene.add(g);
}

// ─── CAPYBARA ───
async function createCapybara() {
  capybaraFrontTex = await loadPixelTexture('/assets/capybara.png');
  capybaraBackTex = await loadPixelTexture('/assets/capybara-back.png');
  capybaraSideTex = await loadPixelTexture('/assets/capybara-side.png');
  const mat = new THREE.SpriteMaterial({
    map: capybaraFrontTex,
    transparent: false,
    alphaTest: 0.5,
    fog: false,
    opacity: 1.0,
    depthWrite: true,
    depthTest: true,
    blending: THREE.NormalBlending,
  });
  capybaraSprite = new THREE.Sprite(mat);
  capybaraSprite.renderOrder = 10; // render after god rays
  const h = 2.8, w = h * (mat.map.image.width / mat.map.image.height || 1.14);
  capybaraSprite.scale.set(w, h, 1);
  capybaraSprite.position.y = h / 2 + 0.1;
  capybara = new THREE.Group();
  capybara.add(capybaraSprite);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 8),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; capybara.add(shadow);

  // Head steam (visible only when in pool)
  const steamCount = 15;
  const steamGeo = new THREE.BufferGeometry();
  const steamPos = new Float32Array(steamCount * 3);
  capybaraSteamVels = [];
  for (let i = 0; i < steamCount; i++) {
    steamPos[i * 3] = (Math.random() - 0.5) * 0.6;
    steamPos[i * 3 + 1] = h + Math.random() * 0.5;
    steamPos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    capybaraSteamVels.push({ vy: 0.4 + Math.random() * 0.4, life: Math.random() });
  }
  steamGeo.setAttribute('position', new THREE.BufferAttribute(steamPos, 3));
  capybaraSteam = new THREE.Points(steamGeo, new THREE.PointsMaterial({
    color: P.cream, size: 0.12, transparent: true, opacity: 0.18, depthWrite: false, sizeAttenuation: true,
  }));
  capybaraSteam.visible = false;
  capybara.add(capybaraSteam);

  scene.add(capybara);
}

// ─── PROJECT SIGNS ───
function createProjectSign(project, index) {
  const group = new THREE.Group();
  const [px, , pz] = project.position;
  const signH = 4, boardW = 6, boardH = 3;

  const postMat = new THREE.MeshToonMaterial({ color: 0x3a2a1a, gradientMap: toonGrad });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, signH + boardH / 2, 6), postMat);
  post.position.y = (signH + boardH / 2) / 2; group.add(post);

  const signGeo = new THREE.BoxGeometry(boardW, boardH, 0.12);
  const signBoard = new THREE.Mesh(signGeo, new THREE.MeshToonMaterial({ color: SIGN_WOOD, gradientMap: toonGrad }));
  signBoard.position.y = signH; group.add(signBoard);
  const border = new THREE.LineSegments(new THREE.EdgesGeometry(signGeo), new THREE.LineBasicMaterial({ color: 0x4A3A2E }));
  border.position.y = signH; group.add(border);

  // Text
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#6B5744'; ctx.fillRect(0, 0, 512, 256);
  // Wood grain texture effect
  ctx.fillStyle = 'rgba(90, 70, 50, 0.3)';
  for (let gy = 0; gy < 256; gy += 8) { ctx.fillRect(0, gy, 512, 2); }
  const hex = '#' + new THREE.Color(P.cream).getHexString();
  ctx.font = '120px "DungGeunMo", "Press Start 2P", monospace';
  ctx.fillStyle = hex; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(project.name, 256, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(boardW - 0.2, boardH - 0.2), new THREE.MeshBasicMaterial({ map: tex }));
  tp.position.set(0, signH, 0.08); group.add(tp);
  const tb = tp.clone(); tb.rotation.y = Math.PI; tb.position.z = -0.08; group.add(tb);

  group.position.set(px, 0, pz);
  group.lookAt(0, 0, 0); group.rotation.y += Math.PI;
  group.userData = { project };
  scene.add(group); projectSigns.push(group);
  obstacles.push({ x: px, z: pz, r: 0.5 }); // sign post collision
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
      color: P.cream, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.1, depthWrite: false,
    }));
    particles.userData = { velocities: vels, center: [p.x, p.z], count, radius: p.r };
    scene.add(particles); steamParticles.push(particles);
  });
}

// ─── EVENTS ───
function setupEvents() {
  window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') { e.preventDefault(); keys['space'] = true; }
    if (e.key === 'ArrowUp') keys['w'] = true; if (e.key === 'ArrowDown') keys['s'] = true;
    if (e.key === 'ArrowLeft') keys['a'] = true; if (e.key === 'ArrowRight') keys['d'] = true;
  });
  window.addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
    if (e.key === ' ') keys['space'] = false;
    if (e.key === 'ArrowUp') keys['w'] = false; if (e.key === 'ArrowDown') keys['s'] = false;
    if (e.key === 'ArrowLeft') keys['a'] = false; if (e.key === 'ArrowRight') keys['d'] = false;
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
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && detailOpen) closeProjectDetail(); });
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => { e.preventDefault(); document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active')); link.classList.add('active'); });
  });
}

function showProjectDetail(project) {
  detailOpen = true;
  const el = document.getElementById('project-detail');
  el.querySelector('.detail-title').textContent = project.name;
  el.querySelector('.detail-desc').textContent = project.desc;
  el.querySelector('.detail-tags').innerHTML = project.tags.map(t => `<span class="detail-tag">${t}</span>`).join('');
  el.classList.remove('hidden');
}
function closeProjectDetail() { detailOpen = false; document.getElementById('project-detail').classList.add('hidden'); }

// ─── ANIMATE ───
let frameCount = 0, fpsTime = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05), time = clock.getElapsedTime();
  if (started && !detailOpen) { updateMovement(dt, time); updateCamera(dt); }
  updateProximity(); updateSteam(dt, time); updateWater(dt, time); updateAnimations(time);
  composer.render();
  frameCount++; fpsTime += dt;
  if (fpsTime >= 0.5) { document.getElementById('fps-counter').textContent = `${Math.round(frameCount / fpsTime)} FPS`; frameCount = 0; fpsTime = 0; }
}

function updateMovement(dt, time) {
  if (!capybara) return;
  const forward = new THREE.Vector3(-Math.sin(cameraAngleX), 0, -Math.cos(cameraAngleX));
  const right = new THREE.Vector3(); right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const moveDir = new THREE.Vector3(); isMoving = false;
  const movingFwd = keys['w'], movingBack = keys['s'];
  const movingSide = keys['a'] || keys['d'];
  if (keys['w']) { moveDir.add(forward); isMoving = true; } if (keys['s']) { moveDir.sub(forward); isMoving = true; }
  if (keys['a']) { moveDir.sub(right); isMoving = true; } if (keys['d']) { moveDir.add(right); isMoving = true; }
  if (moveDir.lengthSq() > 0) {
    moveDir.normalize().multiplyScalar(MOVE_SPEED * dt);
    capybara.position.add(moveDir);
    if (Math.abs(moveDir.dot(right)) > 0.01) facingRight = moveDir.dot(right) > 0;
  }
  // Sliding collision — runs EVERY frame, even when idle (prevents stuck-inside)
  const CAPY_R = 0.5;
  for (const obs of obstacles) {
    const dx = capybara.position.x - obs.x;
    const dz = capybara.position.z - obs.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = CAPY_R + obs.r;
    if (dist < minDist && dist > 0.001) {
      const nx = dx / dist, nz = dz / dist;
      capybara.position.x = obs.x + nx * minDist;
      capybara.position.z = obs.z + nz * minDist;
      console.log('[COLLIDE]', obs.x.toFixed(1), obs.z.toFixed(1), 'r='+obs.r.toFixed(2));
    }
  }

  // 4-direction sprite: front / back / side. Persists last direction when idle.
  if (capybaraSprite && capybaraFrontTex && capybaraBackTex && capybaraSideTex) {
    let inPool = false;
    for (const p of poolData) {
      if (Math.hypot(capybara.position.x - p.x, capybara.position.z - p.z) < p.r - 0.5) {
        inPool = true; break;
      }
    }

    let newDir = currentDir; // persist by default
    if (isMoving) {
      // Determine dominant direction from raw key input
      const rawFwd = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
      const rawRight = (keys['d'] ? 1 : 0) - (keys['a'] ? 1 : 0);
      if (Math.abs(rawRight) > Math.abs(rawFwd)) {
        newDir = 'side';
        facingRight = rawRight > 0;
      } else if (rawFwd < 0) {
        newDir = 'front'; // S key = toward camera
      } else {
        newDir = 'back'; // W key = away from camera
      }
    } else if (inPool) {
      newDir = 'back';
    }
    // else: keep currentDir (no auto-return to front)

    if (newDir !== currentDir) {
      const tex = newDir === 'front' ? capybaraFrontTex : newDir === 'back' ? capybaraBackTex : capybaraSideTex;
      capybaraSprite.material.map = tex;
      capybaraSprite.material.needsUpdate = true;
      currentDir = newDir;
    }
    const sw = Math.abs(capybaraSprite.scale.x);
    capybaraSprite.scale.x = facingRight ? -sw : sw;
  }

  if (capybaraSprite) { const baseY = capybaraSprite.scale.y / 2 + 0.1; capybaraSprite.position.y = isMoving && isGrounded ? baseY + Math.abs(Math.sin(time * 12)) * 0.18 : baseY; }
  if (keys['space'] && isGrounded) { velocityY = JUMP_FORCE; isGrounded = false; }
  velocityY += GRAVITY * dt; capybara.position.y += velocityY * dt;
  const groundY = getGroundHeight(capybara.position.x, capybara.position.z);
  if (capybara.position.y <= groundY) { capybara.position.y = groundY; velocityY = 0; isGrounded = true; }
  const lim = 50; capybara.position.x = Math.max(-lim, Math.min(lim, capybara.position.x)); capybara.position.z = Math.max(-lim, Math.min(lim, capybara.position.z));
}

function updateCamera(dt) {
  cameraAngleX += mouse.x * MOUSE_SENSITIVITY * 60 * dt;
  cameraAngleY = THREE.MathUtils.clamp(0.2 + mouse.y * 0.3, 0.05, 0.8);
  const t = capybara.position.clone();
  camera.position.lerp(new THREE.Vector3(t.x + Math.sin(cameraAngleX) * CAMERA_DISTANCE, t.y + CAMERA_HEIGHT + cameraAngleY * 4, t.z + Math.cos(cameraAngleX) * CAMERA_DISTANCE), 6 * dt);
  camera.lookAt(t.x, t.y + 1.5, t.z);
}

function updateProximity() {
  if (!capybara || detailOpen) return;
  let closest = null, closestDist = PROJECT_INTERACT_DIST;
  projectSigns.forEach(sign => {
    const dist = capybara.position.distanceTo(sign.position);
    if (dist < closestDist) { closestDist = dist; closest = sign.userData.project; }
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
    y.userData.angle += y.userData.speed * 0.016;
    y.position.x = Math.cos(y.userData.angle) * y.userData.dist;
    y.position.z = Math.sin(y.userData.angle) * y.userData.dist;
    y.position.y = 0.04 + Math.sin(time * 2 + y.userData.bobPhase) * 0.02;
  }); });

  // Pool submersion + head steam
  if (capybara && capybaraSprite) {
    let inPool = false;
    for (const p of poolData) {
      if (Math.hypot(capybara.position.x - p.x, capybara.position.z - p.z) < p.r - 0.5) {
        inPool = true; break;
      }
    }
    if (inPool) {
      // Lower sprite so water covers lower 35%
      capybaraSprite.position.y = WATER_Y - capybara.position.y + capybaraSprite.scale.y * 0.15;
      // Head steam
      if (capybaraSteam) {
        capybaraSteam.visible = true;
        const sPos = capybaraSteam.geometry.attributes.position;
        for (let i = 0; i < capybaraSteamVels.length; i++) {
          const v = capybaraSteamVels[i];
          sPos.setY(i, sPos.getY(i) + v.vy * dt);
          sPos.setX(i, sPos.getX(i) + Math.sin(time * 0.8 + i * 2) * 0.003);
          v.life += dt * 0.25;
          if (v.life > 1 || sPos.getY(i) > capybaraSprite.scale.y + 1.5) {
            sPos.setX(i, (Math.random() - 0.5) * 0.6);
            sPos.setY(i, capybaraSprite.position.y + capybaraSprite.scale.y * 0.45);
            sPos.setZ(i, (Math.random() - 0.5) * 0.4);
            v.life = 0; v.vy = 0.4 + Math.random() * 0.4;
          }
        }
        sPos.needsUpdate = true;
      }
    } else {
      if (capybaraSteam) capybaraSteam.visible = false;
    }
  }
}

function updateAnimations(time) {
  // Lanterns: no emissive pulsing — flat toon look
}

init();
