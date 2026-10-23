"""Template-referenced FFT focus score for USAF group 8 / 9 patches.

Standalone: numpy + matplotlib (OpenCV only for loading, if present). Nothing
in usaf_registration/ is imported.

Each patch's bar frequency is known from its group/element and the image scale,
so nothing is searched for. The patch's power at that frequency is compared
with the power of an ideal, noise-free rendering of the same element -- the
template -- at the same scale, angle and pixel sampling:

    mtf = sqrt((P_patch - P_noise) / P_template)

The template carries the bar geometry and the camera's pixel integration, so
the ratio is the optics' modulation transfer at that frequency: 1 = passed at
full contrast, 0 = blurred away. Comparing spectral magnitudes rather than
pixels keeps it insensitive to a pixel or two of registration error.

Filenames carry the metadata:  g8e3_V_Z61_870.png
    g<group>e<element>   which element
    _V / _H              vertical bars (frequency along x) / horizontal bars
    _Z61_870             optional focus position; enables the focus sweep

A manifest.csv next to the images with `file,true_mtf` columns (written by
make_test_images.py) adds a check against the known answer.

Usage:
    python fft_poc/make_test_images.py
    python fft_poc/focus_score.py fft_poc/test_images --px-per-mm 1140
"""

from __future__ import annotations

import argparse
import base64
import csv
import html
import io
import re
from functools import lru_cache
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
NAME_RE = re.compile(r"g(\d+)e([1-6])_([HV])", re.IGNORECASE)
Z_RE = re.compile(r"[Zz](\d+)_(\d+)")
ANGLE = {"V": 0.0, "H": 90.0}  # direction of the bar frequency

PAD = 4                     # zero-padding factor -> finer frequency grid
DISC = 0.08                 # integration radius around the bar frequency, as a fraction of f
NOISE_BAND = (0.75, 1.25)   # annulus (fractions of f) the noise floor is estimated from
NOISE_GUARD = 0.5           # ...excluding this radius around the bar peak
# Above this (cycles/px) the +f peak and the wrapped -f peak overlap, so the
# reading depends on the bars' sub-pixel phase: reported, not used for scores.
NEAR_NYQUIST = 0.42


def lp_per_mm(group: int, element: int) -> float:
    return float(2.0 ** (group + (element - 1) / 6.0))


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------

def load_gray(path: Path) -> np.ndarray:
    """Grayscale float64 in [0, 1]; keeps 16-bit depth when OpenCV is present."""
    img = None
    try:
        import cv2

        img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE | cv2.IMREAD_ANYDEPTH)
    except ImportError:
        pass
    if img is None:
        img = plt.imread(str(path))
    img = np.asarray(img)
    if img.ndim == 3:
        img = img[..., :3].mean(axis=2)
    if np.issubdtype(img.dtype, np.integer):
        return img.astype(np.float64) / np.iinfo(img.dtype).max
    return img.astype(np.float64)


def parse_name(name: str):
    m = NAME_RE.search(name)
    if not m:
        return None
    zm = Z_RE.search(name)
    z = float(f"{zm.group(1)}.{zm.group(2)}") if zm else None
    return int(m.group(1)), int(m.group(2)), m.group(3).upper(), z


def load_truth(folder: Path) -> dict:
    path = folder / "manifest.csv"
    if not path.exists():
        return {}
    with path.open(newline="") as fh:
        return {r["file"]: float(r["true_mtf"]) for r in csv.DictReader(fh) if r.get("true_mtf")}


# --------------------------------------------------------------------------
# template + spectral measurement
# --------------------------------------------------------------------------

def element_fine(group, element, px_per_mm, angle_deg, shape, shift=(0.0, 0.0), oversample=8):
    """Ideal USAF element on a grid `oversample` times finer than the pixels:
    three dark bars (0) on a bright field (1), period/2 wide and 2.5 periods
    long (5:1). angle_deg is the direction across the bars: 0 = vertical bars."""
    h, w = shape
    period = px_per_mm / lp_per_mm(group, element)
    ys = (np.arange(h * oversample) + 0.5) / oversample - h / 2 - shift[1]
    xs = (np.arange(w * oversample) + 0.5) / oversample - w / 2 - shift[0]
    xx, yy = np.meshgrid(xs, ys)
    t = np.radians(angle_deg)
    u = xx * np.cos(t) + yy * np.sin(t)    # across the bars
    v = -xx * np.sin(t) + yy * np.cos(t)   # along the bars
    k = np.round(u / period)               # nearest bar centre: -1, 0, +1
    bar = (np.abs(k) <= 1) & (np.abs(u - k * period) < period / 4) & (np.abs(v) < 1.25 * period)
    return np.where(bar, 0.0, 1.0)


