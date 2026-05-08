import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const accents = [
  ["indigo", "#818cf8"],
  ["violet", "#a78bfa"],
  ["blue", "#60a5fa"],
  ["teal", "#2dd4bf"],
  ["rose", "#fb7185"],
  ["amber", "#fbbf24"],
] as const;

const sizes = [512, 256, 128, 64, 32, 16] as const;
const outDir = join(import.meta.dir, "..", "src", "web", "assets", "icons");

function hexToHsl(hex: string): [number, number, number] {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  if (max === g) h = ((b - r) / d + 2) / 6;
  if (max === b) h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h /= 360;
  s /= 100;
  l /= 100;
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const rgb = s === 0
    ? [l, l, l]
    : [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
  return `#${rgb.map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`;
}

function iconSvg(accent: string): string {
  const [hue] = hexToHsl(accent);
  const stop1 = hslToHex((hue + 30 + 360) % 360, 90, 68);
  const stop2 = hslToHex((hue - 22 + 360) % 360, 92, 50);
  const centerX = 32;
  const centerY = 29;
  const radius = 12;
  const nodes = Array.from({ length: 5 }, (_, i) => {
    const angle = (i * 72 - 90) * Math.PI / 180;
    return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
  });
  const bubblePath = "M16 9 H48 Q56 9 56 17 V38 Q56 46 48 46 H30 L17 57 L21 46 H16 Q8 46 8 38 V17 Q8 9 16 9 Z";
  const lines = nodes.map((node) => `<line x1="${centerX}" y1="${centerY}" x2="${node.x.toFixed(3)}" y2="${node.y.toFixed(3)}" stroke="white" stroke-width="1.5" opacity="0.45"/>`).join("");
  const circles = nodes.map((node) => `<circle cx="${node.x.toFixed(3)}" cy="${node.y.toFixed(3)}" r="2.8" fill="white" opacity="0.75"/>`).join("");
  return `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="wagGradient" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${stop1}"/>
      <stop offset="100%" stop-color="${stop2}"/>
    </linearGradient>
    <clipPath id="wagSquircle"><rect width="64" height="64" rx="14.4" ry="14.4"/></clipPath>
    <filter id="wagShadow" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.8" flood-color="#000018" flood-opacity="0.38"/>
    </filter>
  </defs>
  <g clip-path="url(#wagSquircle)">
    <rect width="64" height="64" fill="url(#wagGradient)"/>
    <g filter="url(#wagShadow)">
      <path d="${bubblePath}" fill="white" opacity="0.14"/>
      <path d="${bubblePath}" stroke="white" stroke-width="1.8" opacity="0.6"/>
      ${lines}
      ${circles}
      <circle cx="${centerX}" cy="${centerY}" r="5.5" fill="white"/>
    </g>
  </g>
</svg>`;
}

function renderPng(accentName: string, accentHex: string, size: number): void {
  const filePath = join(outDir, `whatsagent-${accentName}-${size}.png`);
  const result = spawnSync("rsvg-convert", ["--format", "png", "--width", String(size), "--height", String(size), "--output", filePath], {
    input: iconSvg(accentHex),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`rsvg-convert failed for ${filePath}: ${result.stderr || result.stdout}`);
  }
}

mkdirSync(outDir, { recursive: true });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const [accentName, accentHex] of accents) {
  for (const size of sizes) renderPng(accentName, accentHex, size);
}

writeFileSync(join(outDir, "README.md"), `# WhatsAgent Icons\n\nGenerated PNG assets for the final Bubble + Hub app icon.\n\nRegenerate with:\n\n\`\`\`bash\nbun scripts/generate-whatsagent-icons.ts\n\`\`\`\n\nAccents: ${accents.map(([name, hex]) => `${name} ${hex}`).join(", ")}\n\nSizes: ${sizes.join(", ")} px\n`);

console.log(`Generated ${accents.length * sizes.length} WhatsAgent icon PNGs in ${dirname(join(outDir, "x"))}`);
