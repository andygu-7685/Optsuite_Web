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

## Run the container stack

The Compose stack builds the FastAPI backend and a production frontend served
by Nginx. Nginx forwards `/api/` to the backend, so the browser uses the same
origin for both. One backend API process handles jobs; its process pool has two
analysis workers.

Copy the example Compose settings, then set your Supabase URL and publishable
key in the new root `.env` file before building the frontend:

```powershell
Copy-Item .env.example .env
docker compose up --build -d
```

Open `http://127.0.0.1:8080`. Use `docker compose logs -f` to inspect the
services and `docker compose down` to stop them. The named `analysis_data`
volume keeps uploaded images, overlays, and analysis logs across container
recreation. Do not run `docker compose down -v` unless you intend to delete
that data.

By default, the web container binds only to localhost. To reach it from
another machine, put a TLS reverse proxy in front of it or change
`WEB_BIND_ADDRESS` in the root `.env`. Before allowing public traffic, add
server-side authentication to the analysis API: the current upload endpoint
does not verify a Supabase user token. Job status also lives only in memory,
so a restart loses active job status and this stack must stay at one backend
API instance until job state is moved to a shared store.
