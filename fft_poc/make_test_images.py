"""Synthetic USAF group 8/9 focus sweep for focus_score.py.

Writes g<G>e<E>_<V|H>_Z<zz>_<zzz>.png patches plus manifest.csv holding the
true MTF of the blur applied to each one, so the score can be checked against
a known answer. The optics are a Gaussian blur that widens with defocus, with
some astigmatism: vertical bars (which see the x blur) are sharpest at
Z_BEST_V, horizontal bars at Z_BEST_H. Like a real camera, the blur happens
before pixel integration, then shot noise. Each patch also gets up to 1 px of
offset and 1 deg of rotation the template doesn't know about, as a stand-in
for registration error.

    python fft_poc/make_test_images.py [out_dir]   # default fft_poc/test_images
"""

import csv
import sys
from pathlib import Path

import cv2
import numpy as np

from focus_score import ANGLE, bin_pixels, element_fine, lp_per_mm

PX_PER_MM = 1140.0
SIZE = (72, 72)
OVERSAMPLE = 8
ELEMENTS = [(8, e) for e in range(1, 7)] + [(9, 1)]   # everything below Nyquist at this scale
Z_VALUES = np.round(np.arange(61.800, 61.9401, 0.010), 3)
Z_BEST_V, Z_BEST_H = 61.864, 61.878
SIGMA0, SIGMA_PER_Z = 0.45, 15.0   # blur (px) at best focus, and its growth per unit of defocus
PHOTONS = 400                      # photon count at the white level -> shot noise
WHITE = 0.85


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    manifest = []
    for z in Z_VALUES:
        sx = SIGMA0 + SIGMA_PER_Z * abs(z - Z_BEST_V)
        sy = SIGMA0 + SIGMA_PER_Z * abs(z - Z_BEST_H)
        for group, element in ELEMENTS:
            f = lp_per_mm(group, element) / PX_PER_MM
            for orient in ("V", "H"):
                angle = ANGLE[orient] + rng.uniform(-1, 1)
                shift = tuple(rng.uniform(-1, 1, 2))
                fine = element_fine(group, element, PX_PER_MM, angle, SIZE, shift, OVERSAMPLE)
                fine = cv2.GaussianBlur(fine, (0, 0), sigmaX=sx * OVERSAMPLE, sigmaY=sy * OVERSAMPLE,
                                        borderType=cv2.BORDER_REFLECT)
                img = rng.poisson(bin_pixels(fine, OVERSAMPLE) * WHITE * PHOTONS) / PHOTONS
                name = f"g{group}e{element}_{orient}_Z{z:.3f}".replace(".", "_") + ".png"
                cv2.imwrite(str(out / name), np.clip(img * 255, 0, 255).round().astype(np.uint8))

                # Gaussian MTF at the bar frequency vector (pixel MTF is in the template too).
                t = np.radians(angle)
                true_mtf = np.exp(-2 * np.pi ** 2 * ((sx * f * np.cos(t)) ** 2 + (sy * f * np.sin(t)) ** 2))
                manifest.append({"file": name, "z": f"{z:.3f}", "sigma_x": f"{sx:.3f}",
                                 "sigma_y": f"{sy:.3f}", "true_mtf": f"{true_mtf:.5f}"})

    with (out / "manifest.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(manifest[0]))
        w.writeheader()
        w.writerows(manifest)
    print(f"wrote {len(manifest)} patches + manifest.csv to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "test_images")
