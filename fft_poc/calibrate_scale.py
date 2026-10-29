"""Calibrate fft_scoring.MM_PER_USAF_UNIT against real frames.

The FFT score reads the spectrum at the bar frequency it is told to expect, so
that frequency has to be right to a few percent. It comes from the grid:

    px_per_mm = side_length * 2 ** (G1 - 2) / MM_PER_USAF_UNIT

side_length and G1 the pipeline already produces; MM_PER_USAF_UNIT -- millimetres
per USAF coordinate unit -- is the one constant that has to be measured. This
measures it the way the score itself works: sweep the assumed scale, and take
the value that maximises the mean MTF over elements the frame clearly resolves.
At the right scale the template lines up with the bars and the ratio peaks; a
factor of two away it finds the harmonic instead, which is why the sweep is
wide enough to show both and the report prints the runner-up.

    python fft_poc/calibrate_scale.py                       # the bundled test images
    python fft_poc/calibrate_scale.py path/to/*.png --show-sweep

The patch is held fixed at the nominal scale so only the assumed frequency and
the template move; otherwise the patch would grow with the scale and confound
the sweep.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from usaf_registration import UsafRegistration, fft_scoring as fs  # noqa: E402

DEFAULT_IMAGES = [
    "usaf_registration/test_img/test_image_g6e1.png",
    "usaf_registration/test_img/test_image_g5e4.png",
    "usaf_registration/test_img/test_image_g4e4.png",
    "usaf_registration/test_img/test_image_new.png",
    "usaf_registration/test_img/af_z59_880_cam1_VEN-505-36U3M-M01_20260227_163955.png",
]
# Coarse enough to be resolved in any usable frame, fine enough that the
# template is not just a few fat bars.
CALIB_INDICES = (2, 5, 8, 11, 14, 17)
PATCH_PERIODS = 6.0          # a little wide, so the block cannot fall out of frame


def grid_for(reg, image_path):
    """Run just enough of the pipeline to get side_length, G1 and the scanlines."""
    raw = cv2.imread(str(image_path))
    if raw is None:
        raise ValueError(f"could not read {image_path}")
    img = np.clip(reg.normalize_image_contrast(raw), 0, 255).astype(np.uint8)
    gray8 = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    reg.find_square_corners(gray8)
    reg.C.pattern_count = len(reg.count_4pts_pattern(img.copy()).boxes)

    cfg = reg.C.SIFT_CONFIG_LIST[max(min(reg.C.pattern_count - 1, 2), 0)]
    reg.C.SIFT_REF_IMAGE_PATH, reg.C.SIFT_REF_ORIGIN = cfg["REF_IMAGE_PATH"], cfg["REF_ORIGIN"]
    reg.C.SIFT_REF_PIXELS_PER_UNIT_X = cfg["REF_PIXELS_PER_UNIT_X"]
    reg.C.SIFT_REF_PIXELS_PER_UNIT_Y = cfg["REF_PIXELS_PER_UNIT_Y"]
    reg.C.SIFT_ANGLE = cfg["ANGLE"]

    out = None
    for k in range(len(reg.C.valid_squares)):
        corners = reg.C.valid_squares[k].reshape(-1, 2).copy()
        corners[:, 1] = img.shape[0] - corners[:, 1] - 1
        out = reg.coordinate_calibration(gray8, corners)
        if out is not None:
            break
    if out is None:
        raise ValueError("coordinate calibration failed")

    cx, cy, angle, side = out[0], out[1], out[2], out[3]
    reg.C.G1 = 8 - reg.C.pattern_count * 2
    reg.C.initialize_score_table()
    return gray8.astype(np.float64) / 255.0, cx, cy, angle, side


def sweep(image_path, scales):
    reg = UsafRegistration()
    gray, cx, cy, angle, side = grid_for(reg, image_path)
    white = fs.frame_white_level(gray)
    nominal = fs.px_per_mm_from_side_length(side, reg.C.G1)

    patches = []
    for i in CALIB_INDICES:
        if i not in reg.C.score_table:
            continue
        g, e = reg.C.score_table[i]
        pa = reg.usaf_point_to_screen(reg.C.group_positions[2 * i], cx, cy, angle, side)
        pb = reg.usaf_point_to_screen(reg.C.group_positions[2 * i + 1], cx, cy, angle, side)
        patch, _ = fs.extract_patch(gray, pa, pb, nominal / fs.lp_per_mm(g, e), PATCH_PERIODS)
        if patch is not None:
            patches.append((g, e, patch, fs.scanline_angle_deg(pa, pb)))
    if not patches:
        raise ValueError("no usable calibration patches")

    means = []
    for s in scales:
        ms = [fs.score_patch(p, g, e, nominal * s, ang, white_level=white)["mtf"]
              for g, e, p, ang in patches]
        ms = [m for m in ms if np.isfinite(m)]
        means.append(np.mean(ms) if ms else np.nan)
    return np.asarray(means), nominal, side, reg.C.G1, len(patches)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("images", nargs="*", default=None, help="frames to calibrate on")
    ap.add_argument("--lo", type=float, default=0.5, help="lowest scale multiplier")
    ap.add_argument("--hi", type=float, default=2.6, help="highest scale multiplier")
    ap.add_argument("--step", type=float, default=0.02)
    ap.add_argument("--show-sweep", action="store_true", help="print the whole curve")
    args = ap.parse_args(argv)

    images = args.images or [str(ROOT / p) for p in DEFAULT_IMAGES]
    scales = np.arange(args.lo, args.hi + 1e-9, args.step)

    print(f"{'image':<34s} {'side':>7s} {'G1':>3s} {'n':>2s} {'px/mm':>6s} "
          f"{'peak':>5s} {'mm/unit':>8s} {'2nd':>5s}")
    found = []
    for path in images:
        name = Path(path).name
        try:
            means, nominal, side, g1, n = sweep(path, scales)
        except Exception as exc:                                  # noqa: BLE001
            print(f"{name[:34]:<34s} skipped: {exc}")
            continue
        if not np.any(np.isfinite(means)):
            print(f"{name[:34]:<34s} skipped: no finite scores")
            continue

        best = int(np.nanargmax(means))
        # Runner-up outside +/-15% of the peak: if it is close in height the
        # sweep has locked onto a harmonic and the answer is not trustworthy.
        far = np.abs(scales / scales[best] - 1.0) > 0.15
        second = np.nanmax(np.where(far, means, np.nan)) if np.any(far & np.isfinite(means)) else np.nan
        mm_unit = fs.MM_PER_USAF_UNIT / scales[best]
        found.append(mm_unit)
        print(f"{name[:34]:<34s} {side:7.1f} {g1:3d} {n:2d} {nominal * scales[best]:6.0f} "
              f"{means[best]:5.2f} {mm_unit:8.3f} {second:5.2f}")

        if args.show_sweep:
            for s, m in zip(scales, means):
                if np.isfinite(m):
                    print(f"      {s:5.2f} {fs.MM_PER_USAF_UNIT / s:7.3f} {m:5.2f} "
                          + "#" * int(round(m * 40)))

    if found:
        print(f"\n  MM_PER_USAF_UNIT: median {np.median(found):.3f}  "
              f"spread {np.min(found):.3f}-{np.max(found):.3f}  (n={len(found)})")
        print(f"  currently {fs.MM_PER_USAF_UNIT:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
