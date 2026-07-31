import { BUILD_VERSION } from './config.js';

// ─── BUILD VERSION MARKER ───
export function initBuildMarker() {
  const el = document.getElementById('build-version');
  if (el) el.textContent = `BUILD ${BUILD_VERSION}`;
}
