// The add-in's icon (docs/OFFICE.md §2): a brand-green rounded square, a white sheet, a green check
// mark, drawn at any size without an image library. Used by scripts/icons.ts and scripts/appsource.ts.
import { crc32, deflateSync } from 'node:zlib';
import { brand } from '@fi/shared';

const SAMPLES = 4;

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const GREEN = rgb(brand.leaf[600]);
const WHITE = [255, 255, 255];

/** Distance from p to the segment a–b. */
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
}

/** The colour at (x, y) in a 1×1 square, or null outside the icon. */
function paint(x: number, y: number): number[] | null {
  const r = 0.2;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  if (Math.hypot(x - cx, y - cy) > r) return null;
  const sheet =
    x > 0.26 && x < 0.74 && y > 0.18 && y < 0.82 && !(x > 0.6 && y < 0.32 && x - 0.6 > y - 0.18);
  if (!sheet) return GREEN;
  const check = Math.min(
    segment(x, y, 0.35, 0.53, 0.46, 0.65),
    segment(x, y, 0.46, 0.65, 0.66, 0.4),
  );
  return check < 0.055 ? GREEN : WHITE;
}

/** The icon as an RGBA PNG, `size` pixels square. */
export function iconPng(size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = paint((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
          if (!c) continue;
          for (let i = 0; i < 3; i++) sum[i] = (sum[i] ?? 0) + (c[i] ?? 0);
          sum[3] = (sum[3] ?? 0) + 1;
        }
      }
      const n = sum[3] ?? 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = n ? Math.round((sum[i] ?? 0) / n) : 0;
      raw[o + 3] = Math.round((255 * n) / SAMPLES ** 2);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
