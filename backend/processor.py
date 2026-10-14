import os
from pathlib import Path

os.environ.setdefault("MPLBACKEND", "Agg")

import cv2
from backend.usaf_registration import UsafRegistration

OVERLAY_STYLES = {
    "classic": {
        "line_color": (0, 230, 255), "line_width": 2,
        "label_color": (0, 230, 255), "label_width": 2,
    },
    "cyan_white": {
        "line_color": (255, 255, 0), "line_width": 3,
        "label_color": (255, 255, 255), "label_width": 2,
    },
    "magenta_yellow": {
        "line_color": (255, 0, 255), "line_width": 4,
        "label_color": (0, 230, 255), "label_width": 3,
    },
    "green_white": {
        "line_color": (80, 255, 80), "line_width": 2,
        "label_color": (255, 255, 255), "label_width": 2,
    },
}


def draw_overlay(image, elements: list[dict], best: dict, style: dict):
    overlay = image.copy()
    for item in elements:
        g, e = int(item["group"]), int(item["element"])
        selected = (g, e) == (int(best["group"]), int(best["element"]))
        # OpenCV uses BGR. Dark outlines keep marks legible on bright bars.
        line_width = style["line_width"] + int(selected)
        label_width = style["label_width"] + int(selected)

        for direction in ("vertical", "horizontal"):
            line = item[direction]
            a = tuple(map(int, line["pt_a"]))
            b = tuple(map(int, line["pt_b"]))
            cv2.line(overlay, a, b, (0, 0, 0), line_width + 3, cv2.LINE_AA)
            cv2.line(overlay, a, b, style["line_color"], line_width, cv2.LINE_AA)

        label_at = tuple(map(int, item["vertical"]["pt_a"]))
        label = f"G{g}E{e}"
        cv2.putText(
            overlay, label, label_at,
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), label_width + 2, cv2.LINE_AA,
        )
        cv2.putText(
            overlay, label, label_at,
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, style["label_color"], label_width, cv2.LINE_AA,
        )

    return overlay


def analyze(image_path: str, job_dir: str, overlay_style: str = "classic") -> dict:
    work = Path(job_dir)
    style = OVERLAY_STYLES[overlay_style]
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
        raise ValueError("No USAF group and element could be scored")

    group, element = map(int, raw[0])
    scanline_map = raw[2] or {}

    image = cv2.imread(image_path)
    if image is None:
        raise ValueError("Could not decode image")

    elements = []

    for item in scanline_map.values():
        g, e = int(item["group"]), int(item["element"])
        selected = (g, e) == (group, element)

        elements.append({
            "group": g,
            "element": e,
            "lp_per_mm": float(item["lp_per_mm"]),
            "resolution_mm": float(item["resolution_mm"]),
            "contrast_score": float(item["score"]),
            "vertical": item["vertical"],
            "horizontal": item["horizontal"],
            "selected": selected,
        })

    best = {
        "group": group,
        "element": element,
        "lp_per_mm": scorer.usaf_lp_per_mm(group, element),
        "resolution_mm": scorer.usaf_resolution_mm(group, element),
    }
    cv2.imwrite(str(work / "overlay.png"), draw_overlay(image, elements, best, style))

    return {
        "results": {
            "highest_selected_element": {"group": group, "element": element},
            "resolution_mm": best["resolution_mm"],
            "lp_per_mm": best["lp_per_mm"],
        },
        "best": best,
        "image": {"width": image.shape[1], "height": image.shape[0]},
        "elements": elements,
    }
