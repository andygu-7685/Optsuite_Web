# USAF Registration

Focus scoring of USAF 1951 resolution targets, plus a web UI that runs the
detection model in the browser. Scoring returns a `(group, element)` pair.

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

This creates `.venv`, installs the Python and frontend dependencies,
exports the model to ONNX if the checkpoint is newer, and launches the
frontend and FastAPI backend dev servers. Use `make backend` to run only the
backend. `make help` lists the other targets. After
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

The frontend runs the YOLO keypoint model in the browser with
`@ultralytics/yolo`. To run just that frontend without the backend:

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

That exports `4p_detect_ultra_pro_max.pt` to `frontend/public/models/`. To
export a different checkpoint:

```bash
python usaf_registration/export_model.py --model usaf_registration/models/<name>.pt
```

Other options: `--imgsz` (default 640), `--opset` (default 17), `--out`, and
`--no-simplify`.
