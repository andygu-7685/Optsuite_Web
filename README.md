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

In the Input panel, choose **Image flipped?** before analyzing. **Auto** keeps
orientation detection enabled; **Yes** and **No** use the selected orientation
throughout scoring. Changing this setting after an analysis requires running
Analyze again.

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
