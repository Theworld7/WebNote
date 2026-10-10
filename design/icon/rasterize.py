#!/usr/bin/env python3
"""WebNote 应用图标的位图渲染器。

读 design/icon/icon.tokens.json（和 SVG 生成器同一份真源），用 Pillow 渲染出
与 SVG 视觉一致的 1024×1024 位图，再产出各平台尺寸。

为什么不用无头浏览器光栅化 SVG：这台机器的 DSH 沙箱起不了 Vite dev server
（`spawn EPERM`），浏览器路径不可靠。改成「同一份 tokens、两个渲染器」——
SVG 给人看、给 Icon Composer 用，位图由本脚本确定性地产出。
两者的一致性由 design/icon-check.html 的肉眼核对兜底。

所有图层的几何坐标都在 1024 画布空间里；只有掩膜（squircle、面板、折角、字形）
在 3 倍超采样下绘制后再缩回来，得到干净的抗锯齿边缘。

用法：
    python design/icon/rasterize.py              # 渲染 light → src-tauri/icons
    python design/icon/rasterize.py --theme=dark
    python design/icon/rasterize.py --preview    # 只出预览图
"""

from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
ICONS = REPO / "src-tauri" / "icons"
TOKENS = json.loads((HERE / "icon.tokens.json").read_text(encoding="utf-8"))

CANVAS = TOKENS["geometry"]["canvas"]
N = TOKENS["geometry"]["exponent"]
AA = 3  # 掩膜超采样倍数


# ────────────────────────── 几何 ──────────────────────────


def super_point(theta: float) -> tuple[float, float]:
    """超椭圆上参数 θ 处的点，θ=0 在右边缘中点。"""
    c, s = math.cos(theta), math.sin(theta)
    x = math.copysign(abs(c) ** (2 / N), c) * CANVAS / 2
    y = math.copysign(abs(s) ** (2 / N), s) * CANVAS / 2
    return x, y


def squircle_points(quarter: bool = False, steps: int = 720) -> list[tuple[float, float]]:
    """画布坐标下的超椭圆折线；quarter=True 时只给右上第一象限。"""
    span = math.pi / 2 if quarter else 2 * math.pi
    pts = []
    for i in range(steps + 1):
        x, y = super_point(i / steps * span)
        pts.append((x + CANVAS / 2, y + CANVAS / 2))
    return pts


# ────────────────────────── 渐变 ──────────────────────────


def linear_layer(x0: float, y0: float, x1: float, y1: float, stops: list) -> np.ndarray:
    """沿归一化坐标 (x0,y0)→(x1,y1) 铺渐变，返回 CANVAS²×4 的 0..1 数组。"""
    yy, xx = np.mgrid[0:CANVAS, 0:CANVAS]
    ux, uy = (xx + 0.5) / CANVAS, (yy + 0.5) / CANVAS
    dx, dy = x1 - x0, y1 - y0
    denom = dx * dx + dy * dy or 1.0
    t = np.clip(((ux - x0) * dx + (uy - y0) * dy) / denom, 0.0, 1.0)

    out = np.zeros((CANVAS, CANVAS, 4), np.float32)

    def chan(rgba, ch):
        v = rgba[ch] if ch < len(rgba) else 1.0
        return v / 255 if ch < 3 else v

    done = np.zeros((CANVAS, CANVAS), bool)
    for i in range(len(stops) - 1):
        o0, c0 = stops[i]
        o1, c1 = stops[i + 1]
        band = (t >= o0) & (t <= o1) & ~done
        if not band.any():
            continue
        k = np.zeros_like(t) if o1 == o0 else (t - o0) / (o1 - o0)
        for ch in range(4):
            v0, v1 = chan(c0, ch), chan(c1, ch)
            out[:, :, ch] = np.where(band, v0 + (v1 - v0) * k, out[:, :, ch])
        done |= band
    for ch in range(4):
        out[:, :, ch] = np.where(t < stops[0][0], chan(stops[0][1], ch), out[:, :, ch])
        out[:, :, ch] = np.where(t > stops[-1][0], chan(stops[-1][1], ch), out[:, :, ch])
    return out


