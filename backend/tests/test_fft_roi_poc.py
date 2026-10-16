"""Meaningful synthetic checks for the standalone FFT ROI experiment."""

import importlib.util
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).resolve().parents[1] / "usaf_registration" / "fft_roi_poc.py"
SPEC = importlib.util.spec_from_file_location("fft_roi_poc", MODULE_PATH)
fft_roi_poc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fft_roi_poc)


class FftRoiTests(unittest.TestCase):
    def test_expected_period_is_stronger_than_flat_and_edge_rois(self):
        x = np.arange(60)
        periodic = np.tile(np.where((x % 10) < 5, 180, 60), (32, 1)).astype(np.uint8)
        flat = np.full_like(periodic, 120)
        edge = np.tile(np.where(x < 30, 180, 60), (32, 1)).astype(np.uint8)

        periodic_score, _ = fft_roi_poc.analyze_roi(periodic, "vertical", 10)
        flat_score, _ = fft_roi_poc.analyze_roi(flat, "vertical", 10)
        edge_score, _ = fft_roi_poc.analyze_roi(edge, "vertical", 10)

        self.assertAlmostEqual(periodic_score["peak_period_px"], 10, delta=1)
        self.assertGreater(periodic_score["peak_amplitude_gray_levels"],
                           5 * flat_score["peak_amplitude_gray_levels"])
        self.assertGreater(periodic_score["peak_amplitude_gray_levels"],
                           2 * edge_score["peak_amplitude_gray_levels"])

    def test_horizontal_bars_and_roi_extraction(self):
        y = np.arange(60)
        image = np.tile(np.where((y % 10) < 5, 180, 60)[:, None], (1, 40)).astype(np.uint8)
        box = fft_roi_poc.extract_roi(image, {"box": [5, 0, 30, 60]})
        quad = fft_roi_poc.extract_roi(image, {"quad": [[5, 0], [34, 0], [34, 59], [5, 59]]})
        box_score, _ = fft_roi_poc.analyze_roi(box, "horizontal", 10)
        quad_score, _ = fft_roi_poc.analyze_roi(quad, "horizontal", 10)
        self.assertAlmostEqual(box_score["peak_period_px"], 10, delta=1)
        self.assertAlmostEqual(quad_score["peak_period_px"], 10, delta=1)

    def test_rejects_undersampled_pitch(self):
        with self.assertRaisesRegex(ValueError, "Nyquist"):
            fft_roi_poc.analyze_roi(np.zeros((20, 20), dtype=np.uint8), "vertical", 1.5)


if __name__ == "__main__":
    unittest.main()
