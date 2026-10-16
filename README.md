# USAF Registration

Focus scoring of USAF 1951 resolution targets, plus a web UI for uploading
images to the FastAPI analysis service. Scoring returns a `(group, element)` pair.
The Python scorer, models, and reference images live in `backend/usaf_registration/`;
the web app lives in `frontend/`.

## Quick start

Windows (PowerShell), without GNU Make:

```powershell
.\dev.cmd
```

Use `.\dev.cmd backend` to start only the FastAPI backend. The launcher
installs Python dependencies, installs frontend dependencies if needed, then
opens a separate backend window and runs Vite in the current terminal.
Analysis uploads, overlays, and logs are saved under `backend/runtime-data/`
by default. Set `USAF_DATA_DIR` to use another location.

With GNU Make, Python 3, and Node installed, run from the repo root:

```bash
make
```

This creates `backend/.venv`, installs the Python and frontend dependencies, and
launches the frontend and FastAPI backend dev servers. Use `make backend` to
run only the backend. `make help` lists the other targets.

## Python scorer

macOS / Linux:

```bash
python3 -m venv backend/.venv && source backend/.venv/bin/activate
pip install -r backend/requirements.txt
```

Windows (PowerShell):

```powershell
py -m venv backend/.venv
backend\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

`itk-elastix` is an extra dependency, needed only when `PT_TRANSFORM = "elastix"`
in [backend/usaf_registration/constants.py](backend/usaf_registration/constants.py):

```bash
pip install itk-elastix
```

## Web frontend

The frontend uploads images to the FastAPI backend for analysis. To run just
the frontend (with the backend started separately):

```bash
cd frontend
npm install
npm run dev
```

The standalone `backend/usaf_registration/export_model.py` script is retained for
manual ONNX exports. It is not part of the frontend build or startup flow.
With the Python venv above activated, run:

```bash
python backend/usaf_registration/export_model.py
```

To export a different checkpoint or destination:

```bash
python backend/usaf_registration/export_model.py --model backend/usaf_registration/models/<name>.pt --out <output-directory>
```

Other options: `--imgsz` (default 640), `--opset` (default 17), `--out`, and
`--no-simplify`.

## Experimental FFT scoring for group 8/9

`fft_roi_poc.py` measures whether a selected region contains the expected
light/dark bar frequency. It is independent of YOLO and does **not** change the
web analysis result. It produces measurements and diagnostic plots, not a
calibrated resolved/unresolved decision.

Create a JSON file with ROIs in **full-resolution image pixels**. `bars` describes
the direction of the bars: vertical bars vary across x; horizontal bars vary
across y. A `box` is `[x, y, width, height]`. For rotated targets, use `quad`
instead, with image points in top-left, top-right, bottom-right, bottom-left
order. The quadrilateral is rectified before sampling.

```json
{
  "rois": [
    {"group": 8, "element": 1, "bars": "vertical", "box": [100, 200, 48, 32], "period_px": 10.0},
    {"group": 8, "element": 1, "bars": "horizontal", "box": [160, 200, 32, 48], "period_px": 10.0}
  ]
}
```

Replace the example coordinates and period with measurements from your image.
The period is **pixels per light/dark line pair**, measured along the axis
across the bars. As an alternative to `period_px` on every ROI, set one top-level
`pixels_per_mm` value if the object-plane image scale is known: the script uses
the USAF formula `lp/mm = 2 ** (group + (element - 1) / 6)` to derive each
expected period. For a perspective image, per-ROI `period_px` is more accurate.

```powershell
backend\.venv\Scripts\python.exe backend\usaf_registration\fft_roi_poc.py path\to\target.png path\to\rois.json --out-dir fft-roi-output
```

The output contains `fft_results.json` and `fft_diagnostics.png`. Inspect the
ROI and across-bar profile along with the FFT peak. An isolated FFT peak alone
does not prove that all three bars are resolved. Images with less than two
pixels per line pair are rejected; results near that limit need extra caution.

To try it on a bundled image, use the group 7 element 1 control ROIs in
`backend/usaf_registration/test_img/fft_rois_image_g67only.json`:

```powershell
backend\.venv\Scripts\python.exe backend\usaf_registration\fft_roi_poc.py backend\usaf_registration\test_img\image_g67only.png backend\usaf_registration\test_img\fft_rois_image_g67only.json --out-dir backend\runtime-data\fft-g7-example
```

This fixture contains group 7, so it verifies the ROI and FFT workflow on a
real image. A group 8/9 measurement needs a photograph containing those groups
and a matching ROI manifest.
