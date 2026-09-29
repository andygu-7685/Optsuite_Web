# microscopy-poc

Runs the YOLO keypoint model in the browser with `@ultralytics/yolo`. Setup and
model export are covered in the [root README](../README.md).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server. Runs `predev` first. |
| `npm run build` | Builds the production bundle into `dist/`. Runs `prebuild` first. |
| `npm run preview` | Serves the built `dist/` locally to check a production build. |
| `npm run lint` | Lints the source with oxlint (rules in `.oxlintrc.json`). |
| `npm run copy-ort` | Copies the onnxruntime-web runtime into `public/ort/`. |
| `npm run list-models` | Writes `public/models/index.json`, the list behind the Model dropdown. |

These run automatically:

| Hook | Runs | Why |
| --- | --- | --- |
| `postinstall` | `copy-ort` | Keeps `public/ort/` matched to the installed onnxruntime-web version. |
| `predev`, `prebuild` | `check-static`, then `list-models` | Stops early if `public/ort/` or a `.onnx` model is missing, then refreshes the model list. |

## Details

- **`copy-ort`** ([scripts/copy-ort.mjs](scripts/copy-ort.mjs)): replaces
  `public/ort/` with `node_modules/onnxruntime-web/dist`, skipping `.map` files.
  The app loads the runtime from `/ort/` so it doesn't fetch it from a CDN.
  `public/ort/` is gitignored. If it's missing, run `npm install` or
  `npm run copy-ort`.
- **`check-static`** ([scripts/check-static.mjs](scripts/check-static.mjs)):
  exits with an error if `public/ort/` or any `public/models/*.onnx` file is
  missing. Without this check, Vite would return `index.html` for the missing
  model and the load would fail with an unclear parse error. It has no npm
  script of its own; it only runs through `predev` and `prebuild`.
- **`list-models`** ([scripts/list-models.mjs](scripts/list-models.mjs)): lists
  every `.onnx` file in `public/models/`, adding metadata from its `.json`
  sidecar (written by `export_model.py`) when one exists. The output file is
  gitignored. After exporting a new model, restart `npm run dev` so it shows up
  in the dropdown.
