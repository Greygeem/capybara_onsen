import * as THREE from 'three';

const MOVE_SPEED = 8, JUMP_FORCE = 12, GRAVITY = -30, CAPY_R = 0.5;
const ACCEL_TIME = 0.12, DECEL_TIME = 0.15; // acceleration/deceleration seconds

function loadPixelTexture(path) {
  const loader = new THREE.TextureLoader();
  return new Promise(resolve => {
    loader.load(path, tex => {
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
      resolve(tex);
    }, undefined, () => {
      const c = document.createElement('canvas'); c.width = 16; c.height = 16;
      const x = c.getContext('2d'); x.fillStyle = '#B8862D'; x.fillRect(2, 2, 12, 12);
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
      resolve(t);
    });
  });
}

export async function createCharacter(scene, config) {
  const { obstacles, poolData, getGroundHeight, WATER_Y, creamColor, camera } = config;

  // ── Textures + canvas cleanup pipeline ──
  const frontTex = await loadPixelTexture('/assets/capybara.png');
  const backTex  = await loadPixelTexture('/assets/capybara-back.png');

  function cleanTexture(tex) {
    const img = tex.image;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    const w = c.width, h = c.height;
    // Pass 1: quantize alpha (< 200 → 0, >= 200 → 255)
    for (let i = 0; i < d.length; i += 4) {
      d[i+3] = d[i+3] < 200 ? 0 : 255;
    }
    // Pass 2+3: edge-erode dark outline pixels (2 rounds)
    for (let round = 0; round < 2; round++) {
      const copy = new Uint8ClampedArray(d);
      for (let y = 1; y < h-1; y++) {
        for (let x = 1; x < w-1; x++) {
          const idx = (y*w+x)*4;
          if (copy[idx+3] === 0) continue;
          const bright = (copy[idx]+copy[idx+1]+copy[idx+2])/3;
          if (bright > 80) continue; // not dark
          // Check if adjacent to transparent
          let touchesAlpha = false;
          for (const [dy,dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const ni = ((y+dy)*w+(x+dx))*4;
            if (copy[ni+3] === 0) { touchesAlpha = true; break; }
          }
          if (touchesAlpha) d[idx+3] = 0; // erase dark edge pixel
        }
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  // Clean both textures
  frontTex.image = cleanTexture(frontTex);
  frontTex.needsUpdate = true;
  backTex.image = cleanTexture(backTex);
  backTex.needsUpdate = true;

  // Hardcode eyes on cleaned front
  {
    const c = frontTex.image;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#111111';
    ctx.fillRect(68, 100, 73, 10);
    ctx.fillRect(212, 100, 52, 10);
    ctx.fillRect(80, 102, 50, 6);
    ctx.fillRect(220, 102, 38, 6);
    frontTex.needsUpdate = true;
  }

  console.log('[CHARACTER] textures cleaned + eyes hardcoded');
  console.log('[CHARACTER] colliders:', obstacles.length);

  // ── Sprite ──
  const mat = new THREE.SpriteMaterial({
    map: frontTex, transparent: false, alphaTest: 0.5, fog: false,
    opacity: 1, depthWrite: true, depthTest: true, blending: THREE.NormalBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  const H = 2.8, W = H * (frontTex.image.width / frontTex.image.height || 1.14);
  sprite.scale.set(W, H, 1);
  sprite.position.y = H / 2 + 0.1;

  // ── Group ──
  const group = new THREE.Group();
  group.add(sprite);

  // Blob shadow — large, visible, dark green-black
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 16),
    new THREE.MeshBasicMaterial({ color: 0x0A1A0A, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.renderOrder = 1;
  group.add(shadow);

  // Head steam (onsen only)
  const STEAM_COUNT = 15;
  const steamGeo = new THREE.BufferGeometry();
  const steamPos = new Float32Array(STEAM_COUNT * 3);
  const steamVels = [];
  for (let i = 0; i < STEAM_COUNT; i++) {
    steamPos[i * 3] = (Math.random() - 0.5) * 0.6;
    steamPos[i * 3 + 1] = H + Math.random() * 0.5;
    steamPos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    steamVels.push({ vy: 0.4 + Math.random() * 0.4, life: Math.random() });
  }
  steamGeo.setAttribute('position', new THREE.BufferAttribute(steamPos, 3));
  const steam = new THREE.Points(steamGeo, new THREE.PointsMaterial({
    color: creamColor, size: 0.15, transparent: true, opacity: 0.18, depthWrite: false, sizeAttenuation: true,
  }));
  steam.visible = false;
  group.add(steam);

  // ── Speech bubble (HTML overlay) ──
  const bubbleEl = document.createElement('div');
  bubbleEl.id = 'speech-bubble';
  bubbleEl.style.cssText = 'position:fixed;pointer-events:none;z-index:20;font-family:"DungGeunMo","Press Start 2P",monospace;font-size:12px;color:#192717;background:#F4F3DD;padding:6px 12px;border-radius:6px;opacity:0;transition:opacity 0.3s;white-space:nowrap;transform:translate(-50%,-100%);';
  document.body.appendChild(bubbleEl);

  const LINES = {
    idle: ["ugh, do I have to walk?", "5 more min...", "I could nap here", "*yawn*", "don't rush me"],
    walk: ["so far...", "my legs are tiny, ok?", "are we there yet"],
    enterPool: ["finally.", "this is the life", "ahh~", "perfection"],
    exitPool: ["why did I leave", "cold...", "I want back in"],
    jump: ["wheee (not impressed)", "unnecessary effort"],
    stamp: ["one down. (already tired)", "collecting stamps now?", "halfway. impressive, I guess", "one more. you got this. (I don't care)", "oh great, now I have everything. (yawn)"],
  };
  let lastLine = '', bubbleTimer = 0, bubbleCooldown = 0, wasInOnsen = false;

  function showBubble(category) {
    if (bubbleCooldown > 0) return;
    const options = LINES[category].filter(l => l !== lastLine);
    const line = options[Math.floor(Math.random() * options.length)];
    lastLine = line;
    bubbleEl.textContent = line;
    bubbleEl.style.opacity = '1';
    bubbleTimer = 3.5;
    bubbleCooldown = 6;
  }

  scene.add(group);

  // ── State ──
  let facing = 'front'; // 'front' | 'back'
  let velocityY = 0, isGrounded = true;
  let inOnsen = false, moving = false;
  let speed = 0; // current speed (0 to MOVE_SPEED) for acceleration
  let inputDir = new THREE.Vector3(); // desired direction
  // Spawn animation: drop from above
  group.position.y = 6;
  velocityY = 0;

  // ── Update ──
  function update(dt, time, keys, cameraAngleX) {
    // ─ a. Input → direction ─
    const forward = new THREE.Vector3(-Math.sin(cameraAngleX), 0, -Math.cos(cameraAngleX));
    const right = new THREE.Vector3();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    inputDir.set(0, 0, 0);
    moving = false;
    if (keys['w']) { inputDir.add(forward); moving = true; }
    if (keys['s']) { inputDir.sub(forward); moving = true; }
    if (keys['a']) { inputDir.sub(right); moving = true; }
    if (keys['d']) { inputDir.add(right); moving = true; }
    if (inputDir.lengthSq() > 0) inputDir.normalize();

    // Acceleration / deceleration
    if (moving) {
      speed = Math.min(MOVE_SPEED, speed + (MOVE_SPEED / ACCEL_TIME) * dt);
    } else {
      speed = Math.max(0, speed - (MOVE_SPEED / DECEL_TIME) * dt);
    }

    if (speed > 0.01) {
      const moveVec = inputDir.clone().multiplyScalar(speed * dt);
      group.position.add(moveVec);
    }

    // ─ b. Collision ─
    for (const obs of obstacles) {
      const dx = group.position.x - obs.x;
      const dz = group.position.z - obs.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = CAPY_R + obs.r;
      if (dist < minDist && dist > 0.001) {
        const nx = dx / dist, nz = dz / dist;
        group.position.x = obs.x + nx * minDist;
        group.position.z = obs.z + nz * minDist;
        console.log('[COLLIDE]', obs.x.toFixed(1), obs.z.toFixed(1), 'r=' + obs.r.toFixed(2));
      }
    }

    // ─ c. Gravity + ground ─
    if (keys['space'] && isGrounded) { velocityY = JUMP_FORCE; isGrounded = false; }
    velocityY += GRAVITY * dt;
    group.position.y += velocityY * dt;
    const groundY = getGroundHeight(group.position.x, group.position.z);
    if (group.position.y <= groundY) {
      group.position.y = groundY;
      velocityY = 0; isGrounded = true;
    }
    const lim = 50;
    group.position.x = Math.max(-lim, Math.min(lim, group.position.x));
    group.position.z = Math.max(-lim, Math.min(lim, group.position.z));

    // Shadow scales with jump height
    const heightAboveGround = group.position.y - groundY;
    const shadowScale = Math.max(0.3, 1 - heightAboveGround * 0.1);
    shadow.scale.set(shadowScale, shadowScale, 1);
    shadow.position.y = groundY - group.position.y + 0.02;

    // ─ d. Facing: front in onsen always, back when moving otherwise ─
    if (inOnsen) {
      facing = 'front'; // always face camera in onsen (cute!)
    } else if (moving) {
      const onlyS = keys['s'] && !keys['w'] && !keys['a'] && !keys['d'];
      facing = onlyS ? 'front' : 'back';
    }

    // ─ e. Texture swap ─
    const wantTex = facing === 'front' ? frontTex : backTex;
    if (sprite.material.map !== wantTex) {
      sprite.material.map = wantTex;
      sprite.material.needsUpdate = true;
    }

    // Bounce animation
    const baseY = H / 2 + 0.1;
    sprite.position.y = (speed > 0.5 && isGrounded) ? baseY + Math.abs(Math.sin(time * 12)) * 0.18 : baseY;

    // ─ f. Onsen ─
    inOnsen = false;
    for (const p of poolData) {
      if (Math.hypot(group.position.x - p.x, group.position.z - p.z) < p.r - 0.5) {
        inOnsen = true;
        sprite.position.y = WATER_Y - group.position.y + H * 0.15;
        if (!moving && facing === 'front') { facing = 'back'; sprite.material.map = backTex; sprite.material.needsUpdate = true; }
        break;
      }
    }

    // Head steam
    if (inOnsen) {
      steam.visible = true;
      const sPos = steam.geometry.attributes.position;
      for (let i = 0; i < STEAM_COUNT; i++) {
        const v = steamVels[i];
        sPos.setY(i, sPos.getY(i) + v.vy * dt);
        sPos.setX(i, sPos.getX(i) + Math.sin(time * 0.8 + i * 2) * 0.003);
        v.life += dt * 0.25;
        if (v.life > 1 || sPos.getY(i) > H + 1.5) {
          sPos.setX(i, (Math.random() - 0.5) * 0.6);
          sPos.setY(i, sprite.position.y + H * 0.45);
          sPos.setZ(i, (Math.random() - 0.5) * 0.4);
          v.life = 0; v.vy = 0.4 + Math.random() * 0.4;
        }
      }
      sPos.needsUpdate = true;
    } else {
      steam.visible = false;
    }

    // ── Speech bubble updates ──
    bubbleCooldown = Math.max(0, bubbleCooldown - dt);
    if (bubbleTimer > 0) {
      bubbleTimer -= dt;
      if (bubbleTimer <= 0.3) bubbleEl.style.opacity = String(bubbleTimer / 0.3);
      if (bubbleTimer <= 0) { bubbleEl.style.opacity = '0'; }
      // Position bubble above head in screen space
      const headWorld = new THREE.Vector3();
      group.getWorldPosition(headWorld);
      headWorld.y += H + 0.5;
      headWorld.project(config.camera);
      const sx = (headWorld.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-headWorld.y * 0.5 + 0.5) * window.innerHeight;
      bubbleEl.style.left = sx + 'px';
      bubbleEl.style.top = sy + 'px';
    }
    // Triggers
    if (!moving && speed < 0.1 && !inOnsen && Math.random() < dt * 0.05) showBubble('idle');
    if (moving && speed > 3 && Math.random() < dt * 0.03) showBubble('walk');
    if (inOnsen && !wasInOnsen) showBubble('enterPool');
    if (!inOnsen && wasInOnsen) showBubble('exitPool');
    wasInOnsen = inOnsen;
    // Listen for stamp events
    if (!window.__stampListener) {
      window.__stampListener = true;
      window.addEventListener('stamp-added', () => showBubble('stamp'));
    }
  }

  return {
    group,
    update,
    get position() { return group.position; },
    get isMoving() { return moving; },
    get inOnsen() { return inOnsen; },
    get facing() { return facing; },
    get speed() { return speed; },
  };
}
