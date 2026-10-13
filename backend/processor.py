import os
from pathlib import Path

os.environ.setdefault("MPLBACKEND", "Agg")

import cv2
from usaf_registration import UsafRegistration

def analyze(image_path: str, job_dir: str) -> dict:
    work = Path(job_dir)
    scorer = UsafRegistration()

    # The existing algorithm writes crops and logs. Isolate each job.
    scorer.C.CROP_DIR = work / "crops"
    scorer.C.LOG_PATH = work / "logs"
    scorer.C.LOG_PATH.mkdir(parents=True, exist_ok=True)
    scorer.C.DEBUG_MODE = False
    scorer.C.PREVIEW_MODE = False
    scorer.C.PATTERN_CLASSIFICATION_SHOW_PLOT = False

    raw = scorer.score_image_routine(image_path)
    if not raw or raw[0] is None:
        return ValueError("No USAF group and element could be scored")

    group, element = map(int, raw[0])
    scanline_map = raw[2] or {}

    image = cv2.imread(image_path)
    if image is None:
        raise ValueError("Could not decode image")

    overlay = image.copy()
    elements = []

    for item in scanline_map.values():
        g, e = int(item["group"]), int(item["element"])
        selected = (g, e) == (group, element)
        color = (60, 220, 60) if selected else (0, 200, 255)

        for direction in ("vertical", "horizontal"):
            line = item[direction]
            a = tuple(map(int, line["pt_a"]))
            b = tuple(map(int, line["pt_b"]))
            cv2.line(overlay, a, b, color, 2 if selected else 1)

        label_at = tuple(map(int, item["vertical"]["pt_a"]))
        cv2.putText(
            overlay, f"G{g}E{e}", label_at,
            cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1,
        )

        elements.append({
            "group": g,
            "element": e,
            "lp_per_mm": float(item["lp_per_mm"]),
            "contrast_score": float(item["score"]),
            "vertical": item["vertical"],
            "horizontal": item["horizontal"],
            "selected": selected,
        })

    cv2.imwrite(str(work / "overlay.png"), overlay)

    return {
        "best": {
            "group": group,
            "element": element,
            "lp_per_mm": scorer.usaf_lp_per_mm(group, element),
        },
        "image": {"width": image.shape[1], "height": image.shape[0]},
        "elements": elements,
    }
