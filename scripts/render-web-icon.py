"""Renders the web app's home-screen icons in a Liquid Glass style.

The dumbbell (same geometry as scripts/render-icon.swift and the in-app brand mark) is white,
frosted glass on black: soft white body, a bright rim catching light from the top-left, a
fainter rim on the far side, and a subtle glow where it sits on the background.

Run from the repo root: python3 scripts/render-web-icon.py  (needs Pillow and NumPy)
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2048  # work at 2x the 1024 design size, then downsample
K = S / 1024


def rounded(draw, cx, cy, w, h, r):
    draw.rounded_rectangle([(cx - w / 2) * K, (cy - h / 2) * K, (cx + w / 2) * K, (cy + h / 2) * K], radius=r * K, fill=255)


def glyph_mask():
    m = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(m)
    c = 512
    rounded(d, c, c, 560, 60, 30)  # bar; its ends tuck inside the outer plates
    for side in (-1, 1):
        rounded(d, c + side * 178, c, 96, 392, 96 * 0.42)  # inner plates
        rounded(d, c + side * 290, c, 76, 236, 76 * 0.42)  # outer plates
    return m


def arr(img):
    return np.asarray(img, dtype=np.float32) / 255.0


def blur(a, radius):
    img = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return arr(img.filter(ImageFilter.GaussianBlur(radius * K)))


def background():
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    # Black, barely lifted at the top so it doesn't look flat.
    top = np.array([0.085, 0.085, 0.092])
    bottom = np.array([0.012, 0.012, 0.014])
    t = np.clip(y, 0, 1)[..., None]
    bg = top * (1 - t) + bottom * t
    # Soft light from the top-left corner.
    sheen = np.exp(-(((x - 0.18) ** 2 + (y - 0.05) ** 2) / 0.09))[..., None]
    bg = bg + sheen * 0.035
    return np.clip(bg, 0, 1)


def render():
    bg = background()
    m = arr(glyph_mask())
    mm = m[..., None]

    # A faint white halo: light spilling from the glass onto the black.
    halo = blur(m, 40)[..., None]
    base = np.clip(bg + halo * 0.07, 0, 1)

    # Glass body: heavily blurred, brightened background, with a white frost that is
    # stronger at the top, and a touch darker toward the bottom inside the shape.
    # White frosted body: brightest at the top, gently falling off toward the bottom.
    y = (np.mgrid[0:S, 0:S][0].astype(np.float32) / S)[..., None]
    glass = np.repeat(0.97 - 0.17 * np.clip((y - 0.30) / 0.42, 0, 1), 3, axis=-1)
    # Thicker glass in the middle of each piece reads slightly deeper.
    depth = np.clip(blur(m, 22) - 0.55, 0, 1)[..., None]
    glass = glass - depth * 0.10

    # Edge lighting from the shape's normals (gradient of a softened mask).
    soft = blur(m, 7)
    gy, gx = np.gradient(soft)
    mag = np.sqrt(gx ** 2 + gy ** 2) + 1e-6
    nx, ny = -gx / mag, -gy / mag  # outward normal
    edge = np.clip(mag / mag.max(), 0, 1)
    edge = np.clip(edge * 2.2, 0, 1) * m  # rim band, inside the glass only
    light = np.clip(-(nx * -0.62 + ny * -0.78), 0, 1)  # facing the top-left light
    back = np.clip(nx * -0.62 + ny * -0.78, 0, 1)  # far side: fainter refracted rim
    # Edges dip slightly darker, then the rim catches the light.
    glass = glass - (edge * 0.16)[..., None]
    rim = (edge * (light ** 1.3) * 0.75 + edge * (back ** 2) * 0.30)[..., None]

    # Inner glow just inside the top-left edges, like light traveling through the glass.
    inner = np.clip(blur(m, 3) - blur(m, 14), 0, 1)
    inner = (inner * light * 0.35)[..., None]

    glass = np.clip(glass + rim + inner, 0, 1)
    out = base * (1 - mm) + glass * mm
    return Image.fromarray(np.clip(out * 255, 0, 255).astype(np.uint8), 'RGB')


icon = render()
for path, px in [('web/public/apple-touch-icon.png', 180), ('web/public/icon-192.png', 192), ('web/public/icon-512.png', 512)]:
    icon.resize((px, px), Image.LANCZOS).save(path, optimize=True)
    print('wrote', path)
