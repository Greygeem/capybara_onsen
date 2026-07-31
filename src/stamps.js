import { PROJECTS } from './projects.js';

const STORAGE_KEY = 'capybara-onsen-stamps';
const stamps = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));

export function hasStamp(id) { return stamps.has(id); }
export function getStampCount() { return stamps.size; }
export function getTotalCount() { return PROJECTS.length; }
export function isComplete() { return stamps.size >= PROJECTS.length; }

export function addStamp(id) {
  if (stamps.has(id)) return false;
  stamps.add(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...stamps]));
  renderStampBoard();
  showStampAnimation(id);
  window.dispatchEvent(new Event('stamp-added'));
  return true;
}

export function resetStamps() {
  stamps.clear();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('capybara-onsen-complete');
  renderStampBoard();
  console.log('[STAMPS] reset');
}

// ─── Pixel-art yuzu icon (canvas-drawn, no emoji) ───
function drawYuzuIcon(size, gray) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const s = size / 16; // pixel scale

  // Body — orange circle
  const bodyColor = gray ? '#6A6A62' : '#E89030';
  const highlightColor = gray ? '#8A8A80' : '#F5C830';
  const leafColor = gray ? '#555550' : '#4A8A30';
  const leafDark = gray ? '#444440' : '#3A7A25';

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(8 * s, 9 * s, 6 * s, 0, Math.PI * 2);
  ctx.fill();

  // Highlight pixels (top-left)
  ctx.fillStyle = highlightColor;
  ctx.fillRect(5 * s, 5 * s, 2 * s, 2 * s);
  ctx.fillRect(6 * s, 4 * s, 1 * s, 1 * s);

  // Leaf 1 (bigger)
  ctx.fillStyle = leafColor;
  ctx.fillRect(7 * s, 2 * s, 3 * s, 2 * s);
  ctx.fillRect(8 * s, 1 * s, 2 * s, 1 * s);

  // Leaf 2 (smaller, angled)
  ctx.fillStyle = leafDark;
  ctx.fillRect(10 * s, 3 * s, 2 * s, 1 * s);
  ctx.fillRect(11 * s, 2 * s, 1 * s, 1 * s);

  // Stem dot
  ctx.fillStyle = gray ? '#555550' : '#6B5744';
  ctx.fillRect(8 * s, 3 * s, 1 * s, 1 * s);

  return c;
}

// ─── Pixel-art crown icon ───
function drawCrownIcon(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const s = size / 16;

  ctx.fillStyle = '#F0D040';
  // Base band
  ctx.fillRect(2 * s, 10 * s, 12 * s, 3 * s);
  // Three points
  ctx.fillRect(2 * s, 6 * s, 3 * s, 4 * s);
  ctx.fillRect(7 * s, 4 * s, 3 * s, 6 * s);
  ctx.fillRect(12 * s, 6 * s, 2 * s, 4 * s);
  // Jewels
  ctx.fillStyle = '#C67652';
  ctx.fillRect(4 * s, 11 * s, 1 * s, 1 * s);
  ctx.fillRect(8 * s, 11 * s, 1 * s, 1 * s);
  ctx.fillRect(11 * s, 11 * s, 1 * s, 1 * s);

  return c;
}

// ─── HUD ───
let boardEl = null;
export function initStampBoard() {
  boardEl = document.createElement('div');
  boardEl.id = 'stamp-board';
  boardEl.style.cssText = 'position:fixed;bottom:32px;right:32px;z-index:15;pointer-events:none;display:flex;gap:6px;padding:10px 14px;background:rgba(107,87,68,0.85);border-radius:8px;border:2px solid rgba(244,243,221,0.2);';
  document.body.appendChild(boardEl);
  renderStampBoard();
  window.resetStamps = resetStamps;
}

function renderStampBoard() {
  if (!boardEl) return;
  boardEl.innerHTML = '';
  PROJECTS.forEach(p => {
    const dot = document.createElement('div');
    const has = stamps.has(p.id);
    dot.style.cssText = `width:28px;height:28px;border-radius:50%;border:2px solid ${has ? '#C67652' : 'rgba(244,243,221,0.3)'};display:flex;align-items:center;justify-content:center;overflow:hidden;`;
    if (has) {
      dot.style.background = '#E89030';
      dot.style.transform = `rotate(${(Math.random()-0.5)*15}deg)`;
    }
    const icon = drawYuzuIcon(24, !has);
    icon.style.cssText = 'width:20px;height:20px;image-rendering:pixelated;';
    dot.appendChild(icon);
    boardEl.appendChild(dot);
  });
  if (isComplete()) {
    const crownWrap = document.createElement('div');
    crownWrap.style.cssText = 'display:flex;align-items:center;margin-left:4px;';
    const crownIcon = drawCrownIcon(24);
    crownIcon.style.cssText = 'width:20px;height:20px;image-rendering:pixelated;';
    crownWrap.appendChild(crownIcon);
    boardEl.appendChild(crownWrap);
  }
}

function showStampAnimation(id) {
  const proj = PROJECTS.find(p => p.id === id);
  // Big stamp flash
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-8deg) scale(2);z-index:100;font-family:"DungGeunMo",monospace;font-size:48px;color:#C67652;background:rgba(244,243,221,0.95);padding:16px 32px;border-radius:12px;border:3px solid #C67652;transition:all 0.8s;pointer-events:none;';
  flash.textContent = 'STAMP GET!';
  document.body.appendChild(flash);
  setTimeout(() => { flash.style.transform = 'translate(-50%,-50%) rotate(-3deg) scale(0.5)'; flash.style.opacity = '0'; }, 1500);
  setTimeout(() => flash.remove(), 2500);

  // Complete check
  if (isComplete() && !localStorage.getItem('capybara-onsen-complete')) {
    localStorage.setItem('capybara-onsen-complete', '1');
    setTimeout(() => showCompleteAnimation(), 3000);
  }
}

function showCompleteAnimation() {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100;font-family:"DungGeunMo",monospace;font-size:36px;color:#F0D040;background:rgba(25,39,23,0.9);padding:24px 48px;border-radius:16px;border:3px solid #F0D040;text-align:center;transition:opacity 1s;pointer-events:none;';
  banner.innerHTML = '&#x2605; ONSEN MASTER! &#x2605;<br><span style="font-size:14px;color:#F4F3DD">All onsens conquered!</span>';
  document.body.appendChild(banner);
  setTimeout(() => { banner.style.opacity = '0'; }, 4000);
  setTimeout(() => banner.remove(), 5000);
  // Dispatch event for character module to pick up
  window.dispatchEvent(new Event('onsen-complete'));
}
