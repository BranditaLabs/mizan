"""Compose Mizan lockups, monogram, app icons and favicons from outlined glyphs (no live type)."""
import json, pathlib, sys
from wordmark import shape, red_contour

INK, WHITE, RED, RED_HI, PAPER = "#0B0B0B", "#FFFFFF", "#DE0000", "#E33232", "#FEF7FF"

def outline(kind, text, tracking, red=True):
    """Return dict(body=[d], red=[d], box=(x0,y0,x1,y1)) in font units, y-up."""
    glyphs, width, upm, _ = shape(kind, text, tracking)
    rg, ri = red_contour(glyphs, kind) if red else (None, None)
    body, rd, xs, ys = [], [], [], []
    for g in glyphs:
        for k, (d, b) in enumerate(g["cs"]):
            (rd if (g is rg and k == ri) else body).append(d)
            if b: xs += [b[0], b[2]]; ys += [b[1], b[3]]
    return dict(body=body, red=rd, box=(min(xs), min(ys), max(xs), max(ys)), upm=upm)

def place(o, x, y, h, ink, red, ref_h=None):
    """Place outline so its box height (or ref_h font units) maps to h px, top-left at (x, y). Returns (svg, w)."""
    x0, y0, x1, y1 = o["box"]
    s = h / (ref_h or (y1 - y0))
    w = (x1 - x0) * s
    g = (f'<g transform="translate({x:.2f} {y:.2f}) scale({s:.5f} {-s:.5f}) translate({-x0:.1f} {-y1:.1f})">'
         f'<path fill="{ink}" d="{" ".join(o["body"])}"/>' + (f'<path fill="{red}" d="{" ".join(o["red"])}"/>' if o["red"] else "") + "</g>")
    return g, w

def svg(w, h, inner, label, bg=None, rx=0):
    rect = f'<rect width="{w:.0f}" height="{h:.0f}" rx="{rx:.1f}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" role="img" aria-label="{label}">{rect}{inner}</svg>'

def build(out):
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    lat = outline("latin", "mizan", -0.035)
    ar = outline("arabic", "ميزان", 0.0)
    cap = outline("caption", "POWERED BY BRANDITA", 0.16, red=False)
    files = {}

    # 1. Endorsed lockup: wordmark + caption, caption width = wordmark width
    for name, ink, red in (("mizan-endorsed", INK, RED), ("mizan-endorsed-on-dark", WHITE, RED_HI)):
        H = 200
        wm, ww = place(lat, 0, 0, H, ink, red)
        cx0, cy0, cx1, cy1 = cap["box"]
        ch = ww / (cx1 - cx0) * (cy1 - cy0)        # caption scaled to the same width
        cg, _ = place(cap, 0, H + H * 0.24, ch, ink, ink)
        cg = cg.replace(f'fill="{ink}"', f'fill="{ink}" fill-opacity=".64"', 1)
        files[name] = svg(ww, H + H * 0.24 + ch, wm + cg, "mizan, powered by Brandita")

    # 2. Bilingual lockup: mizan | ميزان, matched x-height feel, hairline divider
    for name, ink, red, rule in (("mizan-bilingual", INK, RED, "#D9D9D9"), ("mizan-bilingual-on-dark", WHITE, RED_HI, "#2A2B2D")):
        H = 200
        wm, ww = place(lat, 0, 0, H, ink, red)
        gap = H * 0.42
        arh = H * 1.08
        ag, aw = place(ar, ww + gap * 2 + 3, (H - arh) / 2 + H * 0.06, arh, ink, red)
        line = f'<rect x="{ww + gap:.1f}" y="{-H * 0.05:.1f}" width="3" height="{H * 1.1:.1f}" fill="{rule}"/>'
        W = ww + gap * 2 + 3 + aw
        ay = (H - arh) / 2 + H * 0.06
        top = min(0, ay, -H * 0.05); bot = max(H, ay + arh, H * 1.05)
        files[name] = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {top:.1f} {W:.1f} {bot - top:.1f}" role="img" aria-label="mizan ميزان">'
                       f'{wm}{line}{ag}</svg>')

    # 3. Monogram "m" with the red point (square, matching Geist's tittle) at the baseline
    m = outline("latin", "m", 0, red=False)
    dot = outline("latin", "i", 0)                 # reuse the real tittle shape for the red point
    tx0, ty0, tx1, ty1 = None, None, None, None
    # red point size = tittle size relative to m height
    mx0, my0, mx1, my1 = m["box"]; ix0, iy0, ix1, iy1 = dot["box"]
    tit = dot["red"][0]
    def monogram(size, ink, red, bg, rx_ratio, pad_ratio=0.25):
        pad = size * pad_ratio
        h = size - 2 * pad
        s = h * 0.62 / (my1 - my0)                 # m height = 62% of inner box
        mw = (mx1 - mx0) * s
        sq = (ix1 - ix0) * s                       # tittle width at same scale
        total = mw + sq * 0.55 + sq
        x = (size - total) / 2
        y = (size - (my1 - my0) * s) / 2
        g = (f'<g transform="translate({x:.2f} {y:.2f}) scale({s:.5f} {-s:.5f}) translate({-mx0:.1f} {-my1:.1f})"><path fill="{ink}" d="{" ".join(m["body"])}"/></g>'
             f'<rect x="{x + mw + sq * 0.55:.2f}" y="{y + (my1 - my0) * s - sq:.2f}" width="{sq:.2f}" height="{sq:.2f}" fill="{red}"/>')
        return svg(size, size, g, "mizan", bg=bg, rx=size * rx_ratio)
    files["mizan-appicon"] = monogram(1024, WHITE, RED_HI, INK, 0.225)       # iOS/Android master (platform masks corners)
    files["mizan-appicon-square"] = monogram(1024, WHITE, RED_HI, INK, 0)    # for platforms that apply their own mask
    files["mizan-appicon-light"] = monogram(1024, INK, RED, PAPER, 0.225)
    files["mizan-favicon"] = monogram(64, WHITE, RED_HI, INK, 0.22, pad_ratio=0.12)
    files["mizan-monogram"] = monogram(1024, INK, RED, None, 0)              # transparent, for in-app use
    files["mizan-monogram-on-dark"] = monogram(1024, WHITE, RED_HI, None, 0)

    for k, v in files.items():
        (out / f"{k}.svg").write_text(v)
    print("ok", len(files))

if __name__ == "__main__":
    build(sys.argv[1])
