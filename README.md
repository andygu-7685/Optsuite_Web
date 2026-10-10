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
The frontend reads its group, element, lp/mm and bar-width columns from that
block, falling back to parsing the class label. For a checkpoint whose labels name no
element but whose class order is known, pin them with `--class-map` (repeatable;
the left side is a class id or a class name):

```bash
python usaf_registration/export_model.py --model usaf_registration/models/single_pattern_scanline_v2.pt --class-map usaf_element=g6e2
```

Both halves are required — a group on its own has no lp/mm — and a bad mapping
fails before the ONNX export runs.

Every export also rewrites `public/models/index.json`, the list the app
actually fetches, so a re-export shows up on reload even with the dev server
already running. (`npm run dev`/`build` still rebuild it too, via
`scripts/list-models.mjs`; both writers produce the same file.)

To export a different checkpoint:

```bash
python usaf_registration/export_model.py --model usaf_registration/models/<name>.pt
```

Other options: `--imgsz` (default 640), `--opset` (default 17), `--out`,
`--no-simplify`, and `--first-group` (default 2, as `UsafConfig.G1`; it sets the
first group of the exported score table, and so the group/element a scan index
resolves to).

### Identifying elements

A class map only names the element a model was trained on. The four-keypoint
model instead reports the corners of the target's outline, and that is enough to
place every scanned element without any per-element class: the frontend fits a
homography from those corners onto the image, then projects the element layout
through it. Each element comes back with its group, element, lp/mm and bar width,
drawn on the frame and listed under *Identified elements*.

The layout is
[frontend/src/lib/targetLayout.js](frontend/src/lib/targetLayout.js), mirroring
[constants.py](usaf_registration/constants.py) `group_positions` the way
`lib/usaf.js` mirrors `helper.py` — it is the target's fixed geometry, not a
per-model number, so it does not travel in the sidecar. It also carries where the
model puts its keypoints in target coordinates, measured by running the model on
the bundled reference target rather than assumed.

Those keypoints are good to a few percent of the target width, which names an
element but does not box one, so `lib/refine.js` then searches a tightly bounded
scale and shift for the alignment that puts the most bar inside the boxes. This
is a small stand-in for the registration the Python scorer does with
`classic_warp.py` and `sift_warp.py`; the *Results* header says when it moved.

Two limits worth knowing. The layout covers the 33 rows of the scan table, so
elements the Python scorer never scans (group 2 elements 5 and 6) are not drawn.
And resolved versus unresolved comes from the detections: the finest
group/element any detection names is taken as the score, elements at or below it
draw solid and finer ones dashed. With a model that only finds whole patterns
there is no such detection, and every element is drawn as identified.
