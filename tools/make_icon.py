"""
make_icon.py - 產生 WorkPulse 的 PWA icon（192 / 512 / maskable / apple-touch / favicon）

需要 Pillow（只有產圖時才需要）：
    pip install -r requirements.txt
    python tools/make_icon.py

設計：與 WealthMatrix / PocketDeck 同一家族 —— 深藍灰圓角方塊 + 點陣格 +
發光的藍→綠漸層線條 + 線尾圓環。
圓弧 = 「今天上班走到哪了」的進度環，尾端圓環 = 現在這一刻，中間一根指針指向它。
"""
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "docs"

C0, C1 = (90, 176, 232), (62, 207, 142)      # #5ab0e8 → #3ecf8e
TRACK = (54, 69, 86)                          # 未走到的軌道
BG_TOP, BG_BOT = (31, 48, 67), (11, 16, 22)
KNOB_IN = (18, 27, 38)

CX = CY = 256
R = 138                                       # 進度環半徑（512 座標）
ARC_W, TRACK_W = 40, 24
START, SWEEP = -90, 255                       # 從 12 點鐘順時針走 255°（約 71%）
RING_R, RING_IN = 31, 15
HAND_W, HAND_LEN = 26, 92


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(W, top, bot):
    g = Image.new("RGBA", (W, W))
    d = ImageDraw.Draw(g)
    for y in range(W):
        d.line([(0, y), (W, y)], fill=lerp(top, bot, y / W) + (255,))
    return g


def pt(angle_deg, r):
    a = math.radians(angle_deg)
    return CX + r * math.cos(a), CY + r * math.sin(a)


def render(size=512, rounded=True, glyph_scale=1.0, S=4):
    W = 512 * S
    c = W / 2

    def P(v):                      # 512 座標 → 超取樣像素（含 glyph 縮放）
        return c + (v * S - c) * glyph_scale

    g = glyph_scale

    # 背景
    img = vgrad(W, BG_TOP, BG_BOT)
    if rounded:
        m = Image.new("L", (W, W), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, W - 1, W - 1], radius=112 * S, fill=255)
        img.putalpha(m)
        ImageDraw.Draw(img).rounded_rectangle([S, S, W - 1 - S, W - 1 - S], radius=111 * S,
                                              outline=(70, 90, 112, 120), width=2 * S)
    dots = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    for gx in range(1, 8):
        for gy in range(1, 8):
            x, y, r = gx * 64 * S, gy * 64 * S, 3 * S
            dd.ellipse([x - r, y - r, x + r, y + r], fill=(140, 165, 190, 55))
    img = Image.alpha_composite(img, dots)

    box = [P(CX - R), P(CY - R), P(CX + R), P(CY + R)]

    # 軌道（暗，整圈）
    track = Image.new("L", (W, W), 0)
    ImageDraw.Draw(track).ellipse(box, outline=255, width=round(TRACK_W * S * g))
    img.paste(Image.new("RGBA", (W, W), TRACK + (255,)), mask=track)

    # 進度弧（亮）：用大量短線段疊出圓頭，順便做漸層（沿弧線 C0→C1）
    arc_mask = Image.new("L", (W, W), 0)
    am = ImageDraw.Draw(arc_mask)
    grad = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    steps = 360
    rr = ARC_W * S * g / 2
    for i in range(steps + 1):
        t = i / steps
        ang = START + SWEEP * t
        x, y = pt(ang, R)
        x, y = P(x), P(y)
        am.ellipse([x - rr, y - rr, x + rr, y + rr], fill=255)
        gd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=lerp(C0, C1, t) + (255,))
    end_x, end_y = pt(START + SWEEP, R)

    # 線尾圓環
    ring_out = Image.new("L", (W, W), 0)
    ro = RING_R * S * g
    ImageDraw.Draw(ring_out).ellipse([P(end_x) - ro, P(end_y) - ro, P(end_x) + ro, P(end_y) + ro], fill=255)
    ring_in = Image.new("L", (W, W), 0)
    rn = RING_IN * S * g
    ImageDraw.Draw(ring_in).ellipse([P(end_x) - rn, P(end_y) - rn, P(end_x) + rn, P(end_y) + rn], fill=255)
    ImageDraw.Draw(grad).ellipse([P(end_x) - ro, P(end_y) - ro, P(end_x) + ro, P(end_y) + ro],
                                 fill=C1 + (255,))

    # 指針：從圓心指向線尾圓環
    hand = Image.new("L", (W, W), 0)
    hd = ImageDraw.Draw(hand)
    hx, hy = pt(START + SWEEP, HAND_LEN)
    hd.line([(P(CX), P(CY)), (P(hx), P(hy))], fill=255, width=round(HAND_W * S * g))
    hr = HAND_W * S * g / 2
    for x, y in ((P(CX), P(CY)), (P(hx), P(hy))):
        hd.ellipse([x - hr, y - hr, x + hr, y + hr], fill=255)
    hand_grad = Image.new("RGBA", (W, W), lerp(C0, C1, 0.55) + (255,))

    bright = ImageChops.lighter(ImageChops.lighter(arc_mask, ring_out), hand)

    # 發光
    glow_src = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    glow_src.paste(grad, mask=bright)
    glow_src.paste(hand_grad, mask=hand)
    glow = glow_src.filter(ImageFilter.GaussianBlur(16 * S * g))
    glow.putalpha(glow.getchannel("A").point(lambda a: int(a * 0.75)))
    img = Image.alpha_composite(img, glow)

    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    layer.paste(grad, mask=ImageChops.lighter(arc_mask, ring_out))
    layer.paste(hand_grad, mask=hand)
    layer.paste(Image.new("RGBA", (W, W), KNOB_IN + (255,)), mask=ring_in)
    img = Image.alpha_composite(img, layer)

    return img.resize((size, size), Image.LANCZOS)


def main():
    render(512).save(WEB / "icon-512.png")
    render(192).save(WEB / "icon-192.png")
    render(512, rounded=False, glyph_scale=0.8).save(WEB / "icon-maskable-512.png")
    render(180, rounded=False, glyph_scale=0.9).convert("RGB").save(WEB / "apple-touch-icon.png")
    render(256).save(WEB / "favicon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("icons written to", WEB)


if __name__ == "__main__":
    main()
