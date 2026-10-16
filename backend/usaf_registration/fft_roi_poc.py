"""Experimental FFT measurements for manually selected fine USAF ROIs.

Run this file directly; it does not load the existing YOLO models. ROI coordinates
may also come from a separate registration step. This is a measurement aid, not
a calibrated resolved/unresolved classifier.
"""

import argparse
import json
from pathlib import Path

import cv2
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def extract_roi(gray: np.ndarray, spec: dict) -> np.ndarray:
    """Extract a rectangle or rectify a TL, TR, BR, BL quadrilateral."""
    if "box" in spec:
        x, y, w, h = map(int, spec["box"])
        if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > gray.shape[1] or y + h > gray.shape[0]:
            raise ValueError(f"ROI box is outside the image: {spec['box']}")
        return gray[y:y + h, x:x + w]

    corners = np.asarray(spec["quad"], dtype=np.float32)
    if corners.shape != (4, 2):
        raise ValueError("quad must contain TL, TR, BR, BL image coordinates")
    if np.any(corners < 0) or np.any(corners[:, 0] >= gray.shape[1]) or np.any(corners[:, 1] >= gray.shape[0]):
        raise ValueError("ROI quad is outside the image")
    width = int(round((np.linalg.norm(corners[1] - corners[0]) + np.linalg.norm(corners[2] - corners[3])) / 2))
    height = int(round((np.linalg.norm(corners[3] - corners[0]) + np.linalg.norm(corners[2] - corners[1])) / 2))
    if width < 2 or height < 2:
        raise ValueError("ROI quad is too small")
    target = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    transform = cv2.getPerspectiveTransform(corners, target)
    return cv2.warpPerspective(gray, transform, (width, height), flags=cv2.INTER_LINEAR)


def analyze_roi(patch: np.ndarray, bars: str, period_px: float) -> tuple[dict, dict]:
    """Measure the expected 1D frequency across the bars at native ROI scale."""
    if bars not in ("vertical", "horizontal"):
        raise ValueError("bars must be 'vertical' or 'horizontal'")
    if not np.isfinite(period_px) or period_px < 2:
        raise ValueError("period_px must be at least 2 pixels (the Nyquist limit)")

    pixels = patch.astype(np.float64)
    # Average across the middle of the bars, away from ends and neighboring text.
    if bars == "vertical":
        lo, hi = int(pixels.shape[0] * 0.2), int(np.ceil(pixels.shape[0] * 0.8))
        profile = pixels[lo:hi].mean(axis=0)
    else:
        lo, hi = int(pixels.shape[1] * 0.2), int(np.ceil(pixels.shape[1] * 0.8))
        profile = pixels[:, lo:hi].mean(axis=1)

    n = len(profile)
    if n < 12 or n / period_px < 1.5:
        raise ValueError("ROI must contain at least 12 pixels and 1.5 expected cycles across the bars")

    x = np.arange(n, dtype=np.float64)
    trend = np.polyval(np.polyfit(x, profile, 1), x)
    residual = profile - trend
    window = np.hanning(n)
    # Zero padding interpolates the displayed spectrum; it adds no image detail.
    nfft = max(256, 8 * n)
    frequencies = np.fft.rfftfreq(nfft)
    amplitudes = 2 * np.abs(np.fft.rfft(residual * window, n=nfft)) / window.sum()
    expected_frequency = 1.0 / period_px
    local_band = max(0.15 * expected_frequency, 1.0 / n)
    peak_mask = np.abs(frequencies - expected_frequency) <= local_band
    peak_index = np.flatnonzero(peak_mask)[np.argmax(amplitudes[peak_mask])]
    # Exclude DC, the expected peak and its first harmonic from the noise estimate.
    noise_mask = (frequencies >= 1.0 / n) & (frequencies <= 0.5)
    noise_mask &= np.abs(frequencies - expected_frequency) > 1.5 * local_band
    noise_mask &= np.abs(frequencies - 2 * expected_frequency) > local_band
    noise_floor = float(np.median(amplitudes[noise_mask])) if np.any(noise_mask) else None
    peak = float(amplitudes[peak_index])
    snr_db = 20 * np.log10(peak / noise_floor) if noise_floor and peak > 0 else None

    metrics = {
        "roi_size_px": [int(patch.shape[1]), int(patch.shape[0])],
        "expected_period_px": float(period_px),
        "expected_cycles_in_roi": float(n / period_px),
        "peak_period_px": float(1.0 / frequencies[peak_index]) if frequencies[peak_index] > 0 else None,
        "peak_amplitude_gray_levels": peak,
        "peak_to_noise_db": float(snr_db) if snr_db is not None else None,
        "sampling_note": "near Nyquist; interpret cautiously" if period_px < 4 else None,
    }
    diagnostics = {"profile": profile, "trend": trend, "frequencies": frequencies,
                   "amplitudes": amplitudes, "expected_frequency": expected_frequency}
    return metrics, diagnostics


def plot_diagnostics(rows: list[tuple[str, np.ndarray, dict]], output: Path) -> None:
    fig, axes = plt.subplots(len(rows), 3, figsize=(12, max(3, 2.8 * len(rows))), squeeze=False)
    for row_index, (label, patch, detail) in enumerate(rows):
        ax_image, ax_profile, ax_spectrum = axes[row_index]
        ax_image.imshow(patch, cmap="gray", vmin=0, vmax=255)
        ax_image.set_title(label)
        ax_image.axis("off")
        ax_profile.plot(detail["profile"], label="intensity")
        ax_profile.plot(detail["trend"], label="background", alpha=0.7)
        ax_profile.set_title("Across-bar profile")
        ax_profile.legend(fontsize=8)
        ax_spectrum.plot(detail["frequencies"], detail["amplitudes"])
        ax_spectrum.axvline(detail["expected_frequency"], color="red", linestyle="--", label="expected")
        ax_spectrum.set_xlim(0, 0.5)
        ax_spectrum.set_title("FFT amplitude (cycles/pixel)")
        ax_spectrum.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(output, dpi=150)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Original, full-resolution target image")
    parser.add_argument("rois", type=Path, help="JSON ROI manifest; see README")
    parser.add_argument("--out-dir", type=Path, default=Path("fft-roi-output"))
    args = parser.parse_args()

    gray = cv2.imread(str(args.image), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        parser.error(f"could not read image: {args.image}")
    manifest = json.loads(args.rois.read_text(encoding="utf-8"))
    if not isinstance(manifest.get("rois"), list) or not manifest["rois"]:
        parser.error("manifest must contain a nonempty 'rois' list")

    results = []
    plots = []
    for spec in manifest["rois"]:
        group, element = int(spec["group"]), int(spec["element"])
        if group not in (7, 8, 9) or element not in range(1, 7):
            raise ValueError("this PoC expects group 7-9 and element 1-6")
        patch = extract_roi(gray, spec)
        period_px = spec.get("period_px")
        if period_px is None:
            pixels_per_mm = float(manifest["pixels_per_mm"])
            lp_per_mm = 2 ** (group + (element - 1) / 6)
            period_px = pixels_per_mm / lp_per_mm
        metrics, detail = analyze_roi(patch, spec["bars"], float(period_px))
        label = f"G{group}E{element} {spec['bars']}"
        results.append({"group": group, "element": element, "bars": spec["bars"], **metrics})
        plots.append((label, patch, detail))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "fft_results.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    plot_diagnostics(plots, args.out_dir / "fft_diagnostics.png")
    print(f"Wrote {args.out_dir / 'fft_results.json'} and {args.out_dir / 'fft_diagnostics.png'}")


if __name__ == "__main__":
    main()