def bin_pixels(fine: np.ndarray, oversample: int) -> np.ndarray:
    """Area-average onto the pixel grid: the sensor's pixel integration."""
    h, w = fine.shape[0] // oversample, fine.shape[1] // oversample
    return fine.reshape(h, oversample, w, oversample).mean(axis=(1, 3))


def lowpass(fine: np.ndarray, cutoff_cpx: float, oversample: int) -> np.ndarray:
    """Remove everything above cutoff (cycles per *pixel*) from a fine-grid image."""
    spec = np.fft.fft2(fine - 1.0)  # background is 1, so this is periodic-clean
    fy = np.fft.fftfreq(fine.shape[0]) * oversample
    fx = np.fft.fftfreq(fine.shape[1]) * oversample
    keep = np.hypot(*np.meshgrid(fx, fy)) <= cutoff_cpx
    return np.real(np.fft.ifft2(spec * keep)) + 1.0


def render_element(group, element, px_per_mm, angle_deg, shape, band_limit=None, oversample=8):
    """Ideal element as the sensor would see it. With band_limit (cycles/px) the
    bar harmonics are removed before pixel binning, so they cannot alias back
    onto the fundamental the score is measured at."""
    fine = element_fine(group, element, px_per_mm, angle_deg, shape, oversample=oversample)
    if band_limit:
        fine = lowpass(fine, band_limit, oversample)
    return bin_pixels(fine, oversample)


def power_spectrum(img: np.ndarray) -> np.ndarray:
    h, w = img.shape
    window = np.outer(np.hanning(h), np.hanning(w))
    spec = np.fft.fft2((img - img.mean()) * window, s=(PAD * h, PAD * w))
    return np.abs(np.fft.fftshift(spec)) ** 2


@lru_cache(maxsize=None)
def freq_grid(shape):
    fx = np.fft.fftshift(np.fft.fftfreq(PAD * shape[1]))
    fy = np.fft.fftshift(np.fft.fftfreq(PAD * shape[0]))
    return np.meshgrid(fx, fy)


@lru_cache(maxsize=None)
def template_spectrum(group, element, orient, shape, px_per_mm):
    # Fundamental only: real optics have usually removed the 3rd harmonic
    # before the sensor, and an aliased one would sit right on the fundamental.
    f = lp_per_mm(group, element) / px_per_mm
    return power_spectrum(render_element(group, element, px_per_mm, ANGLE[orient], shape, band_limit=2 * f))


