"""Draws the app icons as PNGs (no image libraries needed).
Run: python3 tools/make_icons.py"""
import math, struct, zlib, pathlib

BG = (0x2f, 0x5d, 0x50)
BACK = (0x8f, 0xbf, 0xae)
FRONT = (0xf6, 0xf5, 0xf1)
MARK = (0x2f, 0x5d, 0x50)

def rrect(x, y, x0, y0, x1, y1, r):
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return math.hypot(x - cx, y - cy) <= r and x0 <= x <= x1 and y0 <= y <= y1

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def color_at(x, y, scale):
    # Map into content space, shrinking around the centre for maskable icons.
    x = (x - 0.5) / scale + 0.5
    y = (y - 0.5) / scale + 0.5
    pts = [(0.31, 0.575), (0.415, 0.675), (0.595, 0.475)]
    if rrect(x, y, 0.20, 0.33, 0.70, 0.80, 0.06):
        if min(seg_dist(x, y, *pts[0], *pts[1]), seg_dist(x, y, *pts[1], *pts[2])) <= 0.034:
            return MARK
        return FRONT
    if rrect(x, y, 0.30, 0.21, 0.80, 0.68, 0.06):
        return BACK
    return BG

def render(size, scale=1.0, ss=3):
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            r = g = b = 0
            for sj in range(ss):
                for si in range(ss):
                    c = color_at((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size, scale)
                    r += c[0]; g += c[1]; b += c[2]
            n = ss * ss
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

out = pathlib.Path(__file__).resolve().parent.parent / 'icons'
for name, size, scale in [('icon-180.png', 180, 1.0), ('icon-192.png', 192, 1.0), ('icon-512.png', 512, 1.0), ('icon-maskable-512.png', 512, 0.8)]:
    (out / name).write_bytes(render(size, scale))
    print('wrote', name)
