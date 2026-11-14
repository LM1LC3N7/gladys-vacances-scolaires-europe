// Generates cover.png (800x534) for gladys-vacances-scolaires-europe: plain
// Node, no dependency. A month calendar whose holiday days are coloured, a sun
// and a sea horizon, on a teal-to-blue gradient (no logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W) * 0.6 + (y / H) * 0.4;
    set(x, y, [42 - 20 * t, 157 - 60 * t, 143 + 50 * t]);
  }
}
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) set(x, y, color, alpha);
};
// Sun and its halo, sea waves at the bottom.
disc(640, 140, 90, [255, 214, 102], 0.25);
disc(640, 140, 62, [255, 209, 102]);
for (let y = 440; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const wave = 440 + 6 * Math.sin(x / 30 + (y - 440) / 9);
    if (y > wave) set(x, y, [24, 78, 119], 0.55);
  }
}
// The calendar: a white card, a header, 5 weeks of 7 days, holidays in coral.
const white = [255, 255, 255];
box(110, 90, 470, 430, white, 0.96);
box(110, 90, 470, 140, [231, 111, 81]);
for (const [x, y] of [
  [170, 80],
  [410, 80],
])
  box(x, y, x + 12, y + 30, [60, 60, 60]);
const holidays = new Set([8, 9, 10, 11, 12, 22, 23, 24, 25, 26, 27, 28, 29]);
for (let week = 0; week < 5; week += 1) {
  for (let day = 0; day < 7; day += 1) {
    const n = week * 7 + day;
    const x = 128 + day * 47;
    const y = 158 + week * 52;
    const color = holidays.has(n) ? [244, 162, 97] : day >= 5 ? [200, 215, 220] : [225, 232, 235];
    box(x, y, x + 38, y + 40, color);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