def white_level(img: np.ndarray, black: float) -> float:
    """Background level from the patch border, which stays white at any focus."""
    b = max(2, min(img.shape) // 10)
    frame = np.concatenate([img[:b].ravel(), img[-b:].ravel(), img[:, :b].ravel(), img[:, -b:].ravel()])
    return float(np.median(frame)) - black


def score_patch(img, group, element, orient, px_per_mm, black=0.0) -> dict:
    lpmm = lp_per_mm(group, element)
    f = lpmm / px_per_mm
    row = {"group": group, "element": element, "orient": orient, "lp_mm": lpmm, "f_cpx": f}
    if f >= 0.5:
        return {**row, "mtf": np.nan, "detect_db": np.nan, "status": "beyond Nyquist"}

    norm = (img - black) / max(white_level(img, black), 1e-9)
    fxx, fyy = freq_grid(img.shape)
    kx, ky = f * np.cos(np.radians(ANGLE[orient])), f * np.sin(np.radians(ANGLE[orient]))
    d = np.minimum(np.hypot(fxx - kx, fyy - ky), np.hypot(fxx + kx, fyy + ky))
    r = np.hypot(fxx, fyy)
    disc = d < DISC * f
    ring = (r > NOISE_BAND[0] * f) & (r < NOISE_BAND[1] * f) & (d > NOISE_GUARD * f)

    power = power_spectrum(norm)
    # White noise bins are exponentially distributed: mean = median / ln 2.
    p_noise = np.median(power[ring]) / np.log(2) * disc.sum()
    p_sig = power[disc].sum()
    p_tmpl = template_spectrum(group, element, orient, img.shape, px_per_mm)[disc].sum()

    mtf = float(np.sqrt(max(p_sig - p_noise, 0.0) / p_tmpl))
    detect_db = float(10 * np.log10(max(p_sig, 1e-30) / max(p_noise, 1e-30)))
    row.update(mtf=mtf, detect_db=detect_db, norm=norm)
    if f > NEAR_NYQUIST:
        row["status"] = "near Nyquist"
    return row


def usable(r) -> bool:
    return r["status"] in ("resolved", "unresolved")


# --------------------------------------------------------------------------
# aggregation
# --------------------------------------------------------------------------

def resolution_limit(rows):
    """Finest element resolved with every coarser one resolved too (USAF reading)."""
    last = None
    for r in sorted(rows, key=lambda r: r["f_cpx"]):
        if r["status"] != "resolved":   # unresolved, or too close to Nyquist to trust
            break
        last = r
    return last


def summarize_z(rows):
    by_z = {}
    for r in rows:
        by_z.setdefault(r["z"], []).append(r)
    out = []
    for z in sorted(by_z, key=lambda v: (v is None, v)):
        rs = [r for r in by_z[z] if usable(r)]
        entry = {"z": z, "rows": by_z[z]}
        for key, sel in (("all", rs), ("V", [r for r in rs if r["orient"] == "V"]),
                         ("H", [r for r in rs if r["orient"] == "H"])):
            entry[f"focus_{key}"] = float(np.mean([r["mtf"] for r in sel])) if sel else np.nan
        entry["limit_V"] = resolution_limit([r for r in by_z[z] if r["orient"] == "V"])
        entry["limit_H"] = resolution_limit([r for r in by_z[z] if r["orient"] == "H"])
        out.append(entry)
    return out


def peak_z(zs, ys):
    """Z of the maximum, refined by a parabola through it and its neighbours."""
    zs, ys = np.asarray(zs, float), np.asarray(ys, float)
    i = int(np.nanargmax(ys))
    if 0 < i < len(zs) - 1 and np.all(np.isfinite(ys[i - 1:i + 2])):
        a, b, _ = np.polyfit(zs[i - 1:i + 2] - zs[i], ys[i - 1:i + 2], 2)
        if a < 0:
            return float(zs[i] - b / (2 * a))
    return float(zs[i])


def range_above(zs, ys, frac=0.5):
    """Z interval around the peak where ys stays >= frac * peak (None = runs off the sweep)."""
    zs, ys = np.asarray(zs, float), np.asarray(ys, float)
    i = int(np.nanargmax(ys))
    level = frac * ys[i]
    lo, hi = i, i
    while lo > 0 and ys[lo - 1] >= level:
        lo -= 1
    while hi < len(ys) - 1 and ys[hi + 1] >= level:
        hi += 1

    def cross(a, b):
        return zs[a] + (level - ys[a]) * (zs[b] - zs[a]) / (ys[b] - ys[a])

    return (cross(lo - 1, lo) if lo > 0 else None), (cross(hi, hi + 1) if hi < len(ys) - 1 else None)


def diffraction_mtf(lpmm, cutoff):
    nu = np.clip(np.asarray(lpmm, float) / cutoff, 0, 1)
    return (2 / np.pi) * (np.arccos(nu) - nu * np.sqrt(1 - nu ** 2))


# --------------------------------------------------------------------------
# plotting
# --------------------------------------------------------------------------

INK, INK2, MUTED, GRID, AXIS, SURFACE = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7", "#fcfcfb"
COLOR = {"V": "#2a78d6", "H": "#eb6834", "all": INK2}
LABEL = {"V": "vertical bars", "H": "horizontal bars", "all": "all bars"}
SEQ = LinearSegmentedColormap.from_list(
    "seq_blue", ["#f4f8fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"])


def style():
    plt.rcParams.update({
        "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
        "axes.edgecolor": AXIS, "axes.labelcolor": INK2, "text.color": INK,
        "xtick.color": MUTED, "ytick.color": MUTED, "xtick.labelcolor": INK2, "ytick.labelcolor": INK2,
        "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
        "axes.spines.top": False, "axes.spines.right": False,
        "axes.titlesize": 10, "axes.titlelocation": "left", "font.size": 9,
        "legend.frameon": False, "legend.fontsize": 8, "lines.linewidth": 2,
    })


def fig_focus_curve(zsum, best):
    zs = [e["z"] for e in zsum]
    fig, ax = plt.subplots(figsize=(8, 3.6))
    for key in ("all", "V", "H"):
        ys = [e[f"focus_{key}"] for e in zsum]
        ax.plot(zs, ys, "-o", color=COLOR[key], ms=4, lw=2 if key == "all" else 1.6,
                label=f"{LABEL[key]}  (best Z {best[key]:.4f})")
        ax.axvline(best[key], color=COLOR[key], ls=":", lw=1)
    ax.set_xlabel("focus position Z")
    ax.set_ylabel("focus score (mean MTF, g8-g9)")
    ax.set_ylim(0, 1.05)
    ax.set_title("Focus score across the sweep")
    ax.legend(loc="upper right")
    return fig


def fig_mtf(zsum, picks, px_per_mm, threshold, truth_on, na_cutoff):
    fig, axes = plt.subplots(1, len(picks), figsize=(4.4 * len(picks), 3.6), sharey=True, squeeze=False)
    nyq = px_per_mm / 2
    for ax, (title, entry) in zip(axes[0], picks):
        rows = [r for r in entry["rows"] if not np.isnan(r["mtf"])]
        ticks = sorted({(r["lp_mm"], r["group"], r["element"]) for r in rows})
        for o in ("V", "H"):
            rs = sorted((r for r in rows if r["orient"] == o), key=lambda r: r["lp_mm"])
            good = [r for r in rs if usable(r)]
            near = [r for r in rs if not usable(r)]
            if good:
                ax.plot([r["lp_mm"] for r in good], [r["mtf"] for r in good], "-o", color=COLOR[o], ms=5,
                        label=f"{LABEL[o]} measured")
            if near:
                ax.plot([r["lp_mm"] for r in near], [r["mtf"] for r in near], "o", ms=6, mfc="none",
                        mec=COLOR[o], mew=1.4)
            if truth_on and rs and all("true_mtf" in r for r in rs):
                ax.plot([r["lp_mm"] for r in rs], [r["true_mtf"] for r in rs], "--", color=COLOR[o], lw=1,
                        alpha=0.8, label=f"{LABEL[o]} true")
        if na_cutoff:
            xs = np.linspace(min(t[0] for t in ticks) * 0.9, nyq, 200)
            ax.plot(xs, diffraction_mtf(xs, na_cutoff), color=INK2, lw=1, label="diffraction limit")
        ax.axhline(threshold, color=MUTED, ls=":", lw=1)
        ax.text(ticks[0][0], threshold + 0.02, f"resolved >= {threshold:g}", color=INK2, fontsize=7)
        if ticks[-1][0] > NEAR_NYQUIST * px_per_mm:
            ax.axvspan(NEAR_NYQUIST * px_per_mm, nyq, color=GRID, alpha=0.6, lw=0)
            ax.text(NEAR_NYQUIST * px_per_mm, 1.07, " near Nyquist:\n not scored", color=INK2, fontsize=7,
                    va="top")
            ax.axvline(nyq, color=MUTED, lw=1)
        ax.set_xticks([t[0] for t in ticks])
        ax.set_xticklabels([f"g{t[1]}e{t[2]}\n{t[0]:.0f}" for t in ticks], fontsize=7)
        ax.set_xlabel("element / lp/mm")
        ax.set_ylim(0, 1.1)
        ax.set_title(title)
    axes[0][0].set_ylabel("MTF at bar frequency")
    handles, labels = axes[0][0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="lower center", ncol=len(labels), fontsize=8)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    return fig


def fig_heatmap(zsum):
    rows = [r for e in zsum for r in e["rows"] if not np.isnan(r["mtf"])]
    elems = sorted({(r["lp_mm"], r["group"], r["element"]) for r in rows})
    unscored = {(r["lp_mm"], r["group"], r["element"]) for r in rows if not usable(r)}
    zs = [e["z"] for e in zsum]
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.4), sharey=True)
    for ax, o in zip(axes, ("V", "H")):
        grid = np.full((len(elems), len(zs)), np.nan)
        for j, e in enumerate(zsum):
            for r in e["rows"]:
                if r["orient"] == o and not np.isnan(r["mtf"]):
                    grid[elems.index((r["lp_mm"], r["group"], r["element"])), j] = r["mtf"]
        im = ax.imshow(grid, cmap=SEQ, vmin=0, vmax=1, aspect="auto", interpolation="nearest")
        ax.grid(False)
        ax.set_xticks(range(len(zs)))
        ax.set_xticklabels([f"{z:.3f}" for z in zs], rotation=60, fontsize=7)
        ax.set_yticks(range(len(elems)))
        ax.set_yticklabels([f"g{g}e{e} ({lp:.0f})" + (" not scored" if (lp, g, e) in unscored else "")
                            for lp, g, e in elems], fontsize=7)
        ax.set_title(f"MTF per element - {LABEL[o]}")
        ax.set_xlabel("focus position Z")
    fig.colorbar(im, ax=axes, fraction=0.025, pad=0.02, label="MTF")
    return fig


