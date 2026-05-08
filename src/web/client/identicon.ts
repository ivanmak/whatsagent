// Deterministic identicon util. Hashes a seed string (e.g. `repo:role`) into a
// 5x5 symmetric pixel grid + HSL color. Pure SVG output, no deps.

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function identiconFor(seed: string, size: number = 48): string {
  const hash = fnv1a(seed || 'unknown');
  const hue = hash % 360;
  const fg = `hsl(${hue} 65% 50%)`;
  const bg = `hsl(${hue} 30% 92%)`;
  const cell = size / 5;
  const rects: string[] = [];
  // 5 cols, mirrored (cols 0..2 map to 4..2). Use bits 0..14 of hash.
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const bit = (hash >>> (row * 3 + col)) & 1;
      if (!bit) continue;
      const x1 = col * cell;
      const x2 = (4 - col) * cell;
      rects.push(`<rect x="${x1}" y="${row * cell}" width="${cell}" height="${cell}" fill="${fg}"/>`);
      if (col !== 4 - col) {
        rects.push(`<rect x="${x2}" y="${row * cell}" width="${cell}" height="${cell}" fill="${fg}"/>`);
      }
    }
  }
  return `<svg class="agent-identicon" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeAttr(seed)}"><rect width="${size}" height="${size}" fill="${bg}"/>${rects.join('')}</svg>`;
}

function escapeAttr(value: string): string {
  return String(value).replace(/[&<>"']/g, ch => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}