def radial_layer(cx: float, cy: float, radius: float, rgb, alpha: float) -> np.ndarray:
    yy, xx = np.mgrid[0:CANVAS, 0:CANVAS]
    ux, uy = (xx + 0.5) / CANVAS, (yy + 0.5) / CANVAS
    d = np.hypot(ux - cx, uy - cy) / radius
    out = np.zeros((CANVAS, CANVAS, 4), np.float32)
    out[:, :, 0] = rgb[0] / 255
    out[:, :, 1] = rgb[1] / 255
    out[:, :, 2] = rgb[2] / 255
    out[:, :, 3] = np.clip(1.0 - d, 0.0, 1.0) ** 2 * alpha
    return out


def solid(rgb, alpha: float = 1.0) -> np.ndarray:
    out = np.zeros((CANVAS, CANVAS, 4), np.float32)
    out[:, :, 0] = rgb[0] / 255
    out[:, :, 1] = rgb[1] / 255
    out[:, :, 2] = rgb[2] / 255
    out[:, :, 3] = alpha
    return out


# ────────────────────────── 合成 ──────────────────────────


def over(base: np.ndarray, top: np.ndarray) -> np.ndarray:
    """source-over（数组为 0..1 直通 alpha）。"""
    a = top[:, :, 3:4]
    return np.concatenate(
        [top[:, :, :3] * a + base[:, :, :3] * (1 - a), a + base[:, :, 3:4] * (1 - a)],
        axis=2,
    )


def to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def from_mask(img: Image.Image) -> np.ndarray:
    """单通道图 → H×W×1 的 0..1 数组。"""
    return np.asarray(img, dtype=np.float32)[:, :, None] / 255.0


def mask(paint, blur: float = 0.0) -> np.ndarray:
    """在 AA 倍画布上绘制再缩回，得到抗锯齿掩膜（H×W×1）。"""
    big = Image.new("L", (CANVAS * AA, CANVAS * AA), 0)
    paint(ImageDraw.Draw(big), AA)
    if blur:
        big = big.filter(ImageFilter.GaussianBlur(blur * AA))
    return from_mask(big.resize((CANVAS, CANVAS), Image.LANCZOS))


def scale_pts(pts, a):
    return [(x * a, y * a) for x, y in pts]


# ────────────────────────── 渲染 ──────────────────────────


