# USAF Registration

Focus scoring of USAF 1951 resolution targets, plus a web UI that runs the
detection model in the browser and measures what the frame actually resolves.
Scoring returns a `(group, element)` pair, alongside a contrast transfer curve
and the lp/mm it crosses the threshold at.

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
sidecar carries a small `usaf` block: `firstGroup` is the fallback first group
(see below), and `classes` maps a class id to a group, element, lp/mm and bar
width for models whose labels name an element (`g3e4`). The scan table itself
is not in the sidecar — it is the fixed order of
[constants.py](usaf_registration/constants.py) `initialize_score_table`, which
`lib/usaf.js` derives from the first group. For a checkpoint whose labels name
no element but whose class order is known, pin them with `--class-map`
(repeatable; the left side is a class id or a class name):

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

### Measuring elements

A class map only names the element a model was trained on. The four-keypoint
model instead reports the corners of a target's outline, and that is enough to
place every scanned element and then *measure* it.

The browser pipeline mirrors [usaf_algo.py](usaf_registration/usaf_algo.py)
`find_usaf_score`, with the registration a browser can actually do:

1. **Place.** Every detection with four keypoints is fitted to the target's
   outline ([lib/homography.js](frontend/src/lib/homography.js)), and the
   detections that genuinely nest — each inside the last and about a quarter of
   its size — become a chain, outermost first
   ([lib/analyze.js](frontend/src/lib/analyze.js)). How long that chain is names
   the first group, as `G1 = 8 - pattern_count * 2` does in the Python, so a
   close-up of the inner pattern is no longer read as group 2.
2. **Refine.** Each copy is nudged onto its own bars by a tightly bounded search
   over scale and shift ([lib/refine.js](frontend/src/lib/refine.js)) — the small
   version of what `classic_warp.py` and `sift_warp.py` do.
3. **Scan.** Each element's two scanlines are sampled bilinearly through the
   transform of the copy that contains it
   ([lib/scan.js](frontend/src/lib/scan.js),
   [lib/profile.js](frontend/src/lib/profile.js)), giving the 2nd-to-98th
   percentile contrast of `calculate_scanline_contrast_scores`, its Michelson
   form, and the savgol-smoothed dip count of that function's `GRADIENT_MIN`
   block. The two directions merge by `SCORE_METHOD`.
4. **Score.** [lib/score.js](frontend/src/lib/score.js) walks the ladder the way
   `scoring.py` `find_best_focus_group` does.

The layout is
[frontend/src/lib/targetLayout.js](frontend/src/lib/targetLayout.js), mirroring
[constants.py](usaf_registration/constants.py) `group_positions` the way
`lib/usaf.js` mirrors `helper.py` — it is the target's fixed geometry, not a
per-model number, so it does not travel in the sidecar. It also carries where
the model puts its keypoints in target coordinates, measured by running the
model on the bundled reference target rather than assumed.

### How well the target resolves

A group/element is a rung on a ladder with 12% steps, so on its own it cannot
say how far past the last resolved element a frame got. Alongside it the
*Results* panel reports what the measurement can say continuously:

- **Cutoff** — the lp/mm where the measured contrast crosses the threshold,
  interpolated in log frequency between rungs. This is the number to watch
  between two frames of one setup: defocus moves it smoothly where the rung only
  steps.
- **Half contrast** — the same crossing at 0.5, the usual MTF50 analogue. It
  sits in the mid-range of the ladder, where placement is most reliable, so it
  is often the most discriminating of the three.
- **Sampling limit** — the finest line pairs the pixel grid itself can carry,
  from the bar width each element is known to have. Elements past it are marked
  *undersampled* rather than unresolved, and neither the cutoff nor the score is
  read from them: contrast measured there is aliasing.
- **Limited by** — whether the cutoff ran into the optics or the sampling.
- **Sharpness** — the Laplacian variance of `helper.py` `is_image_clear`,
  windowed to the target rather than the whole frame. Reported, not enforced:
  comparable between frames of one setup, not between setups.
- **Falling** — how much of the ladder decreases the way a contrast curve
  should. A low figure means the layout is not sitting cleanly on the bars and
  the rung should be read with suspicion.

The *Contrast transfer* chart plots the two bar directions separately, since the
directions coming apart is astigmatism rather than defocus and the merged number
hides it.

Scoring is controlled from *Model options*, mirroring
[constants.py](usaf_registration/constants.py): **Merge directions** is
`SCORE_METHOD`, **Contrast threshold** is `SCORE_THRESHOLD`, **Require dips** is
`GRADIENT_MIN`, and **Cutoff rule** picks how the ladder walk ends —
`inflection` and `threshold` are the two branches of
`FOCUS_GROUP_LAST_ABOVE_THRESHOLD`, while `cutoff` (the default) takes the
finest rung at or below the measured cutoff frequency. The ported rules both
turn on a single element, so one badly placed scanline moves them by several
rungs; `cutoff` moves by a fraction of one.

Two limits worth knowing. The layout covers the 33 rows of the scan table, so
elements the Python scorer never scans (group 2 elements 5 and 6) are not drawn.
And on a frame where the target is small, the finest elements land within a
pixel or two of the sampling limit; they are flagged, but the measurement near
the cutoff is noisy there, and the half-contrast figure is the more trustworthy
one.
