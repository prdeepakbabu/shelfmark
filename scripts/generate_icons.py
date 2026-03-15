from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


OUT_DIR = Path("assets/icons")
OUT_DIR.mkdir(parents=True, exist_ok=True)

SAND = "#F5C574"
TEAL = "#1D8F97"
TEAL_DARK = "#156E74"
PAPER = "#F7F5EF"
PAPER_EDGE = "#B5BCB4"
SAND_DARK = "#C7954E"
SHADOW = (18, 49, 54, 70)


def rounded_polygon_mask(size, points, radius):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(points, fill=255)
    if radius > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius))
        mask = mask.point(lambda value: 255 if value > 90 else 0)
    return mask


def paste_shape(base, points, color, radius=0, offset=(0, 0), shadow=False):
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    mask = rounded_polygon_mask(base.size[0], points, radius)
    fill = Image.new("RGBA", base.size, color)
    if shadow:
      shadow_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
      shadow_mask = rounded_polygon_mask(base.size[0], [(x + offset[0], y + offset[1]) for x, y in points], radius)
      shadow_fill = Image.new("RGBA", base.size, SHADOW)
      shadow_layer = Image.composite(shadow_fill, shadow_layer, shadow_mask)
      shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(max(1, base.size[0] // 64)))
      base.alpha_composite(shadow_layer)
    layer = Image.composite(fill, layer, mask)
    base.alpha_composite(layer)


def make_icon(size):
    if size <= 48:
        return make_small_icon(size)
    return make_large_icon(size)


def make_small_icon(size):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    pad = max(1, round(size * 0.14))
    width = size - pad * 2
    radius = max(1, round(size * 0.12))
    base_h = max(4, round(size * 0.24))
    card_h = max(3, round(size * 0.2))
    gap = max(1, size // 16)

    bottom = (pad, size - pad - base_h, pad + width, size - pad)
    middle = (
        pad + gap,
        bottom[1] - card_h,
        pad + width - gap,
        bottom[1],
    )
    top = (
        pad + max(2, size // 8),
        middle[1] - card_h,
        pad + width - max(2, size // 8),
        middle[1],
    )

    draw.rounded_rectangle(bottom, radius=radius, fill=TEAL)
    draw.rounded_rectangle(middle, radius=max(1, radius - 1), fill=PAPER)
    draw.rounded_rectangle(top, radius=max(1, radius - 1), fill=SAND)

    if size >= 24:
        draw.rectangle((middle[2] - 1, middle[1], middle[2], middle[3]), fill=PAPER_EDGE)
        draw.rectangle((top[2] - 1, top[1], top[2], top[3]), fill=SAND_DARK)

    bookmark_w = max(4, round(size * 0.22))
    bookmark_h = max(5, round(size * 0.34))
    bookmark_x = size // 2 - bookmark_w // 2
    bookmark_y = top[1] - max(1, size // 24)
    notch = max(1, bookmark_w // 4)
    draw.polygon(
        [
            (bookmark_x, bookmark_y),
            (bookmark_x + bookmark_w, bookmark_y),
            (bookmark_x + bookmark_w, bookmark_y + bookmark_h),
            (bookmark_x + bookmark_w // 2, bookmark_y + bookmark_h - notch),
            (bookmark_x, bookmark_y + bookmark_h),
        ],
        fill=TEAL_DARK,
    )

    return canvas


def make_large_icon(size):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    left = int(size * 0.14)
    right = int(size * 0.86)
    top_y = int(size * 0.20)
    mid_y = int(size * 0.39)
    low_y = int(size * 0.58)
    slant = int(size * 0.20)
    height = int(size * 0.16)

    teal_bottom = [
        (left, low_y),
        (right - slant, low_y),
        (right, low_y + height // 2),
        (left + slant, low_y + height // 2),
    ]
    paper_mid = [
        (left + int(size * 0.05), mid_y),
        (right - slant - int(size * 0.01), mid_y),
        (right - int(size * 0.02), mid_y + height // 2),
        (left + slant + int(size * 0.04), mid_y + height // 2),
    ]
    cover_top = [
        (left + int(size * 0.08), top_y),
        (right - slant + int(size * 0.02), top_y),
        (right, top_y + height // 2),
        (left + slant + int(size * 0.08), top_y + height // 2),
    ]

    paste_shape(canvas, teal_bottom, TEAL, shadow=True, offset=(0, int(size * 0.03)))
    paste_shape(canvas, paper_mid, PAPER, shadow=True, offset=(0, int(size * 0.025)))
    paste_shape(canvas, cover_top, SAND, shadow=True, offset=(0, int(size * 0.02)))

    edge_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    edge_draw = ImageDraw.Draw(edge_layer)
    edge_draw.polygon(
        [
            (paper_mid[1][0], paper_mid[1][1]),
            (paper_mid[2][0], paper_mid[2][1]),
            (paper_mid[2][0], paper_mid[2][1] + max(2, size // 40)),
            (paper_mid[1][0], paper_mid[1][1] + max(2, size // 40)),
        ],
        fill=PAPER_EDGE,
    )
    edge_draw.polygon(
        [
            (cover_top[1][0], cover_top[1][1]),
            (cover_top[2][0], cover_top[2][1]),
            (cover_top[2][0], cover_top[2][1] + max(2, size // 36)),
            (cover_top[1][0], cover_top[1][1] + max(2, size // 36)),
        ],
        fill=SAND_DARK,
    )
    canvas.alpha_composite(edge_layer)

    bookmark_width = int(size * 0.17)
    bookmark_height = int(size * 0.28)
    bookmark_left = size // 2 - bookmark_width // 2
    bookmark_top = int(size * 0.20)
    notch = max(2, bookmark_width // 4)
    bookmark = [
        (bookmark_left, bookmark_top),
        (bookmark_left + bookmark_width, bookmark_top),
        (bookmark_left + bookmark_width, bookmark_top + bookmark_height),
        (bookmark_left + bookmark_width // 2, bookmark_top + bookmark_height - notch),
        (bookmark_left, bookmark_top + bookmark_height),
    ]
    paste_shape(canvas, bookmark, TEAL_DARK)

    return canvas


def main():
    master = make_icon(512)
    master.save(OUT_DIR / "icon-master.png")

    for size in (128, 48, 32, 16):
        icon = make_icon(size)
        icon.save(OUT_DIR / f"icon-{size}.png")


if __name__ == "__main__":
    main()
