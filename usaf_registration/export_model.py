import argparse
import json
import re
import shutil
from pathlib import Path

from ultralytics import YOLO

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = BASE_DIR / "models" / "4p_detect_ultra_pro_max.pt"
DEFAULT_OUT = BASE_DIR.parent / "frontend" / "public" / "models"

# USAF 1951 math, mirroring helper.py; the scan order mirrors
# constants.py UsafConfig.initialize_score_table. Kept standalone so exporting
# does not construct a UsafConfig (which creates a logs/ directory).
FIRST_GROUP = 2  # constants.py UsafConfig.G1
ELEMENTS = (1, 2, 3, 4, 5, 6)

# Class labels that name an element: "g3e4", "G3_E4", "group 3 element 4", "3-4".
# Mirrors parseGroupElement in frontend/src/lib/usaf.js.
LABELLED = re.compile(
    r"g(?:roup)?\s*(?:[-_ ](?!\d))?(-?\d+)\s*[-_ ]?e(?:lement)?\s*[-_ ]?([1-6])(?!\d)",
    re.IGNORECASE,
)
PAIR = re.compile(r"^\D*(-?\d+)\s*[-_/,\s]\s*([1-6])\D*$")


def lp_per_mm(group: int, element: int) -> float:
    return float(2.0 ** (group + (element - 1) / 6.0))


def line_width_um(group: int, element: int) -> float:
    """Single bar width in micrometres."""
    return 1000.0 / (2.0 * lp_per_mm(group, element))


def number(value: float):
    """4 decimals, and whole values as ints so JSON matches what JS writes."""
    value = round(value, 4)
    return int(value) if value == int(value) else value


def resolution(group: int, element: int) -> dict:
    """One group/element with its lp/mm and bar width, as the frontend reads it."""
    return {
        "group": int(group),
        "element": int(element),
        "lpPerMm": number(lp_per_mm(group, element)),
        "lineWidthUm": number(line_width_um(group, element)),
    }


def parse_group_element(label: str):
    """`(group, element)` from a class label, or None if absent or out of range."""
    match = LABELLED.search(label) or PAIR.search(label)
    if not match:
        return None
    group = int(match.group(1))
    element = int(match.group(2))
    if not -2 <= group <= 9 or not 1 <= element <= 6:
        return None
    return group, element


def resolve_class_id(key: str, names: dict) -> int:
    """A class id ("0") or a class name ("usaf_element") from the checkpoint."""
    try:
        index = int(key)
    except ValueError:
        matches = [int(i) for i, label in names.items() if str(label).lower() == key.lower()]
        if not matches:
            known = ", ".join(f"{int(i)}={label}" for i, label in sorted(names.items()))
            raise ValueError(f"export_model.resolve_class_id: no class {key!r} in this model ({known})") from None
        return matches[0]
    if names and index not in {int(i) for i in names}:
        raise ValueError(f"export_model.resolve_class_id: class id {index} is not one of {sorted(int(i) for i in names)}")
    return index


def parse_class_map(specs, names: dict) -> dict:
    """`--class-map "0=g3e4,usaf_element=g3e5"` -> {class id: group/element with its lp/mm}.

    For checkpoints whose class labels do not name an element but whose class
    order is known. Both halves are required: a group on its own has no lp/mm.
    """
    mapping = {}
    for spec in specs:
        for item in spec.split(","):
            item = item.strip()
            if not item:
                continue
            key, sep, label = (part.strip() for part in item.partition("="))
            if not (sep and key and label):
                raise ValueError(f"export_model.parse_class_map: expected 'class=g3e4', got {item!r}")
            parsed = parse_group_element(label)
            if not parsed:
                raise ValueError(f"export_model.parse_class_map: {label!r} names no group and element, as 'g3e4'")
            mapping[resolve_class_id(key, names)] = resolution(*parsed)
    return mapping


def score_table(first_group: int = FIRST_GROUP) -> list:
    """Scan order: elements 2-4 of the first group, then five full groups."""
    rows = [(first_group, element) for element in (2, 3, 4)]
    for offset in range(1, 6):
        rows.extend((first_group + offset, element) for element in ELEMENTS)
    return [{"index": index, **resolution(group, element)} for index, (group, element) in enumerate(rows)]


