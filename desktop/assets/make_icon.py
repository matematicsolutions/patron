"""
PATRON ICO generator - multi-resolution 16/32/48/64/128/256px
"""

import math, struct, io
from PIL import Image, ImageDraw, ImageFilter

NAVY  = (14, 24, 37, 255)
GOLD  = (201, 165, 90, 255)
GOLD2 = (160, 128, 65, 180)


def draw_blade(draw, cx, cy, angle_deg, blade_len, blade_w, color):
    a = math.radians(angle_deg)
    ca, sa = math.cos(a), math.sin(a)
    pa, ps = -sa, ca
    pts = [
        (cx + ca * blade_len * 0.04 + pa * blade_w, cy + sa * blade_len * 0.04 + ps * blade_w),
        (cx + ca * blade_len      + pa * blade_w * 0.3, cy + sa * blade_len      + ps * blade_w * 0.3),
        (cx + ca * blade_len      - pa * blade_w * 0.3, cy + sa * blade_len      - ps * blade_w * 0.3),
        (cx + ca * blade_len * 0.04 - pa * blade_w, cy + sa * blade_len * 0.04 - ps * blade_w),
    ]
    draw.polygon(pts, fill=color)


def make_frame(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")

    cx = cy = size / 2
    pad = max(1.5, size * 0.05)
    r = cx - pad

    # Background disc
    draw.ellipse([pad, pad, size - pad, size - pad], fill=NAVY)

    # Gold border ring
    rw = max(1, int(size * 0.025))
    draw.ellipse([pad, pad, size - pad, size - pad], outline=(*GOLD[:3], 100), width=rw)

    if size >= 48:
        outer_r  = r - rw - 1
        inner_r  = outer_r * 0.55
        bw_outer = outer_r * 0.14
        bw_inner = inner_r * 0.14
        for i in range(12):
            deg = i * 30
            draw_blade(draw, cx, cy, deg, outer_r,  bw_outer, (*GOLD2[:3],  130 - 30*(i%2)))
            draw_blade(draw, cx, cy, deg, inner_r,  bw_inner, (*GOLD[:3],   200 - 60*(i%2)))
    else:
        # Tiny sizes: simple 4 cross blades
        sr = r * 0.7
        sw = r * 0.18
        for deg in [0, 90, 180, 270, 45, 135, 225, 315]:
            draw_blade(draw, cx, cy, deg, sr, sw, (*GOLD[:3], 200))

    # Centre dot
    dr = max(1.5, size * 0.05)
    draw.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=GOLD)

    # Soft AA
    if size >= 64:
        img = img.filter(ImageFilter.GaussianBlur(0.5))

    return img


def save_multi_ico(frames_dict, path):
    """
    frames_dict: {size: PIL Image RGBA}
    Writes proper multi-image ICO (ICONDIR format).
    """
    sizes = sorted(frames_dict.keys())
    n = len(sizes)

    # Encode each image as PNG (ICO supports PNG compression for >=32px)
    pngs = {}
    for s in sizes:
        buf = io.BytesIO()
        frames_dict[s].save(buf, format="PNG")
        pngs[s] = buf.getvalue()

    # ICONDIR header: 3 WORDs (reserved=0, type=1, count=n)
    ico = struct.pack("<HHH", 0, 1, n)

    # Each ICONDIRENTRY: width(B), height(B), colorCount(B), reserved(B),
    #                    planes(W), bitCount(W), bytesInRes(I), imageOffset(I)
    header_size = 6 + n * 16
    offset = header_size
    entries = b""
    for s in sizes:
        data = pngs[s]
        w = h = s if s < 256 else 0   # 0 means 256 in ICO spec
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(data), offset)
        offset += len(data)

    # Data
    data_blob = b"".join(pngs[s] for s in sizes)

    with open(path, "wb") as f:
        f.write(ico + entries + data_blob)

    total = len(ico) + len(entries) + len(data_blob)
    print(f"Saved {path}  ({n} sizes: {sizes}, {total} bytes)")


if __name__ == "__main__":
    sizes = [16, 32, 48, 64, 128, 256]
    frames = {s: make_frame(s) for s in sizes}
    save_multi_ico(frames, "C:/Users/Wieslaw/patron/desktop/assets/icon.ico")
