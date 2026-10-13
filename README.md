# USAF Registration

Focus scoring of USAF 1951 resolution targets, plus a web UI for uploading
images to the FastAPI analysis service. Scoring returns a `(group, element)` pair.

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

This creates `.venv`, installs the Python and frontend dependencies, and
launches the frontend and FastAPI backend dev servers. Use `make backend` to
run only the backend. `make help` lists the other targets.

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

The frontend uploads images to the FastAPI backend for analysis. To run just
the frontend (with the backend started separately):

```bash
cd frontend
npm install
npm run dev
```

The standalone `usaf_registration/export_model.py` script is retained for
manual ONNX exports. It is not part of the frontend build or startup flow.
With the Python venv above activated, run:

```bash
python usaf_registration/export_model.py
```

To export a different checkpoint or destination:

```bash
python usaf_registration/export_model.py --model usaf_registration/models/<name>.pt --out <output-directory>
```

Other options: `--imgsz` (default 640), `--opset` (default 17), `--out`, and
`--no-simplify`.
