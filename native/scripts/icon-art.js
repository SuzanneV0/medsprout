// Medsprout's icon artwork (same geometry as ../../icon.svg), drawn pixel by pixel with anti-aliasing,
// and a tiny PNG encoder. Shared by make-android-icons.js and make-ios-icons.js. No dependencies.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const CHARCOAL = hex('#273E47'), CARAMEL = hex('#BD632F'), LINEN = hex('#F3E9DC'), CELADON = hex('#A1CDA8'), WHITE = [255, 255, 255];
const A = 40 * Math.PI / 180, cos = Math.cos(A), sin = Math.sin(A);

// Signed distance to the capsule in the 512-unit icon space (stadium 96..416 × 186..326, radius 70, rotated −40°).
function capsule(x, y) {
  const dx = x - 256, dy = y - 256;
  const u = dx * cos - dy * sin + 256, v = dx * sin + dy * cos + 256;
  const cx = Math.min(Math.max(u, 166), 346);
  return { d: Math.hypot(u - cx, v - 256) - 70, u };
}
const insideRounded = (x, y, r) => Math.hypot(Math.max(Math.abs(x - 256) - (256 - r), 0), Math.max(Math.abs(y - 256) - (256 - r), 0)) <= r;

/** Colour at a point in icon space, or null for transparent. */
const STYLES = {
  launcher: (x, y) => (insideRounded(x, y, 112) ? coloured(x, y, CHARCOAL) : null),
  round: (x, y) => (Math.hypot(x - 256, y - 256) <= 256 ? coloured(x, y, CHARCOAL) : null),
  foreground: (x, y) => coloured(x, y, null),                           // adaptive icon: background colour comes from XML
  status: (x, y) => (capsule(x, y).d <= 7 ? WHITE : null),              // single-colour silhouette for the status bar
  splash: (x, y) => coloured(x, y, CHARCOAL),
};
function coloured(x, y, bg) {
  const { d, u } = capsule(x, y);
  if (Math.abs(d) <= 7) return CELADON;
  if (d < 0) return u < 256 ? CARAMEL : LINEN;
  return bg;
}

/** Render a w×h image; the 512-unit icon is scaled to `iconPx` and centred. Transparent outside the art for non-splash styles. */
function render(w, h, style, iconPx, { opaque = false } = {}) {
  const S = 3, px = Buffer.alloc(w * h * 4), k = 512 / iconPx, ox = (w - iconPx) / 2, oy = (h - iconPx) / 2, fill = STYLES[style];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = (x + (sx + .5) / S - ox) * k, Y = (y + (sy + .5) / S - oy) * k;
      const c = style === 'splash' && (X < 0 || Y < 0 || X > 512 || Y > 512) ? CHARCOAL : fill(X, Y);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const i = (y * w + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
    px[i + 3] = Math.round(255 * a / (S * S));
  }
  return png(w, h, px, opaque);
}

function png(w, h, rgba, opaque = false) {
  const ch = opaque ? 3 : 4, raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) raw[y * (w * ch + 1) + 1 + x * ch + c] = rgba[(y * w + x) * 4 + c];
  const table = [...Array(256)].map((_, n) => { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { render, png };