def fig_validation(rows):
    fig, ax = plt.subplots(figsize=(4.2, 4))
    ax.plot([0, 1], [0, 1], color=AXIS, lw=1)
    for o in ("V", "H"):
        rs = [r for r in rows if r["orient"] == o and "true_mtf" in r and not np.isnan(r["mtf"])]
        good = [r for r in rs if usable(r)]
        near = [r for r in rs if not usable(r)]
        ax.plot([r["true_mtf"] for r in good], [r["mtf"] for r in good], "o", ms=4, color=COLOR[o],
                mec=SURFACE, mew=0.6, alpha=0.85, label=LABEL[o])
        ax.plot([r["true_mtf"] for r in near], [r["mtf"] for r in near], "o", ms=5, mfc="none",
                mec=COLOR[o], mew=1, label=f"{LABEL[o]}, near Nyquist" if near else None)
    ax.set_xlim(0, 1.02)
    ax.set_ylim(0, 1.02)
    ax.set_aspect("equal")
    ax.set_xlabel("true MTF (from the applied blur)")
    ax.set_ylabel("measured MTF")
    ax.set_title("Measured vs known answer")
    ax.legend(loc="upper left")
    return fig


def fig_patches(picks, px_per_mm):
    sets = []
    for title, entry in picks:
        rs = sorted((r for r in entry["rows"] if r["orient"] == "V" and "norm" in r), key=lambda r: r["lp_mm"])
        sets.append((title, rs))
    cols = max(len(rs) for _, rs in sets)
    fig, axes = plt.subplots(len(sets) + 1, cols, figsize=(1.25 * cols, 1.45 * (len(sets) + 1)), squeeze=False)
    for ax in axes.ravel():
        ax.axis("off")
    for j, r in enumerate(sets[0][1]):
        tmpl = render_element(r["group"], r["element"], px_per_mm, ANGLE["V"], r["norm"].shape)
        axes[0][j].imshow(tmpl, cmap="gray", vmin=0, vmax=1.2)
        axes[0][j].set_title(f"g{r['group']}e{r['element']}", fontsize=8)
    axes[0][0].text(-0.15, 0.5, "template", transform=axes[0][0].transAxes, ha="right", va="center", fontsize=8)
    for i, (title, rs) in enumerate(sets, start=1):
        for j, r in enumerate(rs):
            axes[i][j].imshow(r["norm"], cmap="gray", vmin=0, vmax=1.2)
            axes[i][j].set_title(f"MTF {r['mtf']:.2f}", fontsize=7, color=INK2)
        axes[i][0].text(-0.15, 0.5, title, transform=axes[i][0].transAxes, ha="right", va="center", fontsize=8)
    fig.tight_layout()
    return fig