def usaf_meta(names: dict, first_group: int = FIRST_GROUP, class_map: dict | None = None) -> dict:
    """Group/element + lp/mm the browser cannot derive on its own.

    `classes` is filled for models whose class labels name an element ("g3e4"),
    plus anything `--class-map` pins by hand; `scoreTable` is the scan order
    scoring walks, so a scan index maps to a group/element without re-deriving
    the table in JS.
    """
    classes = {}
    for index, label in names.items():
        parsed = parse_group_element(str(label))
        if parsed:
            classes[int(index)] = resolution(*parsed)
    classes.update(class_map or {})
    return {
        "firstGroup": int(first_group),
        "classes": classes,
        "scoreTable": score_table(first_group),
    }


def write_index(out_dir: Path) -> list:
    """Rebuild models/index.json, the list the frontend actually fetches.

    frontend/scripts/list-models.mjs writes the same file, but only on `npm run
    dev`/`build`; doing it here too means an export lands in the picker even
    with the dev server already running. A bare .onnx is still listed, just
    without metadata.
    """
    models = []
    for onnx in sorted(out_dir.glob("*.onnx")):
        sidecar = onnx.with_suffix(".json")
        meta = {}
        if sidecar.exists():
            try:
                meta = json.loads(sidecar.read_text(encoding="utf-8"))
            except json.JSONDecodeError as error:
                print(f"index: ignoring unreadable {sidecar}: {error}")
        models.append({**meta, "file": onnx.name})

    index_path = out_dir / "index.json"
    # newline="" keeps the LF that list-models.mjs writes, so the two agree byte for byte.
    index_path.write_text(json.dumps(models, indent=2) + "\n", encoding="utf-8", newline="")
    print(f"wrote {index_path} ({len(models)} model(s))")
    return models


def export(
    model_path: Path,
    imgsz: int,
    out_dir: Path,
    opset: int,
    simplify: bool,
    first_group: int = FIRST_GROUP,
    class_map_specs=(),
):
    model_path = Path(model_path).expanduser().resolve()
    if not model_path.exists():
        raise FileNotFoundError(f"export_model.export: no checkpoint at {model_path}")

    out_dir = Path(out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(model_path))

    names = model.names or {}
    # Before the export itself, so a typo in --class-map fails in a second.
    class_map = parse_class_map(class_map_specs, names)

    # nms=None (the default) exports the raw head; @ultralytics/yolo runs NMS in
    # its Rust/wasm layer. nms=False 
    exported = model.export(
        format="onnx",
        imgsz=imgsz,
        opset=opset,
        simplify=simplify,
        dynamic=False,
        nms=None,
    )

    onnx_path = out_dir / f"{model_path.stem}.onnx"
    shutil.move(str(exported), str(onnx_path))

    kpt_shape = getattr(getattr(model, "model", None), "kpt_shape", None)

    meta = {
        "file": onnx_path.name,
        "task": model.task,
        "imgsz": imgsz,
        "names": {int(k): v for k, v in names.items()},
        "numClasses": len(names),
        "numKeypoints": int(kpt_shape[0]) if kpt_shape else 0,
        "keypointDims": int(kpt_shape[1]) if kpt_shape else 0,
        "source": model_path.name,
        "usaf": usaf_meta(names, first_group, class_map),
    }

    meta_path = out_dir / f"{model_path.stem}.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8", newline="")

    write_index(out_dir)

    size_mb = onnx_path.stat().st_size / 1e6
    print(f"wrote {onnx_path} ({size_mb:.1f} MB)")
    print(f"wrote {meta_path}")
    mapped = meta["usaf"]["classes"]
    print(f"usaf: first group {first_group}, {len(mapped)}/{len(names)} class(es) carry a group/element")
    for index in sorted(mapped):
        entry = mapped[index]
        print(f"  {index} {names[index]} -> G{entry['group']} E{entry['element']} ({entry['lpPerMm']} lp/mm)")
    return meta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--no-simplify", dest="simplify", action="store_false")
    parser.add_argument(
        "--first-group",
        type=int,
        default=FIRST_GROUP,
        help="first group on the target, as constants.py UsafConfig.G1 (default %(default)s)",
    )
    parser.add_argument(
        "--class-map",
        action="append",
        default=[],
        metavar="0=g3e4,...",
        help="pin classes to a group/element the labels do not name; repeatable, "
        "and the left side is a class id or a class name",
    )
    args = parser.parse_args()

    export(
        args.model,
        args.imgsz,
        args.out,
        args.opset,
        args.simplify,
        args.first_group,
        args.class_map,
    )


if __name__ == "__main__":
    main()
