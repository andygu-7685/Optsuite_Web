"""Validation for usaf_registration/fft_scoring.py.

Checks the ported scorer against the proof of concept it came from and against
known-answer synthetic patches, one check per change that was made:

    parity    same numbers as focus_score.py on the existing test set
    truth     measured MTF vs the MTF of the blur that was applied
    polarity  bright bars on black read the same as dark bars on white
    angle     recovery at the angles a rotated target actually sits at
    size      how the patch_periods default affects accuracy
    elements  statuses across group 6-9 at a realistic scale

Run from the repo root:

    python fft_poc/validate_fft_scoring.py
    python fft_poc/validate_fft_scoring.py --only truth polarity
"""

from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "fft_poc"))

from backend.usaf_registration import fft_scoring as fs  # noqa: E402

PX_PER_MM = 1140.0          # same scale as make_test_images.py
WHITE = 0.85
PHOTONS = 400
TEST_IMAGES = ROOT / "fft_poc" / "test_images"


# --------------------------------------------------------------------------
# synthetic patches with a known answer
# --------------------------------------------------------------------------

def synth(group, element, angle_deg, sigma_px, *, px_per_mm=PX_PER_MM, size=None,
          negative=False, photons=PHOTONS, shift=(0.0, 0.0), patch_periods=fs.PATCH_PERIODS,
          rng=None):
    """One patch of a blurred element, plus the true MTF at its bar frequency.

    Like a real camera: the blur happens before pixel integration, then shot
    noise. The template already carries the pixel integration, so the MTF to
    recover is the blur's alone.
    """
    rng = rng or np.random.default_rng(0)
    period = px_per_mm / fs.lp_per_mm(group, element)
    size = size or fs.patch_size_px(period, patch_periods)
    over = fs.template_oversample(period)

    fine = fs.element_fine(group, element, px_per_mm, angle_deg, (size, size), shift, over)
    if sigma_px > 0:
        fine = cv2.GaussianBlur(fine, (0, 0), sigmaX=sigma_px * over, sigmaY=sigma_px * over,
                                borderType=cv2.BORDER_REFLECT)
    img = fs.bin_pixels(fine, over) * WHITE
    if negative:
        img = WHITE - img                       # bright bars on a black field
    if photons:
        img = rng.poisson(np.clip(img, 0, None) * photons) / photons

    f = 1.0 / period
    return img, float(np.exp(-2 * np.pi ** 2 * (sigma_px * f) ** 2))


def rms(errors):
    errors = np.asarray([e for e in errors if np.isfinite(e)], dtype=float)
    return float(np.sqrt(np.mean(errors ** 2))) if errors.size else float("nan")


def report(name, value, limit, unit=""):
    ok = np.isfinite(value) and value <= limit
    print(f"  {name:<34s} {value:7.4f}{unit}  (limit {limit:g}{unit})  {'PASS' if ok else 'FAIL'}")
    return ok


# --------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------