def to_png(fig, path: Path) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    path.write_bytes(buf.getvalue())
    return base64.b64encode(buf.getvalue()).decode()


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------

def fmt_limit(r):
    return f"g{r['group']}e{r['element']} ({r['lp_mm']:.0f} lp/mm)" if r else "none"


def short_limit(r):
    return f"g{r['group']}e{r['element']}" if r else "none"


def fmt_range(lo, hi):
    a = f"{lo:.3f}" if lo is not None else "&lt; sweep"
    b = f"{hi:.3f}" if hi is not None else "&gt; sweep"
    return f"{a} - {b}"


CSS = """
:root { color-scheme: light; --surface:#fcfcfb; --page:#f9f9f7; --ink:#0b0b0b; --ink2:#52514e;
        --muted:#898781; --grid:#e1e0d9; --ring:rgba(11,11,11,.10); }
* { box-sizing: border-box; }
body { margin:0; background:var(--page); color:var(--ink);
       font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:1100px; margin:0 auto; padding:24px 16px 48px; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:16px; margin:32px 0 8px; }
.sub { color:var(--ink2); margin:0 0 20px; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
.tile { background:var(--surface); border:1px solid var(--ring); border-radius:10px; padding:12px 14px; }
.tile .k { color:var(--ink2); font-size:12px; } .tile .v { font-size:20px; font-weight:600; }
.tile .n { color:var(--muted); font-size:12px; }
figure { margin:12px 0; background:var(--surface); border:1px solid var(--ring); border-radius:10px; padding:12px; }
figure img { max-width:100%; height:auto; display:block; }
figcaption { color:var(--ink2); font-size:12px; margin-top:6px; }
.scroll { overflow-x:auto; }
table { border-collapse:collapse; font-size:12px; background:var(--surface); font-variant-numeric:tabular-nums; }
th, td { padding:4px 10px; border-bottom:1px solid var(--grid); text-align:right; white-space:nowrap; }
th:first-child, td:first-child { text-align:left; }
tr.best td { font-weight:600; background:#eef4fc; }
code { font-size:12px; } ul { padding-left:20px; color:var(--ink2); }
"""


