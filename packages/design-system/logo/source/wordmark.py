"""Build Mizan's type-only wordmarks as outlined SVG paths.

Latin "mizan" in Geist Bold, Arabic "ميزان" in Alexandria Bold. Text is shaped with HarfBuzz (so Arabic
joins correctly), tracked, then every glyph is split into contours. One contour per word turns Brandita red:
the tittle of the i, and the dot of the ن. Output has no font dependency.
"""
import io, json, sys, pathlib
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen, DecomposingRecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

ROOT = pathlib.Path(__file__).parent
NM = ROOT / "node_modules"
FONTS = {
    "latin": NM / "geist/dist/fonts/geist-sans/Geist-Bold.ttf",
    "arabic": NM / "@fontsource/alexandria/files/alexandria-arabic-700-normal.woff2",
    "caption": NM / "geist/dist/fonts/geist-sans/Geist-Medium.ttf",
}

def load(path):
    data = path.read_bytes()
    tt = TTFont(io.BytesIO(data))
    if path.suffix == ".woff2":  # HarfBuzz needs sfnt bytes
        buf = io.BytesIO(); tt.flavor = None; tt.save(buf); data = buf.getvalue(); tt = TTFont(io.BytesIO(data))
    face = hb.Face(data); font = hb.Font(face)
    return tt, font

def contours(glyphset, name, dx, dy):
    """Return list of (svg_path_d, bounds) per contour of a glyph placed at (dx, dy), y flipped later."""
    rec = DecomposingRecordingPen(glyphset); glyphset[name].draw(rec)
    out, cur = [], []
    for op, args in rec.value:
        cur.append((op, args))
        if op in ("closePath", "endPath"):
            out.append(cur); cur = []
    if cur: out.append(cur)
    res = []
    for c in out:
        rp = RecordingPen(); rp.value = c
        sp = SVGPathPen(None); tp = TransformPen(sp, (1, 0, 0, 1, dx, dy)); rp.replay(tp)
        bp = BoundsPen(None); tb = TransformPen(bp, (1, 0, 0, 1, dx, dy)); rp.replay(tb)
        res.append((sp.getCommands(), bp.bounds))
    return res

def shape(kind, text, tracking_em=0.0, direction=None):
    tt, font = load(FONTS[kind])
    upm = tt["head"].unitsPerEm
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    if direction: buf.direction = direction
    hb.shape(font, buf, {"kern": True, "liga": True})
    gs = tt.getGlyphSet(); order = tt.getGlyphOrder()
    x = 0; glyphs = []
    track = tracking_em * upm
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        glyphs.append(dict(name=name, cluster=info.cluster, x=x + pos.x_offset, y=pos.y_offset, cs=contours(gs, name, x + pos.x_offset, pos.y_offset)))
        x += pos.x_advance + track
    width = x - track
    return glyphs, width, upm, tt

def red_contour(glyphs, kind):
    """Pick the contour to colour red: Latin = top contour of the 'i'; Arabic = the single dot above the ن."""
    if kind == "latin":
        g = next(g for g in glyphs if g["name"] in ("i", "dotlessi") or g["name"].startswith("i"))
        idx = max(range(len(g["cs"])), key=lambda k: g["cs"][k][1][1])  # highest yMin
        return g, idx
    # Arabic: ن is the last character of ميزان (cluster 4 in logical order)
    g = next(g for g in glyphs if g["cluster"] == 4)
    # its dot: the smallest contour that sits above the others
    areas = [((b[2] - b[0]) * (b[3] - b[1]), k) for k, (_, b) in enumerate(g["cs"])]
    idx = min(areas)[1]
    return g, idx

def svg(kind, text, ink, red, tracking, pad_em=0.0, caption=None):
    glyphs, width, upm, tt = shape(kind, text, tracking)
    rg, ri = red_contour(glyphs, kind)
    xs, ys = [], []
    for g in glyphs:
        for _, b in g["cs"]:
            if b: xs += [b[0], b[2]]; ys += [b[1], b[3]]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pad = pad_em * upm
    body_d = []; red_d = []
    for g in glyphs:
        for k, (d, b) in enumerate(g["cs"]):
            (red_d if (g is rg and k == ri) else body_d).append(d)
    h = y1 - y0; w = x1 - x0
    cap_svg = ""; extra_h = 0
    if caption:
        cg, cw, cupm, _ = shape("caption", caption, 0.16)
        scale = (h * 0.16) / cupm * (1000 / 1000)  # caption cap size relative to wordmark height
        cxs = [b[0] for g in cg for _, b in g["cs"] if b] + [b[2] for g in cg for _, b in g["cs"] if b]
        cys = [b[1] for g in cg for _, b in g["cs"] if b] + [b[3] for g in cg for _, b in g["cs"] if b]
        cpaths = " ".join(d for g in cg for d, _ in g["cs"])
        gap = h * 0.30
        ch = (max(cys) - min(cys)) * scale
        extra_h = gap + ch
        cap_svg = (f'<g transform="translate({x0 - pad + pad:.1f} {y1 + pad + h + gap + max(cys) * scale:.1f}) scale({scale:.5f} {-scale:.5f}) translate({-min(cxs):.1f} 0)">'
                   f'<path fill="{ink}" fill-opacity=".62" d="{cpaths}"/></g>')
        w = max(w, (max(cxs) - min(cxs)) * scale)
    vb_w = w + 2 * pad; vb_h = h + 2 * pad + extra_h
    # flip y: font units are y-up
    g_open = f'<g transform="translate({pad - x0:.1f} {pad + y1:.1f}) scale(1 -1)">'
    paths = f'<path fill="{ink}" d="{" ".join(body_d)}"/><path fill="{red}" d="{" ".join(red_d)}"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb_w:.0f} {vb_h:.0f}" role="img" aria-label="{text}">'
            f'{g_open}{paths}</g>{cap_svg}</svg>'), (vb_w, vb_h)

if __name__ == "__main__":
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    INK, PAPER, RED, RED_HI = "#0B0B0B", "#FFFFFF", "#DE0000", "#E33232"
    sizes = {}
    variants = {
        "mizan-wordmark": ("latin", "mizan", INK, RED),
        "mizan-wordmark-on-dark": ("latin", "mizan", PAPER, RED_HI),
        "mizan-wordmark-mono-black": ("latin", "mizan", INK, INK),
        "mizan-wordmark-mono-white": ("latin", "mizan", PAPER, PAPER),
        "mizan-wordmark-ar": ("arabic", "ميزان", INK, RED),
        "mizan-wordmark-ar-on-dark": ("arabic", "ميزان", PAPER, RED_HI),
        "mizan-wordmark-ar-mono-black": ("arabic", "ميزان", INK, INK),
        "mizan-wordmark-ar-mono-white": ("arabic", "ميزان", PAPER, PAPER),
    }
    for name, (kind, text, ink, red) in variants.items():
        s, wh = svg(kind, text, ink, red, -0.035 if kind == "latin" else 0.0)
        (out / f"{name}.svg").write_text(s); sizes[name] = wh
    for name, ink, red in (("mizan-endorsed", INK, RED), ("mizan-endorsed-on-dark", PAPER, RED_HI)):
        s, wh = svg("latin", "mizan", ink, red, -0.035, caption="POWERED BY BRANDITA")
        (out / f"{name}.svg").write_text(s); sizes[name] = wh
    json.dump(sizes, open(out / "sizes.json", "w"), indent=1)
    print("ok", len(sizes))