def ensure_test_images():
    if TEST_IMAGES.exists() and any(TEST_IMAGES.glob("*.png")):
        return True
    print(f"  generating {TEST_IMAGES} ...")
    r = subprocess.run([sys.executable, str(ROOT / "fft_poc" / "make_test_images.py")],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("  could not generate the test set:\n" + (r.stderr or r.stdout))
        return False
    return True


def load_set():
    """(patch, group, element, angle_deg, true_mtf, name) for the PoC test set."""
    import focus_score as poc

    truth = poc.load_truth(TEST_IMAGES)
    out = []
    for path in sorted(TEST_IMAGES.glob("*.png")):
        meta = poc.parse_name(path.name)
        if meta is None:
            continue
        group, element, orient, _z = meta
        out.append((poc.load_gray(path), group, element, poc.ANGLE[orient],
                    truth.get(path.name), path.name, orient))
    return out


def check_parity():
    """The port must not move the numbers on the data the PoC was built on.

    One change does move them on purpose: the PoC renders every template at
    oversample 8, while the port scales it with the bar period, so the finest
    elements get a finer template. Those patches are held to the stricter test
    instead -- the new number has to be at least as close to the known answer.
    """
    import focus_score as poc

    same, changed = [], []
    for patch, group, element, angle, true, _name, orient in load_set():
        a = poc.score_patch(patch, group, element, orient, PX_PER_MM)
        b = fs.score_patch(patch, group, element, PX_PER_MM, angle)
        if not (np.isfinite(a.get("mtf", np.nan)) and np.isfinite(b["mtf"])):
            continue
        period = PX_PER_MM / fs.lp_per_mm(group, element)
        (same if fs.template_oversample(period) == 8 else changed).append(
            (b["mtf"] - a["mtf"], b["mtf"] - true if true is not None else np.nan,
             a["mtf"] - true if true is not None else np.nan))

    print(f"  {len(same)} patches at the PoC's own template oversample, {len(changed)} at a finer one")
    ok = report("max |mtf - poc mtf|, same template", float(np.max(np.abs([d[0] for d in same]))), 1e-9)
    new_rms, poc_rms = rms([d[1] for d in changed]), rms([d[2] for d in changed])
    print(f"  finer template: rms vs truth {new_rms:.4f}, was {poc_rms:.4f}")
    return report("rms(new - true) / rms(poc - true)", new_rms / poc_rms, 1.0) and ok


def check_truth():
    """Measured MTF vs the MTF of the blur that was applied."""
    errs, scored = [], 0
    for patch, group, element, angle, true, _name, _orient in load_set():
        if true is None:
            continue
        row = fs.score_patch(patch, group, element, PX_PER_MM, angle)
        if row["status"] in ("resolved", "unresolved"):
            errs.append(row["mtf"] - true)
            scored += 1
    print(f"  {scored} patches scored (near/beyond Nyquist excluded)")
    ok = report("rms(mtf - true)", rms(errs), 0.05)
    return report("max |mtf - true|", float(np.max(np.abs(errs))), 0.15) and ok


def check_polarity():
    """A negative target must read the same as the positive one it came from."""
    rng = np.random.default_rng(7)
    gaps, errs = [], []
    for element in range(1, 7):
        for sigma in (0.45, 0.9, 1.6):
            pos, true = synth(8, element, 0.0, sigma, rng=rng)
            neg, _ = synth(8, element, 0.0, sigma, negative=True,
                           rng=np.random.default_rng(7))
            a = fs.score_patch(pos, 8, element, PX_PER_MM, 0.0)
            b = fs.score_patch(neg, 8, element, PX_PER_MM, 0.0, white_level=WHITE)
            if b["polarity"] != "negative":
                print(f"    g8e{element} sigma {sigma}: polarity detected as {b['polarity']}")
                return False
            gaps.append(b["mtf"] - a["mtf"])
            errs.append(b["mtf"] - true)
    print(f"  {len(gaps)} pairs, polarity auto-detected on every negative patch")
    ok = report("rms(negative - positive)", rms(gaps), 0.03)
    return report("rms(negative - true)", rms(errs), 0.05) and ok


def check_angle():
    """The target sits at whatever angle it sits at; -28.6 deg is this one."""
    rng = np.random.default_rng(11)
    worst, errs = 0.0, []
    print(f"  {'angle':>7s} {'rms err':>8s} {'max err':>8s}")
    for angle in (0.0, -28.6, 17.0, 45.0, 73.4, 90.0, 118.0):
        per_angle = []
        for element in range(1, 7):
            for sigma in (0.45, 1.0):
                patch, true = synth(8, element, angle, sigma, rng=rng)
                row = fs.score_patch(patch, 8, element, PX_PER_MM, angle)
                per_angle.append(row["mtf"] - true)
        errs += per_angle
        worst = max(worst, float(np.max(np.abs(per_angle))))
        print(f"  {angle:7.1f} {rms(per_angle):8.4f} {np.max(np.abs(per_angle)):8.4f}")
    ok = report("rms over all angles", rms(errs), 0.05)
    return report("max over all angles", worst, 0.15) and ok


def check_size():
    """How much patch_periods costs in accuracy.

    Only half the tradeoff is visible here: these patches hold one element on an
    empty field, so this measures the windowing and noise cost of a wider patch
    and nothing of the neighbouring-element leakage that pushes the same way on
    a real target. Treat it as an upper bound on how wide to go, not a pick.
    """
    rng = np.random.default_rng(3)
    print(f"  {'periods':>8s} {'px @g8e1':>9s} {'rms err':>8s} {'max err':>8s}")
    best, results = None, {}
    for periods in (3.0, 4.0, 5.0, 6.0, 8.0, 12.0):
        errs = []
        for element in range(1, 7):
            for sigma in (0.45, 1.0, 1.8):
                patch, true = synth(8, element, -28.6, sigma, patch_periods=periods, rng=rng)
                row = fs.score_patch(patch, 8, element, PX_PER_MM, -28.6)
                if row["status"] in ("resolved", "unresolved"):
                    errs.append(row["mtf"] - true)
        results[periods] = rms(errs)
        size = fs.patch_size_px(PX_PER_MM / fs.lp_per_mm(8, 1), periods)
        print(f"  {periods:8.1f} {size:9d} {rms(errs):8.4f} "
              f"{np.max(np.abs(errs)) if errs else float('nan'):8.4f}")
        if best is None or results[periods] < results[best]:
            best = periods
    print(f"  lowest rms here: {best} periods (default is {fs.PATCH_PERIODS}; below "
          f"{fs.MIN_PATCH_PERIODS} periods, or {fs.MIN_PATCH_PX} px, the patch is refused)")
    return report(f"rms at the default ({fs.PATCH_PERIODS})", results[fs.PATCH_PERIODS], 0.05)


def check_elements():
    """Statuses across the range the pipeline will ask about, at 1140 px/mm."""
    rng = np.random.default_rng(5)
    print(f"  {'elem':>6s} {'lp/mm':>7s} {'cyc/px':>7s} {'px':>4s} {'mtf':>6s} {'dB':>6s}  status")
    ok = True
    for group in (6, 7, 8, 9):
        for element in (1, 4, 6):
            patch, true = synth(group, element, -28.6, 0.5, rng=rng)
            row = fs.score_patch(patch, group, element, PX_PER_MM, -28.6)
            print(f"  g{group}e{element:<4d} {row['lp_mm']:7.0f} {row['f_cpx']:7.3f} "
                  f"{patch.shape[0]:4d} {row['mtf']:6.3f} {row['detect_db']:6.1f}  {row['status']}")
            # Below Nyquist and barely blurred: it has to come back resolved.
            if row["f_cpx"] < fs.NEAR_NYQUIST and row["status"] != "resolved":
                ok = False
    print(f"  every element below {fs.NEAR_NYQUIST} cyc/px resolved: {'yes' if ok else 'NO'}")
    return ok


CHECKS = {"parity": check_parity, "truth": check_truth, "polarity": check_polarity,
          "angle": check_angle, "size": check_size, "elements": check_elements}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", nargs="+", choices=sorted(CHECKS), default=sorted(CHECKS))
    args = ap.parse_args(argv)

    needs_set = {"parity", "truth"} & set(args.only)
    if needs_set and not ensure_test_images():
        print("skipping the checks that need fft_poc/test_images")
        args.only = [c for c in args.only if c not in ("parity", "truth")]

    results = {}
    for name in args.only:
        print(f"\n[{name}]")
        results[name] = bool(CHECKS[name]())

    print("\n" + "-" * 52)
    for name, ok in results.items():
        print(f"  {name:<12s} {'PASS' if ok else 'FAIL'}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
