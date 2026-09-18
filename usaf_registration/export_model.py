import argparse
import json
import shutil
from pathlib import Path

from ultralytics import YOLO

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = BASE_DIR / "models" / "4p_detect_ultra_pro_max.pt"
DEFAULT_OUT = BASE_DIR.parent / "microscopy-poc" / "public" / "models"


def export(model_path: Path, imgsz: int, out_dir: Path, opset: int, simplify: bool):
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
    }

    meta_path = out_dir / f"{model_path.stem}.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")

    size_mb = onnx_path.stat().st_size / 1e6
    print(f"wrote {onnx_path} ({size_mb:.1f} MB)")
    print(f"wrote {meta_path}")
    print(json.dumps(meta, indent=2))
    return meta


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--no-simplify", dest="simplify", action="store_false")
    args = parser.parse_args()

    export(args.model, args.imgsz, args.out, args.opset, args.simplify)


if __name__ == "__main__":
    main()
