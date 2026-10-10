# USAF Registration

Focus scoring of USAF 1951 resolution targets, plus a web UI that runs the
detection model in the browser. Scoring returns a `(group, element)` pair.

## Quick start

With GNU Make, Python 3, and Node installed, run from the repo root:

```bash
make
```

This creates `.venv`, installs the Python and frontend dependencies,
exports the model to ONNX if the checkpoint is newer, and launches the
frontend dev server. `make help` lists the other targets. After
retraining, `make export` (optionally `MODEL=usaf_registration/models/<name>.pt`)
forces a re-export.

## Python scorer

macOS / Linux:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Windows (PowerShell):

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

`itk-elastix` is an extra dependency, needed only when `PT_TRANSFORM = "elastix"`
in [usaf_registration/constants.py](usaf_registration/constants.py):

```bash
pip install itk-elastix
```

## Web frontend

Runs the YOLO keypoint model in the browser with `@ultralytics/yolo`. No Python
needed:

```bash
cd frontend
npm install
npm run dev
```

`npm install` copies the onnxruntime-web runtime into `public/ort/` (gitignored).
The exported model in `public/models/` is committed.

After retraining, re-export from the repo root with the Python venv above
activated. The first run may pip-install `onnx` and `onnxslim`.

```bash
python usaf_registration/export_model.py
```

That exports `4p_detect_ultra_pro_max.pt` to `frontend/public/models/`,
alongside a `.json` sidecar. Besides the class names and keypoint shape, the
sidecar carries a `usaf` block so the browser does not re-derive USAF 1951
numbers: `scoreTable` is the scan order of
[constants.py](usaf_registration/constants.py) `initialize_score_table`, each
row with its group, element, lp/mm, and bar width in µm, and `classes` maps a
class id to the same fields for models whose labels name an element (`g3e4`).
The frontend fills its Group/Element/lp-per-mm/bar-width tiles from that block,
falling back to parsing the class label. To export a different checkpoint:

```bash
python usaf_registration/export_model.py --model usaf_registration/models/<name>.pt
```

Other options: `--imgsz` (default 640), `--opset` (default 17), `--out`,
`--no-simplify`, and `--first-group` (default 2, as `UsafConfig.G1`; it sets the
first group of the exported score table).
