/**
 * Placeholder data used until a backend is wired up.
 * None of these values come from real image processing.
 */

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".tif", ".tiff", ".bmp"];

/** Returns true if the file looks like an image based on its name. */
export function isImageFile(file) {
  const name = file.name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Stable number in [0, 1) derived from a string, so dummy values stay consistent. */
function hash01(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash / 0xffffffff;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Builds an SVG data URL that stands in for a processed result image.
 * The overlay (grid + crosshair) is decorative only.
 */
function buildDummyPreview(fileName, metrics) {
  const label = escapeXml(fileName);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#152238"/>
          <stop offset="100%" stop-color="#0b1220"/>
        </linearGradient>
      </defs>
      <rect width="960" height="720" fill="url(#bg)"/>
      <g stroke="#2a3d5f" stroke-width="1">
        ${Array.from({ length: 16 }, (_, i) => `<line x1="${i * 60}" y1="0" x2="${i * 60}" y2="720"/>`).join("")}
        ${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${i * 60}" x2="960" y2="${i * 60}"/>`).join("")}
      </g>
      <line x1="480" y1="80" x2="480" y2="640" stroke="#3d8bfd" stroke-width="1.5"/>
      <line x1="80" y1="360" x2="880" y2="360" stroke="#3d8bfd" stroke-width="1.5"/>
      <circle cx="480" cy="360" r="90" fill="none" stroke="#7dd3a0" stroke-width="2"/>
      <circle cx="480" cy="360" r="8" fill="#7dd3a0"/>
      <rect x="24" y="24" width="420" height="86" rx="8" fill="rgba(8,14,28,0.82)" stroke="#2a3d5f"/>
      <text x="40" y="56" fill="#d7e3f4" font-family="Segoe UI, sans-serif" font-size="18">DUMMY RESULT</text>
      <text x="40" y="84" fill="#8ea3c0" font-family="Segoe UI, sans-serif" font-size="14">${label}</text>
      <rect x="24" y="620" width="560" height="76" rx="8" fill="rgba(8,14,28,0.82)" stroke="#2a3d5f"/>
      <text x="40" y="650" fill="#8ea3c0" font-family="Segoe UI, sans-serif" font-size="14">
        offset (${metrics.offsetX}, ${metrics.offsetY}) px   rotation ${metrics.rotationDeg} deg
      </text>
      <text x="40" y="676" fill="#8ea3c0" font-family="Segoe UI, sans-serif" font-size="14">
        RMSE ${metrics.rmse} px   inliers ${metrics.inliers}/${metrics.totalMatches}
      </text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Fake registration report for one selected file.
 * Swap this out for a backend response later.
 */
export function createDummyResult(fileName) {
  const seed = hash01(fileName);
  const metrics = {
    offsetX: round((seed - 0.5) * 24, 2),
    offsetY: round((hash01(`${fileName}-y`) - 0.5) * 18, 2),
    rotationDeg: round((hash01(`${fileName}-r`) - 0.5) * 1.6, 3),
    rmse: round(0.25 + seed * 0.55, 3),
    inliers: 160 + Math.floor(seed * 50),
    totalMatches: 210 + Math.floor(seed * 20),
  };

  return {
    fileName,
    status: "ok",
    ...metrics,
    previewUrl: buildDummyPreview(fileName, metrics),
    report: [
      `Queued ${fileName} for processing`,
      `Extracted feature matches (dummy): ${metrics.totalMatches}`,
      `Estimated transform — offset: (${metrics.offsetX}, ${metrics.offsetY}) px, rotation: ${metrics.rotationDeg} deg`,
      `Registration quality — RMSE: ${metrics.rmse} px, inliers: ${metrics.inliers}/${metrics.totalMatches}`,
      `Result image is a placeholder until the backend is connected`,
    ],
  };
}

export function formatTimestamp(date = new Date()) {
  return date.toLocaleTimeString([], { hour12: false });
}
