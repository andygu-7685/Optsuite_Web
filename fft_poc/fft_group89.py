"""FFT proof of concept for USAF group 8 / 9 bar patterns.

Standalone: nothing in usaf_registration/ is imported or modified. Reads images
(or folders of images), runs a windowed 2D FFT on a crop, and reports the
dominant bar frequency plus how far that peak sits above the local noise floor.
That peak-to-noise ratio is the "is this element resolved" signal -- it keeps
working at group 8/9 where the scanline min/max contrast collapses into noise.

Usage:

    python fft_poc/fft_group89.py path/to/g8_crops            # folder
    python fft_poc/fft_group89.py img.png --roi 740,360,80,80 # one ROI
    python fft_poc/fft_group89.py folder --px-per-mm 1140     # name the element
    python fft_poc/fft_group89.py folder --summary --save out

Only numpy + matplotlib are required; OpenCV/Pillow are used for loading if
present (matplotlib alone handles PNG).
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}

# USAF 1951: group g, element e resolves 2 ** (g + (e - 1) / 6) line pairs/mm.
GROUPS_OF_INTEREST = (8, 9)


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------

def load_gray(path: Path) -> np.ndarray:
    """Return the image as float32 grayscale in [0, 1]."""
    img = None
    try:
        import cv2

        img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    except ImportError:
        pass

    if img is None:
        img = plt.imread(str(path))  # PNG works without any extra dependency

    img = np.asarray(img)
    if img.ndim == 3:
        img = img[..., :3].mean(axis=2)
    img = img.astype(np.float32)
    if img.max() > 1.0:
        img /= 255.0
    return img


def collect_images(paths) -> list[Path]:
    out: list[Path] = []
    for raw in paths:
        p = Path(raw)
        if p.is_dir():
            out.extend(sorted(c for c in p.rglob("*") if c.suffix.lower() in IMAGE_SUFFIXES))
        elif p.is_file():
            out.append(p)
        else:
            out.extend(sorted(Path().glob(raw)))
    return out


def crop(img: np.ndarray, roi, roi_frac) -> np.ndarray:
    h, w = img.shape
    if roi_frac is not None:
        fx, fy, fw, fh = roi_frac
        roi = (fx * w, fy * h, fw * w, fh * h)
    if roi is None:
        return img
    x, y, cw, ch = (int(round(v)) for v in roi)
    x, y = max(0, x), max(0, y)
    out = img[y:y + ch, x:x + cw]
    if out.size == 0:
        raise ValueError(f"empty ROI {roi} for image of shape {img.shape}")
    return out


# --------------------------------------------------------------------------
# USAF bookkeeping
# --------------------------------------------------------------------------

def lp_per_mm(group: int, element: int) -> float:
    return float(2.0 ** (group + (element - 1) / 6.0))


def nearest_element(lpmm: float):
    """Closest (group, element) to a measured line-pair frequency."""
    if lpmm <= 0:
        return None
    steps = round(np.log2(lpmm) * 6.0)
    group, offset = divmod(int(steps), 6)
    return group, offset + 1


# --------------------------------------------------------------------------
# FFT core
# --------------------------------------------------------------------------

def radial_stats(power: np.ndarray, radius: np.ndarray, nbins: int):
    """Mean and median power per radial bin, plus the bin centres."""
    edges = np.linspace(0.0, 0.5, nbins + 1)
    idx = np.clip(np.digitize(radius.ravel(), edges) - 1, 0, nbins - 1)
    flat = power.ravel()
    counts = np.bincount(idx, minlength=nbins)
    sums = np.bincount(idx, weights=flat, minlength=nbins)
    mean = np.where(counts > 0, sums / np.maximum(counts, 1), 0.0)

    order = np.argsort(idx, kind="stable")
    median = np.zeros(nbins)
    start = 0
    for k, n in enumerate(counts):
        if n:
            median[k] = np.median(flat[order[start:start + n]])
            start += n
    # Bins the grid never reaches (the corners aside) fall back to the mean.
    median = np.where(counts > 0, median, mean)
    return 0.5 * (edges[:-1] + edges[1:]), mean, median


def analyze(patch: np.ndarray, min_cycles: float = 2.5, dc_guard: int = 2,
            fmin: float | None = None, fmax: float | None = None) -> dict:
    """Windowed 2D FFT of one patch.

    The bar peak is picked from the spectrum *normalised by its own radial
    median background*, so the broad low-frequency lobe of the bar block (and
    any illumination gradient) cannot masquerade as the bar pitch. That same
    normalisation is the reported peak-over-noise ratio.
    """
    patch = patch - patch.mean()
    h, w = patch.shape
    window = np.outer(np.hanning(h), np.hanning(w))
    spec = np.fft.fftshift(np.fft.fft2(patch * window))
    power = np.abs(spec) ** 2

    fy = np.fft.fftshift(np.fft.fftfreq(h))
    fx = np.fft.fftshift(np.fft.fftfreq(w))
    fxx, fyy = np.meshgrid(fx, fy)
    radius = np.hypot(fxx, fyy)

    nbins = max(8, min(h, w) // 2)
    radial_f, radial, background = radial_stats(power, radius, nbins)
    floor_2d = np.interp(radius, radial_f, np.maximum(background, 1e-20))
    normalised = power / floor_2d

    # Ignore DC and the few bins around it: a defocused patch is nearly all DC.
    low_cut = max(min_cycles / min(h, w), dc_guard / min(h, w), fmin or 0.0)
    searchable = (radius > low_cut) & (radius < (fmax if fmax else 0.5))
    if not searchable.any():
        searchable = radius > low_cut

    high_cut = min(0.5, fmax) if fmax else 0.5

    masked = np.where(searchable, normalised, 0.0)
    iy, ix = np.unravel_index(int(np.argmax(masked)), masked.shape)

    # 3x3 centroid for a sub-bin estimate of the peak location.
    y0, y1 = max(0, iy - 1), min(h, iy + 2)
    x0, x1 = max(0, ix - 1), min(w, ix + 2)
    block = power[y0:y1, x0:x1]
    total = block.sum()
    if total > 0:
        fy_peak = float((fyy[y0:y1, x0:x1] * block).sum() / total)
        fx_peak = float((fxx[y0:y1, x0:x1] * block).sum() / total)
    else:
        fy_peak, fx_peak = float(fyy[iy, ix]), float(fxx[iy, ix])

    f_peak = float(np.hypot(fx_peak, fy_peak))
    angle = float(np.degrees(np.arctan2(fy_peak, fx_peak)) % 180.0)
    snr_db = 10.0 * np.log10(max(normalised[iy, ix], 1e-20))

    # Intensity profile across the bars (average along the bar direction).
    ny, nx = np.sin(np.radians(angle)), np.cos(np.radians(angle))
    yy, xx = np.mgrid[0:h, 0:w]
    projected = xx * nx + yy * ny
    nsteps = int(max(16, min(h, w)))
    pbins = np.clip(
        ((projected - projected.min()) / (np.ptp(projected) + 1e-9) * (nsteps - 1)).astype(int),
        0, nsteps - 1,
    )
    pcount = np.bincount(pbins.ravel(), minlength=nsteps)
    psum = np.bincount(pbins.ravel(), weights=patch.ravel(), minlength=nsteps)
    profile = np.where(pcount > 0, psum / np.maximum(pcount, 1), 0.0)

    return {
        "power": power,
        "fx": fx,
        "fy": fy,
        "f_peak": f_peak,
        "angle_deg": angle,
        "period_px": (1.0 / f_peak) if f_peak > 0 else float("inf"),
        "snr_db": snr_db,
        "radial_f": radial_f,
        "radial": radial,
        "background": background,
        "profile": profile,
        "low_cut": low_cut,
        "high_cut": high_cut,
    }


# --------------------------------------------------------------------------
# plotting
# --------------------------------------------------------------------------

def expected_lines(ax, px_per_mm: float, horizontal: bool = False):
    """Mark where group 8 and 9 elements would land on a cycles/pixel axis."""
    colors = {8: "tab:orange", 9: "tab:red"}
    for group in GROUPS_OF_INTEREST:
        for element in range(1, 7):
            f = lp_per_mm(group, element) / px_per_mm
            if f > 0.5:
                continue
            draw = ax.axhline if horizontal else ax.axvline
            draw(f, color=colors[group], alpha=0.35, lw=0.8,
                 label=f"group {group}" if element == 1 else None)


def plot_one(name: str, patch: np.ndarray, res: dict, px_per_mm, threshold_db: float):
    fig, axes = plt.subplots(2, 2, figsize=(10.5, 8.5), num=f"FFT PoC - {name}")
    fig.suptitle(name, fontsize=11)

    ax = axes[0, 0]
    ax.imshow(patch, cmap="gray")
    ax.set_title(f"patch {patch.shape[1]}x{patch.shape[0]} px")
    ax.axis("off")

    ax = axes[0, 1]
    extent = [res["fx"][0], res["fx"][-1], res["fy"][-1], res["fy"][0]]
    ax.imshow(np.log10(res["power"] + 1e-12), cmap="magma", extent=extent, origin="upper")
    theta = np.radians(res["angle_deg"])
    for sign in (1, -1):
        ax.plot(sign * res["f_peak"] * np.cos(theta), sign * res["f_peak"] * np.sin(theta),
                "o", mfc="none", mec="cyan", ms=12, mew=1.4)
    ax.set_title("log power spectrum (peak circled)")
    ax.set_xlabel("fx [cycles/px]")
    ax.set_ylabel("fy [cycles/px]")

    ax = axes[1, 0]
    ax.semilogy(res["radial_f"], res["radial"] + 1e-12, color="tab:blue", lw=1.2, label="mean power")
    ax.semilogy(res["radial_f"], res["background"] + 1e-12, color="0.5", lw=1.0, ls="--",
                label="radial median (noise floor)")
    ax.axvline(res["f_peak"], color="cyan", lw=1.2, label=f"peak {res['f_peak']:.4f} c/px")
    ax.axvspan(0, res["low_cut"], color="0.85", label="excluded from peak search")
    if res["high_cut"] < 0.5:
        ax.axvspan(res["high_cut"], 0.5, color="0.85")
    if px_per_mm:
        expected_lines(ax, px_per_mm)
    ax.set_xlim(0, 0.5)
    ax.set_xlabel("spatial frequency [cycles/px]")
    ax.set_ylabel("radially averaged power")
    ax.set_title("radial power profile")
    ax.legend(fontsize=7, loc="upper right")
    ax.grid(alpha=0.3)

    ax = axes[1, 1]
    ax.plot(res["profile"], color="tab:green", lw=1.2)
    verdict = "RESOLVED" if res["snr_db"] >= threshold_db else "unresolved"
    label = (f"period {res['period_px']:.2f} px @ {res['angle_deg']:.1f} deg\n"
             f"peak/noise {res['snr_db']:.1f} dB -> {verdict}")
    if px_per_mm:
        lpmm = res["f_peak"] * px_per_mm
        ge = nearest_element(lpmm)
        label += f"\n{lpmm:.0f} lp/mm"
        if ge:
            label += f"  (closest: group {ge[0]} element {ge[1]})"
    ax.set_title(label, fontsize=9)
    ax.set_xlabel("position across bars [bin]")
    ax.set_ylabel("mean intensity (DC removed)")
    ax.grid(alpha=0.3)

    fig.tight_layout(rect=[0, 0, 1, 0.95])
    return fig


Z_RE = re.compile(r"[Zz](\d+)_(\d+)")


def z_from_name(name: str):
    m = Z_RE.search(name)
    return float(f"{m.group(1)}.{m.group(2)}") if m else None


def plot_summary(rows, threshold_db: float):
    zs = [z_from_name(r["name"]) for r in rows]
    use_z = all(z is not None for z in zs) and len(set(zs)) > 1

    fig, ax = plt.subplots(figsize=(10, 5), num="FFT PoC - summary")
    snrs = [r["snr_db"] for r in rows]
    if use_z:
        order = np.argsort(zs)
        ax.plot([zs[i] for i in order], [snrs[i] for i in order], "o-", color="tab:blue")
        ax.set_xlabel("focus position Z (parsed from filename)")
    else:
        ax.bar(range(len(rows)), snrs, color="tab:blue")
        ax.set_xticks(range(len(rows)))
        ax.set_xticklabels([r["name"] for r in rows], rotation=60, ha="right", fontsize=7)
    ax.axhline(threshold_db, color="tab:red", ls="--", lw=1, label=f"{threshold_db:g} dB threshold")
    ax.set_ylabel("bar peak over noise floor [dB]")
    ax.set_title("FFT modulation of the group 8/9 patch")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    return fig


# --------------------------------------------------------------------------
# cli
# --------------------------------------------------------------------------

def float_list(text: str):
    return [float(v) for v in text.replace(" ", "").split(",")]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="FFT PoC for USAF group 8/9 bar patterns")
    ap.add_argument("paths", nargs="+", help="image files, folders, or globs")
    ap.add_argument("--roi", type=float_list, default=None, metavar="X,Y,W,H",
                    help="crop in pixels before the FFT")
    ap.add_argument("--roi-frac", type=float_list, default=None, metavar="X,Y,W,H",
                    help="crop as fractions of the image size, e.g. 0.4,0.4,0.2,0.2")
    ap.add_argument("--px-per-mm", type=float, default=None,
                    help="image scale; enables lp/mm and group/element readout")
    ap.add_argument("--expect", type=int, nargs="+", default=None, metavar="GROUP",
                    help="restrict the search to these groups' frequencies (needs --px-per-mm), "
                         "e.g. --expect 8 9")
    ap.add_argument("--band", type=float_list, default=None, metavar="FMIN,FMAX",
                    help="restrict the search to this cycles/px band")
    ap.add_argument("--threshold-db", type=float, default=15.0,
                    help="peak-over-noise needed to call a pattern resolved (default 15)")
    ap.add_argument("--summary", action="store_true",
                    help="also plot the metric across all inputs (vs Z when the filename has it)")
    ap.add_argument("--save", metavar="DIR", default=None, help="write PNGs here instead of only showing")
    ap.add_argument("--no-show", action="store_true", help="do not open plot windows")
    ap.add_argument("--max-figures", type=int, default=12, help="cap on per-image figures (default 12)")
    args = ap.parse_args(argv)

    for spec in (args.roi, args.roi_frac):
        if spec is not None and len(spec) != 4:
            ap.error("--roi/--roi-frac take exactly four comma-separated numbers")

    fmin = fmax = None
    if args.band is not None:
        if len(args.band) != 2:
            ap.error("--band takes exactly two comma-separated numbers")
        fmin, fmax = args.band
    elif args.expect:
        if not args.px_per_mm:
            ap.error("--expect needs --px-per-mm")
        # One element of slack on either side of the requested groups.
        lo = min(lp_per_mm(g, 1) for g in args.expect) / 2 ** (1 / 6)
        hi = max(lp_per_mm(g, 6) for g in args.expect) * 2 ** (1 / 6)
        fmin, fmax = lo / args.px_per_mm, hi / args.px_per_mm
        print(f"search band {fmin:.4f}..{fmax:.4f} cycles/px "
              f"({lo:.0f}..{hi:.0f} lp/mm for groups {args.expect})")

    images = collect_images(args.paths)
    if not images:
        print("no images found")
        return 2

    out_dir = Path(args.save) if args.save else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    print(f"{'image':46s} {'period_px':>9s} {'angle':>7s} {'cyc/px':>8s} {'dB':>7s}  verdict")
    for n, path in enumerate(images):
        patch = crop(load_gray(path), args.roi, args.roi_frac)
        res = analyze(patch, fmin=fmin, fmax=fmax)
        rows.append({"name": path.name, "snr_db": res["snr_db"], **res})

        verdict = "resolved" if res["snr_db"] >= args.threshold_db else "unresolved"
        extra = ""
        # Below threshold the peak is noise, so naming an element would be fiction.
        if args.px_per_mm and res["snr_db"] >= args.threshold_db:
            lpmm = res["f_peak"] * args.px_per_mm
            ge = nearest_element(lpmm)
            extra = f"  {lpmm:7.1f} lp/mm" + (f"  g{ge[0]}e{ge[1]}" if ge else "")
        print(f"{path.name[:46]:46s} {res['period_px']:9.2f} {res['angle_deg']:7.1f} "
              f"{res['f_peak']:8.4f} {res['snr_db']:7.1f}  {verdict}{extra}")

        if n < args.max_figures:
            fig = plot_one(path.name, patch, res, args.px_per_mm, args.threshold_db)
            if out_dir:
                fig.savefig(out_dir / f"fft_{path.stem}.png", dpi=130)
            if args.no_show:
                plt.close(fig)

    if args.summary and len(rows) > 1:
        fig = plot_summary(rows, args.threshold_db)
        if out_dir:
            fig.savefig(out_dir / "fft_summary.png", dpi=130)
        if args.no_show:
            plt.close(fig)

    if not args.no_show:
        plt.show()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