def render(theme: str) -> Image.Image:
    t = TOKENS["themes"][theme]
    sh = TOKENS["sheet"]
    g = TOKENS["glyph"]

    shx, shy = sh["x"], sh["y"]
    shs, shr, fsz = sh["size"], sh["radius"], sh["fold"]
    shx1, shy1 = shx + shs, shy + shs
    gcx, gcy = g["center"]

    # ── L1 背景 ──
    bg = linear_layer(0.06, 0.0, 0.94, 1.0, t["bg"])
    bg = over(bg, radial_layer(*t["glow"]["center"], t["glow"]["radius"], t["glow"]["rgb"], t["glow"]["alpha"]))
    bg = over(
        bg,
        radial_layer(*t["vignette"]["center"], t["vignette"]["radius"], t["vignette"]["rgb"], t["vignette"]["alpha"]),
    )

    # 上缘镜面高光：沿超椭圆右上弧画一条粗线，再按「左亮右灭」压暗
    rim = mask(
        lambda d, a: d.line(
            scale_pts(squircle_points(quarter=True), a),
            fill=255,
            width=max(2, round(t["rim"]["width"] * a)),
            joint="curve",
        ),
        blur=4,
    )
    yy, xx = np.mgrid[0:CANVAS, 0:CANVAS]
    fade = np.clip(1.0 - ((xx + 0.5) / CANVAS - 0.08) / 0.82, 0.0, 1.0) ** 1.6
    rim_layer = solid(t["rim"]["rgb"])
    rim_layer[:, :, 3:4] = rim * fade[:, :, None] * t["rim"]["alpha"]
    bg = over(bg, rim_layer)
    bg[:, :, 3:4] *= mask(
        lambda d, a: d.polygon(scale_pts(squircle_points(), a), fill=255)
    )

    # ── L2 玻璃面板 ──
    sheet = linear_layer(0.0, 0.0, 0.55, 1.0, t["sheet"])
    panel = mask(
        lambda d, a: d.rounded_rectangle(
            [shx * a, shy * a, shx1 * a, shy1 * a], radius=shr * a, fill=255
        )
    )
    sheet[:, :, 3:4] *= panel

    # 上缘接光：整圈描边 × 只留顶部的一段渐变
    ring = mask(
        lambda d, a: d.rounded_rectangle(
            [shx * a, shy * a, shx1 * a, shy1 * a],
            radius=shr * a,
            outline=255,
            width=max(2, round(4 * a)),
        ),
        blur=1.6,
    )
    top_fade = linear_layer(
        0.15,
        0.0,
        0.85,
        0.4,
        [(0.0, [0, 0, 0, 0]), (0.45, [255, 255, 255, 1]), (1.0, [255, 255, 255, 0])],
    )[:, :, 3:4]
    hi = t["sheetTopHighlight"]
    top_layer = solid(hi["rgb"])
    top_layer[:, :, 3:4] = ring * top_fade * hi["alpha"] * panel
    sheet = over(sheet, top_layer)

    # 折角：阴影压住「被掀开」的方块，三角形是翻起来的那片纸
    fx, fy, fcx = shx1, shy, shx1 - fsz
    shade = linear_layer(
        0.1,
        1.0,
        0.9,
        0.15,
        [(0.0, [*t["foldShade"]["rgb"], t["foldShade"]["alpha"]]), (1.0, [*t["foldShade"]["rgb"], 0.0])],
    )
    shade[:, :, 3:4] *= (
        mask(lambda d, a: d.polygon(scale_pts([(fcx, fy), (fcx, fy + fsz), (fx, fy + fsz)], a), fill=255))
        * panel
    )
    sheet = over(sheet, shade)

    fold = linear_layer(0.0, 0.0, 1.0, 1.0, t["fold"])
    fold[:, :, 3:4] *= (
        mask(lambda d, a: d.polygon(scale_pts([(fcx, fy), (fx, fy + fsz), (fcx, fy + fsz)], a), fill=255))
        * panel
    )
    sheet = over(sheet, fold)

    # 折缝：沿着翻起来那条边的一道亮线，让折角不是一块死三角形
    seam_w = 5
    seam = mask(
        lambda d, a: d.line(
            scale_pts([(fcx, fy), (fx, fy + fsz)], a),
            fill=255,
            width=max(2, round(seam_w * a)),
        ),
        blur=0.6,
    )
    seam_layer = solid(t["foldSeam"]["rgb"])
    seam_layer[:, :, 3:4] = seam * t["foldSeam"]["alpha"] * panel
    sheet = over(sheet, seam_layer)

    # ── L3 标记：HTML 尖括号 + 正文行 ──
    stroke_w = g["stroke"]
    off = g["spread"] + 50
    glyph_pts = [
        [(gcx - g["spread"], gcy - g["height"] / 2), (gcx - off, gcy), (gcx - g["spread"], gcy + g["height"] / 2)],
        [(gcx + g["spread"], gcy - g["height"] / 2), (gcx + off, gcy), (gcx + g["spread"], gcy + g["height"] / 2)],
    ]
    slash_pts = [
        (gcx + g["slashSpread"], gcy - g["slashHeight"] / 2),
        (gcx - g["slashSpread"], gcy + g["slashHeight"] / 2),
    ]

    def paint_glyph(d, a):
        w = max(2, round(stroke_w * a))
        for pts in glyph_pts:
            d.line(scale_pts(pts, a), fill=255, width=w, joint="curve")
            for p in (pts[0], pts[-1]):
                x, y = p[0] * a, p[1] * a
                d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=255)
        d.line(scale_pts(slash_pts, a), fill=255, width=w, joint="curve")
        for p in slash_pts:
            x, y = p[0] * a, p[1] * a
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=255)

    glyph = linear_layer(0.0, 0.0, 0.7, 1.0, t["glyph"])
    glyph[:, :, 3:4] *= mask(paint_glyph)

    bar_h = TOKENS["bars"]["height"]
    bars = solid(t["bar"]["rgb"])
    bars[:, :, 3:4] = mask(
        lambda d, a: [
            d.rounded_rectangle(
                [
                    (CANVAS - row["width"]) / 2 * a,
                    row["y"] * a,
                    ((CANVAS + row["width"]) / 2) * a,
                    (row["y"] + bar_h) * a,
                ],
                radius=bar_h / 2 * a,
                fill=255,
            )
            for row in TOKENS["bars"]["rows"]
        ]
    ) * t["bar"]["alpha"]

    mark = over(glyph, bars)

    out = over(over(bg, sheet), mark)
    return to_image(out)


