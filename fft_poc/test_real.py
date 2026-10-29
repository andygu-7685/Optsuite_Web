"""Known-answer tests for fft_scoring.py on real frames, with no new hardware.

validate_fft_scoring.py proves the maths on synthetic patches. These check the
things synthetic patches cannot: real noise, real illumination falloff, a real
negative target, bars packed next to their neighbours, and a grid placed by the
actual registration rather than by construction.

The reason this works without a zoomed capture is that the scorer only ever
sees cycles per pixel. At the 404 px/mm these frames were taken at, g6e1..g7e3
span 0.16-0.40 cyc/px -- which is the same band g8e1..g8e6 occupies in a 1140
px/mm capture. Group 8 is already here under a different name; only group 9
needs the magnification (`regime` prints the mapping).

    regime   which element here stands in for which element zoomed
    blur     inject a known blur, check the MTF drops by exactly that much
    ladder   MTF must fall with frequency, on every frame
    jitter   how much a few px of registration error moves the answer
    limit    resolution limit vs the answer in the filename

    python fft_poc/test_real.py
    python fft_poc/test_real.py --only blur ladder --images path/to/frame.png
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "fft_poc"))

from calibrate_scale import DEFAULT_IMAGES, grid_for  # noqa: E402
from usaf_registration import UsafRegistration, fft_scoring as fs  # noqa: E402

LABEL_RE = re.compile(r"g(\d)e([1-6])", re.IGNORECASE)
SIGMAS = (0.8, 1.5, 2.5)
JITTER = 2                  # +/- px on both scanline endpoints
MIN_MTF_FOR_RATIO = 0.25    # below this the blur ratio is noise over noise


def scored_frame(path, blur_sigma=0.0, offset=(0, 0)):
    """Every element of one frame, scored. Returns (rows, meta)."""
    reg = UsafRegistration()
    gray, cx, cy, angle, side = grid_for(reg, path)
    if blur_sigma > 0:
        k = 2 * int(4 * blur_sigma) + 1
        gray = cv2.GaussianBlur(gray, (k, k), sigmaX=blur_sigma, sigmaY=blur_sigma,
                                borderType=cv2.BORDER_REFLECT)
    white = fs.frame_white_level(gray)
    ppm = fs.px_per_mm_from_side_length(side, reg.C.G1)

    # Both orientations, the way the pipeline scores them: indices 0..n-1 are one
    # set of scanlines and n..2n-1 the other. Scoring only the first set hides
    # astigmatism, and on a tilted target that is most of what there is to see.
    unique_count = len(reg.C.score_table)
    rows = []
    for j in range(2 * unique_count):
        g, e = reg.C.score_table[j % unique_count]
        pa = reg.usaf_point_to_screen(reg.C.group_positions[2 * j], cx, cy, angle, side)
        pb = reg.usaf_point_to_screen(reg.C.group_positions[2 * j + 1], cx, cy, angle, side)
        pa = (pa[0] + offset[0], pa[1] + offset[1])
        pb = (pb[0] + offset[0], pb[1] + offset[1])
        row = fs.score_element(gray, pa, pb, g, e, ppm, white_level=white)
        row["index"] = j
        row["orientation"] = "first" if j < unique_count else "second"
        rows.append(row)
    return rows, {"px_per_mm": ppm, "side": side, "g1": reg.C.G1}


def gaussian_transfer(sigma, f, angle_deg):
    """Exact transfer of the discrete separable kernel OpenCV actually applies,
    at the bar frequency vector. Avoids charging kernel truncation to the optics."""
    k = 2 * int(4 * sigma) + 1
    kern = cv2.getGaussianKernel(k, sigma).ravel()
    n = np.arange(k) - k // 2
    fx, fy = f * np.cos(np.radians(angle_deg)), f * np.sin(np.radians(angle_deg))
    return float((kern * np.cos(2 * np.pi * fx * n)).sum()
                 * (kern * np.cos(2 * np.pi * fy * n)).sum())


def usable(rows):
    return [r for r in rows if r["status"] in ("resolved", "unresolved")]


# Not a verdict about the optics: the element could not be measured here at all,
# so the walk steps over it rather than stopping. The coarsest element hits this
# routinely -- 4 periods of a 90 px period is past MAX_PATCH_PX.
UNMEASURABLE = ("patch too small", "patch off image", "no contrast", "no template")


def resolution_limit(rows, threshold):
    """Finest element at or above threshold with every coarser measured one too."""
    last = None
    for r in sorted(rows, key=lambda r: r["f_cpx"]):
        if r["status"] in UNMEASURABLE:
            continue
        if r["status"] not in ("resolved", "unresolved") or not np.isfinite(r["mtf"]):
            break
        if r["mtf"] < threshold:
            break
        last = r
    return last


def elem_distance(a, b):
    return (a[0] * 6 + a[1] - 1) - (b[0] * 6 + b[1] - 1)


def report(name, value, limit, unit=""):
    ok = np.isfinite(value) and value <= limit
    print(f"  {name:<36s} {value:7.4f}{unit}  (limit {limit:g}{unit})  {'PASS' if ok else 'FAIL'}")
    return ok


# --------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------

def check_regime(images):
    """Which element in these frames stands in for which element zoomed."""
    _rows, meta = scored_frame(images[0])
    ppm = meta["px_per_mm"]
    print(f"  {Path(images[0]).name} is {ppm:.0f} px/mm; a group 8/9 capture is ~1140\n")
    print(f"  {'here':>6s} {'cyc/px':>7s} {'px/lp':>6s}   {'stands in for':>14s} {'cyc/px':>7s}")
    covered = 0
    for group in (8, 9):
        for element in range(1, 7):
            target = fs.lp_per_mm(group, element) / 1140.0
            # the element of these frames landing closest in cycles/px
            best = min(((g, e) for g in range(2, 8) for e in range(1, 7)),
                       key=lambda ge: abs(fs.lp_per_mm(*ge) / ppm - target))
            here = fs.lp_per_mm(*best) / ppm
            hit = abs(here - target) < 0.02 and here < fs.NEAR_NYQUIST
            covered += hit
            print(f"  g{best[0]}e{best[1]:<3d} {here:7.3f} {1 / here:6.2f}   "
                  f"{'g%de%d' % (group, element):>14s} {target:7.3f}  {'yes' if hit else '-'}")
    print(f"\n  {covered}/12 of group 8+9 already covered below the near-Nyquist guard")
    return covered >= 6


def check_blur(images):
    """Inject a known blur: the MTF has to drop by exactly the kernel's transfer.

    This is the strongest known-answer test available on real frames, because
    the ratio of blurred to sharp cancels the optics, the illumination and the
    target's own contrast -- whatever they are, only the injected blur is left.
    """
    errs, n = [], 0
    print(f"  {'frame':<24s} {'sigma':>6s} {'n':>3s} {'rms(ratio-pred)':>16s} {'max':>7s}")
    for path in images:
        try:
            sharp, _ = scored_frame(path)
        except Exception as exc:                                  # noqa: BLE001
            print(f"  {Path(path).name[:24]:<24s} skipped: {exc}")
            continue
        base = {r["index"]: r for r in usable(sharp) if r["mtf"] >= MIN_MTF_FOR_RATIO}
        for sigma in SIGMAS:
            blurred, _ = scored_frame(path, blur_sigma=sigma)
            per_sigma = []
            for r in usable(blurred):
                b = base.get(r["index"])
                if b is None or b["mtf"] <= 0:
                    continue
                pred = gaussian_transfer(sigma, r["f_cpx"], r["angle_deg"])
                if pred < 0.05:          # fully blurred away: ratio is noise
                    continue
                per_sigma.append(r["mtf"] / b["mtf"] - pred)
            if per_sigma:
                errs += per_sigma
                n += len(per_sigma)
                print(f"  {Path(path).name[:24]:<24s} {sigma:6.1f} {len(per_sigma):3d} "
                      f"{np.sqrt(np.mean(np.square(per_sigma))):16.4f} "
                      f"{np.max(np.abs(per_sigma)):7.4f}")
    if not errs:
        print("  no usable elements")
        return False
    print(f"  {n} element/sigma pairs")
    return report("rms(measured ratio - predicted)", float(np.sqrt(np.mean(np.square(errs)))), 0.12)


def check_ladder(images):
    """A real MTF curve falls with frequency. Rises mean the scale, the grid or
    the neighbouring element is leaking in."""
    # The max over ~150 noisy differences is the max of a noise distribution, so
    # a single large rise proves nothing. What would show a broken scale or grid
    # is rises being common.
    big, total = 0, 0
    print(f"  {'frame':<24s} {'n':>3s} {'max rise':>9s} {'>0.10':>6s}  where")
    for path in images:
        try:
            rows, _ = scored_frame(path)
        except Exception as exc:                                  # noqa: BLE001
            print(f"  {Path(path).name[:24]:<24s} skipped: {exc}")
            continue
        # Per orientation: the two sets are different scanlines through different
        # blocks, so interleaving them by frequency would invent rises.
        rises = []
        rs = []
        for orientation in ("first", "second"):
            side_rows = sorted((r for r in usable(rows) if np.isfinite(r["mtf"])
                                and r["orientation"] == orientation),
                               key=lambda r: r["f_cpx"])
            rs += side_rows
            rises += [(b["mtf"] - a["mtf"],
                       f"g{a['group']}e{a['element']}->g{b['group']}e{b['element']}")
                      for a, b in zip(side_rows, side_rows[1:])]
        n_big = sum(1 for d, _ in rises if d > 0.10)
        big, total = big + n_big, total + len(rises)
        worst = max(rises, default=(0.0, ""))
        print(f"  {Path(path).name[:24]:<24s} {len(rs):3d} {worst[0]:9.4f} {n_big:6d}  {worst[1]}")
    return report("fraction of adjacent pairs rising >0.10", big / max(total, 1), 0.10)


def check_jitter(images, decision_floor=0.10):
    """How much a few pixels of registration error move the MTF.

    Only where it can change the answer. An element reading 0.003 is called
    unresolved however it wobbles, and its relative spread is noise over noise;
    what matters is the elements sitting near the resolved threshold.
    """
    spreads = []
    print(f"  {'frame':<24s} {'elem':>6s} {'mean':>6s} {'cv':>6s}")
    for path in images[:3]:
        try:
            base, _ = scored_frame(path)
        except Exception as exc:                                  # noqa: BLE001
            print(f"  {Path(path).name[:24]:<24s} skipped: {exc}")
            continue
        targets = [r["index"] for r in usable(base)
                   if np.isfinite(r["mtf"]) and r["mtf"] >= decision_floor][-4:]
        runs = {i: [] for i in targets}
        for dx in (-JITTER, 0, JITTER):
            for dy in (-JITTER, 0, JITTER):
                rows, _ = scored_frame(path, offset=(dx, dy))
                for r in rows:
                    if r["index"] in runs and np.isfinite(r["mtf"]):
                        runs[r["index"]].append(r["mtf"])
        for i in targets:
            vals = np.asarray(runs[i])
            if vals.size < 4 or vals.mean() <= 0:
                continue
            cv = float(vals.std() / vals.mean())
            spreads.append(cv)
            row = next(r for r in base if r["index"] == i)
            print(f"  {Path(path).name[:24]:<24s} g{row['group']}e{row['element']:<3d} "
                  f"{vals.mean():6.3f} {cv:6.3f}")
    if not spreads:
        return False
    return report(f"median CV over +/-{JITTER} px", float(np.median(spreads)), 0.25)


def check_limit(images, threshold):
    """FFT resolution limit vs the answer the filename carries.

    Both orientations go into one walk, so this is the "min" reading the
    pipeline uses by default: the limit is set by whichever orientation fails
    first. The filename label is someone's expectation rather than ground truth
    -- the check is that the walk produces an answer at all, and the distance to
    the label is reported for calibration, not asserted on. check_pipeline is
    what compares the FFT against the pipeline's own answer.
    """
    print(f"  {'frame':<30s} {'label':>6s} {'fft':>6s} {'diff':>5s}  (elements finer)")
    diffs, found = [], 0
    for path in images:
        m = LABEL_RE.search(Path(path).name)
        try:
            rows, _ = scored_frame(path)
        except Exception as exc:                                  # noqa: BLE001
            print(f"  {Path(path).name[:30]:<30s} skipped: {exc}")
            continue
        lim = resolution_limit(rows, threshold)
        found += lim is not None
        got = f"g{lim['group']}e{lim['element']}" if lim else "none"
        if m and lim:
            d = elem_distance((lim["group"], lim["element"]), (int(m.group(1)), int(m.group(2))))
            diffs.append(d)
            print(f"  {Path(path).name[:30]:<30s} {m.group(0):>6s} {got:>6s} {d:+5d}")
        else:
            print(f"  {Path(path).name[:30]:<30s} {'-':>6s} {got:>6s} {'-':>5s}")
    if diffs:
        print(f"  vs the filename label: {np.mean(diffs):+.1f} elements on average "
              f"(range {min(diffs):+d} to {max(diffs):+d})")
    print(f"  resolution limit found on {found}/{len(images)} frames")
    return found == len(images)


def check_pipeline(images):
    """End to end through score_image_routine, FFT off then on.

    Two things have to hold for the wiring to be safe: with FFT_SCORING off the
    answer is exactly what it was before, and with it on the answer only ever
    moves finer (FFT_EXTEND_ONLY).
    """
    print(f"  {'frame':<30s} {'fft off':>8s} {'fft on':>8s} {'diff':>5s}")
    ok, moved = True, []
    for path in images:
        answers = []
        for enabled in (False, True):
            reg = UsafRegistration()
            reg.C.FFT_SCORING = enabled
            try:
                result = reg.score_image_routine(path)
            except Exception as exc:                              # noqa: BLE001
                print(f"  {Path(path).name[:30]:<30s} raised: {exc}")
                answers.append(None)
                continue
            answers.append(tuple(result[0]) if result and result[0] else None)

        off, on = answers
        if off is None or on is None:
            print(f"  {Path(path).name[:30]:<30s} {str(off):>8s} {str(on):>8s} "
                  f"{'-':>5s}   no answer")
            ok = ok and off == on
            continue
        d = elem_distance(on, off)
        moved.append(d)
        if d < 0:
            ok = False
        print(f"  {Path(path).name[:30]:<30s} {'g%de%d' % off:>8s} {'g%de%d' % on:>8s} {d:+5d}"
              + ("   COARSER" if d < 0 else ""))
    if moved:
        print(f"  FFT moved the answer {np.mean(moved):+.1f} elements on average "
              f"({sum(1 for d in moved if d > 0)}/{len(moved)} frames finer)")
    print(f"  never coarser with FFT on: {'yes' if ok else 'NO'}")
    return ok


CHECKS = {"regime": check_regime, "blur": check_blur, "ladder": check_ladder,
          "jitter": check_jitter, "limit": check_limit, "pipeline": check_pipeline}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", nargs="+", choices=sorted(CHECKS), default=sorted(CHECKS))
    ap.add_argument("--images", nargs="+", default=None)
    ap.add_argument("--mtf-threshold", type=float, default=fs.MTF_THRESHOLD)
    args = ap.parse_args(argv)

    images = args.images or [str(ROOT / p) for p in DEFAULT_IMAGES]
    images = [p for p in images if Path(p).exists()]
    if not images:
        print("no images found")
        return 2

    results = {}
    for name in args.only:
        print(f"\n[{name}]")
        fn = CHECKS[name]
        results[name] = bool(fn(images, args.mtf_threshold) if name == "limit" else fn(images))

    print("\n" + "-" * 56)
    for name, ok in results.items():
        print(f"  {name:<10s} {'PASS' if ok else 'FAIL'}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