def tile(k, v, n=""):
    return f'<div class="tile"><div class="k">{k}</div><div class="v">{v}</div><div class="n">{n}</div></div>'


def write_report(out: Path, rows, zsum, args, truth_on):
    style()
    sweep = len(zsum) > 1 and all(e["z"] is not None for e in zsum)
    imgs, tiles = {}, []

    if sweep:
        zs = [e["z"] for e in zsum]
        best = {k: peak_z(zs, [e[f"focus_{k}"] for e in zsum]) for k in ("all", "V", "H")}
        best_entry = zsum[int(np.nanargmax([e["focus_all"] for e in zsum]))]
        focus = np.array([e["focus_all"] for e in zsum])
        others = [i for i in range(len(zsum)) if zsum[i] is not best_entry]
        half_entry = zsum[min(others, key=lambda i: abs(focus[i] - 0.5 * np.nanmax(focus)))]
        picks = [(f"best focus  Z={best_entry['z']:.3f}", best_entry),
                 (f"half focus  Z={half_entry['z']:.3f}", half_entry)]
        lo, hi = range_above(zs, focus, 0.5)
        lim_v, lim_h = best_entry["limit_V"], best_entry["limit_H"]
        tiles += [
            tile("Best focus (all bars)", f"Z = {best['all']:.4f}",
                 f"focus score {np.nanmax(focus):.3f} at Z={best_entry['z']:.3f}"),
            tile("Astigmatism (V - H best Z)", f"{best['V'] - best['H']:+.4f}",
                 f"V {best['V']:.4f} &nbsp;/&nbsp; H {best['H']:.4f}"),
            tile("Focus range (score &ge; 50% of peak)", fmt_range(lo, hi),
                 f"width {hi - lo:.4f}" if lo is not None and hi is not None else "runs off the sweep"),
            tile("Resolution limit at best focus",
                 f"{short_limit(lim_v)} V / {short_limit(lim_h)} H",
                 f"MTF &ge; {args.mtf_threshold:g} and &ge; {args.detect_db:g} dB above noise"),
        ]
        imgs["focus"] = to_png(fig_focus_curve(zsum, best), out / "focus_curve.png")
        imgs["heat"] = to_png(fig_heatmap(zsum), out / "mtf_heatmap.png")
    else:
        best_entry = zsum[0]
        picks = [("all inputs", best_entry)]

    tiles.append(tile("Sensor sampling limit", f"{args.px_per_mm / 2:.0f} lp/mm",
                      f"Nyquist at {args.px_per_mm:g} px/mm; scored up to "
                      f"{NEAR_NYQUIST * args.px_per_mm:.0f} lp/mm"))
    if truth_on:
        err = np.array([r["mtf"] - r["true_mtf"] for r in rows if "true_mtf" in r and usable(r)])
        tiles.append(tile("Error vs known MTF", f"{np.sqrt(np.mean(err ** 2)):.3f} RMS",
                          f"bias {err.mean():+.3f}, worst {np.abs(err).max():.3f}, "
                          f"n={err.size} scored patches"))
        imgs["valid"] = to_png(fig_validation(rows), out / "validation.png")

    na_cutoff = (2 * args.na / (args.wavelength_nm * 1e-6)) if args.na else None
    imgs["mtf"] = to_png(fig_mtf(zsum, picks, args.px_per_mm, args.mtf_threshold, truth_on, na_cutoff),
                         out / "mtf_curves.png")
    imgs["patches"] = to_png(fig_patches(picks, args.px_per_mm), out / "patches.png")

    def figure(key, caption):
        return (f'<figure><img alt="{html.escape(caption)}" src="data:image/png;base64,{imgs[key]}">'
                f"<figcaption>{caption}</figcaption></figure>") if key in imgs else ""

    # per-Z table
    ztable = ""
    if sweep:
        trs = []
        for e in zsum:
            cls = ' class="best"' if e is best_entry else ""
            trs.append(f"<tr{cls}><td>{e['z']:.3f}</td><td>{e['focus_all']:.3f}</td><td>{e['focus_V']:.3f}</td>"
                       f"<td>{e['focus_H']:.3f}</td><td>{fmt_limit(e['limit_V'])}</td>"
                       f"<td>{fmt_limit(e['limit_H'])}</td></tr>")
        ztable = ("<h2>Focus score per Z</h2><div class='scroll'><table><tr><th>Z</th><th>focus (all)</th>"
                  "<th>focus V</th><th>focus H</th><th>limit V</th><th>limit H</th></tr>"
                  + "".join(trs) + "</table></div>")

    # per-element table at best focus
    erows = {}
    for r in best_entry["rows"]:
        erows.setdefault((r["lp_mm"], r["group"], r["element"]), {})[r["orient"]] = r
    trs = []
    for (lp, g, el), d in sorted(erows.items()):
        cells = [f"g{g}e{el}", f"{lp:.1f}", f"{lp / args.px_per_mm:.3f}"]
        for o in ("V", "H"):
            r = d.get(o)
            if r is None or np.isnan(r["mtf"]):
                cells += ["-", "-", r["status"] if r else "-"]
            else:
                cells += [f"{r['mtf']:.3f}", f"{r['detect_db']:.1f}", r["status"]]
            if truth_on:
                cells.append(f"{r['true_mtf']:.3f}" if r is not None and "true_mtf" in r else "-")
        trs.append("<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>")
    head = ["element", "lp/mm", "cyc/px"]
    for o in ("V", "H"):
        head += [f"MTF {o}", f"dB {o}", f"{o}"] + ([f"true {o}"] if truth_on else [])
    etitle = f"Per element at best focus (Z={best_entry['z']:.3f})" if sweep else "Per element"
    etable = (f"<h2>{etitle}</h2><div class='scroll'><table><tr>"
              + "".join(f"<th>{h}</th>" for h in head) + "</tr>" + "".join(trs) + "</table></div>")

    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>FFT Focus Report</title>