# ────────────────────────── 产出 ──────────────────────────

PNG_TARGETS = [
    (32, "32x32.png"),
    (128, "128x128.png"),
    (256, "128x128@2x.png"),
    (512, "icon.png"),
    (30, "Square30x30Logo.png"),
    (44, "Square44x44Logo.png"),
    (50, "StoreLogo.png"),
    (71, "Square71x71Logo.png"),
    (89, "Square89x89Logo.png"),
    (107, "Square107x107Logo.png"),
    (142, "Square142x142Logo.png"),
    (150, "Square150x150Logo.png"),
    (284, "Square284x284Logo.png"),
    (310, "Square310x310Logo.png"),
]


def png_bytes(master: Image.Image, size: int) -> bytes:
    buf = io.BytesIO()
    master.resize((size, size), Image.LANCZOS).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def icns(master: Image.Image) -> bytes:
    """TOC + ic07/ic08/ic09/ic10，载荷是 PNG（macOS 10.7+ 认）。"""
    parts = []
    for kind, size in (("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024)):
        data = png_bytes(master, size)
        parts.append(kind.encode("ascii") + (len(data) + 8).to_bytes(4, "big") + data)
    body = b"".join(parts)
    return b"icns" + (len(body) + 8).to_bytes(4, "big") + body


def ico(master: Image.Image) -> bytes:
    """每项内嵌 PNG（Vista+ 支持）。"""
    sizes = [16, 32, 48, 64, 128, 256]
    blobs = [png_bytes(master, s) for s in sizes]
    header = (0).to_bytes(2, "little") + (1).to_bytes(2, "little") + len(blobs).to_bytes(2, "little")
    entries = b""
    offset = 6 + 16 * len(blobs)
    for size, data in zip(sizes, blobs):
        dim = size if size < 256 else 0
        entries += bytes([dim, dim, 0, 0])
        entries += (1).to_bytes(2, "little") + (32).to_bytes(2, "little")
        entries += len(data).to_bytes(4, "little") + offset.to_bytes(4, "little")
        offset += len(data)
    return header + entries + b"".join(blobs)


def main() -> None:
    ap = argparse.ArgumentParser(description="渲染 WebNote 图标位图")
    ap.add_argument("--theme", default="light", choices=["light", "dark"])
    ap.add_argument("--preview", action="store_true", help="只写预览图，不覆盖 src-tauri/icons")
    ap.add_argument("--preview-size", type=int, default=1024)
    args = ap.parse_args()

    master = render(args.theme)
    if args.preview:
        out = HERE / f"preview-{'dark' if args.theme == 'dark' else 'light'}.png"
        master.resize((args.preview_size, args.preview_size), Image.LANCZOS).save(out)
        print(f"预览：{out.relative_to(REPO)}")
        return

    ICONS.mkdir(parents=True, exist_ok=True)
    for size, name in PNG_TARGETS:
        master.resize((size, size), Image.LANCZOS).save(ICONS / name, "PNG", optimize=True)
    master.save(ICONS / "source-1024.png", "PNG", optimize=True)
    (ICONS / "icon.icns").write_bytes(icns(master))
    (ICONS / "icon.ico").write_bytes(ico(master))
    print(f"主题 {args.theme}：{len(PNG_TARGETS) + 1} 个 PNG + icon.icns + icon.ico")
    print(f"写入 {ICONS.relative_to(REPO)}/")


if __name__ == "__main__":
    main()
