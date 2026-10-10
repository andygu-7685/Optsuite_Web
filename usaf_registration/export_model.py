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


def resolution(group: int, element: int) -> dict:
    """One group/element with its lp/mm and bar width, as the frontend reads it."""
    return {
        "group": int(group),
        "element": int(element),
        "lpPerMm": round(lp_per_mm(group, element), 4),
        "lineWidthUm": round(line_width_um(group, element), 4),
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


def score_table(first_group: int = FIRST_GROUP) -> list:
    """Scan order: elements 2-4 of the first group, then five full groups."""
    rows = [(first_group, element) for element in (2, 3, 4)]
    for offset in range(1, 6):
        rows.extend((first_group + offset, element) for element in ELEMENTS)
    return [{"index": index, **resolution(group, element)} for index, (group, element) in enumerate(rows)]


def usaf_meta(names: dict, first_group: int = FIRST_GROUP) -> dict:
    """Group/element + lp/mm the browser cannot derive on its own.

    `classes` is filled for models whose class labels name an element ("g3e4");
    `scoreTable` is the scan order scoring walks, so a scan index maps to a
    group/element without re-deriving the table in JS.
    """
    classes = {}
    for index, label in names.items():
        parsed = parse_group_element(str(label))
        if parsed:
            classes[int(index)] = resolution(*parsed)
    return {
        "firstGroup": int(first_group),
        "classes": classes,
        "scoreTable": score_table(first_group),
    }


def export(model_path: Path, imgsz: int, out_dir: Path, opset: int, simplify: bool, first_group: int = FIRST_GROUP):
    model_path = Path(model_path).expanduser().resolve()
    if not model_path.exists():
        raise FileNotFoundError(f"export_model.export: no checkpoint at {model_path}")

    out_dir = Path(out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    model = YOLO(str(model_path))

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

    names = model.names or {}
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
        "usaf": usaf_meta(names, first_group),
    }

    meta_path = out_dir / f"{model_path.stem}.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")

    size_mb = onnx_path.stat().st_size / 1e6
    print(f"wrote {onnx_path} ({size_mb:.1f} MB)")
    print(f"wrote {meta_path}")
    labelled = len(meta["usaf"]["classes"])
    print(f"usaf: first group {first_group}, {labelled}/{len(names)} class(es) named per element")
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
    args = parser.parse_args()

    export(args.model, args.imgsz, args.out, args.opset, args.simplify, args.first_group)


if __name__ == "__main__":
    main()