<style>{CSS}</style></head><body><main>
<h1>FFT focus report - USAF group 8/9</h1>
<p class="sub">{len(rows)} patches from <code>{html.escape(str(args.folder))}</code> at {args.px_per_mm:g} px/mm.
Focus score = mean MTF over the group 8/9 elements below {NEAR_NYQUIST:g} cycles/px
({NEAR_NYQUIST * args.px_per_mm:.0f} lp/mm); finer ones are shown but not scored.</p>
<div class="tiles">{''.join(tiles)}</div>
{figure("focus", "Mean MTF per Z. Dotted lines mark the parabola-refined best Z per orientation; "
                 "a gap between V and H is astigmatism.")}
{figure("mtf", "MTF at each element's bar frequency. Dashed = true MTF of the applied blur (synthetic data). "
               "Dotted line = resolved threshold.")}
{figure("heat", "MTF of every element at every Z. Finer elements narrow the in-focus band.")}
{figure("valid", "Each point is one patch. On the diagonal = the score recovers the known blur exactly.")}
{figure("patches", "Template (ideal element with pixel sampling) and the measured vertical-bar patches.")}
{ztable}
{etable}
<h2>Method</h2>
<ul>
<li>Patch normalised by its border (white) level{f" after subtracting black level {args.black:g}" if args.black else ""}, mean removed, Hann-windowed, FFT zero-padded {PAD}x.</li>
<li>Power summed in a disc of radius {DISC:g}&middot;f around &plusmn;the known bar frequency f (from group/element and px/mm).</li>
<li>Noise floor: median of the annulus {NOISE_BAND[0]:g}-{NOISE_BAND[1]:g}&middot;f outside the peak, / ln 2, subtracted.</li>
<li>Template: ideal 3-bar element at the same scale, angle and pixel sampling, through the same window and FFT.
MTF = sqrt((P<sub>patch</sub> - P<sub>noise</sub>) / P<sub>template</sub>).</li>
<li>Resolved: MTF &ge; {args.mtf_threshold:g} and patch power &ge; {args.detect_db:g} dB over the noise floor.
Both thresholds are starting points, not calibrated.</li>
</ul>
<p class="sub">All per-patch scores: <code>scores.csv</code> next to this file.</p>
</main></body></html>"""
    (out / "report.html").write_text(doc, encoding="utf-8")


# --------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Template-referenced FFT focus score for USAF group 8/9")
    ap.add_argument("folder", type=Path, help="folder of patches named like g8e3_V_Z61_870.png")
    ap.add_argument("--px-per-mm", type=float, required=True, help="image scale in object space")
    ap.add_argument("--out", type=Path, default=None, help="report folder (default <folder>/report)")
    ap.add_argument("--mtf-threshold", type=float, default=0.15, help="MTF needed to call an element resolved")
    ap.add_argument("--detect-db", type=float, default=6.0, help="power over noise needed to call it resolved")
    ap.add_argument("--black", type=float, default=0.0, help="camera black level, as a fraction of full scale")
    ap.add_argument("--na", type=float, default=None, help="objective NA: adds the diffraction-limited MTF")
    ap.add_argument("--wavelength-nm", type=float, default=550.0, help="wavelength for --na (default 550)")
    args = ap.parse_args(argv)

    files = sorted(p for p in args.folder.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
    truth = load_truth(args.folder)
    rows, skipped = [], 0
    for path in files:
        meta = parse_name(path.name)
        if meta is None:
            skipped += 1
            continue
        group, element, orient, z = meta
        row = score_patch(load_gray(path), group, element, orient, args.px_per_mm, args.black)
        row.setdefault("status", "resolved" if row["mtf"] >= args.mtf_threshold
                       and row["detect_db"] >= args.detect_db else "unresolved")
        row.update(file=path.name, z=z)
        if path.name in truth:
            row["true_mtf"] = truth[path.name]
        rows.append(row)
    if not rows:
        print(f"no patches named like g8e3_V_Z61_870.png in {args.folder}")
        return 2
    if skipped:
        print(f"skipped {skipped} files without a g<G>e<E>_<V|H> tag")

    out = args.out or args.folder / "report"
    out.mkdir(parents=True, exist_ok=True)
    cols = ["file", "z", "group", "element", "orient", "lp_mm", "f_cpx", "mtf", "detect_db", "status"]
    truth_on = any("true_mtf" in r for r in rows)
    if truth_on:
        cols.append("true_mtf")
    with (out / "scores.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    zsum = summarize_z(rows)
    print(f"{'Z':>8s} {'focus':>7s} {'V':>7s} {'H':>7s}  limit V / limit H")
    for e in zsum:
        z = f"{e['z']:.3f}" if e["z"] is not None else "-"
        print(f"{z:>8s} {e['focus_all']:7.3f} {e['focus_V']:7.3f} {e['focus_H']:7.3f}  "
              f"{fmt_limit(e['limit_V'])} / {fmt_limit(e['limit_H'])}")

    write_report(out, rows, zsum, args, truth_on)
    print(f"report: {out / 'report.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
