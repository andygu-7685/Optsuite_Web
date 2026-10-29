import cv2
import numpy as np
from pathlib import Path
from . import fft_scoring
from .pattern_crop import find_pattern_crop, classify_pattern_resolution, show_pattern_classification_results








def score_pattern_crops(self, image_label="image"):
    """
    Score saved pattern crops from low to high resolution. Return the last element
    before either vertical or horizontal crop becomes unresolved.
    """
    crop_dir = Path(self.C.CROP_DIR)
    evaluated_crops = []
    last_resolved_result = None
    
    # Store indices as a list so we can look ahead
    scan_indices = [idx for idx in sorted(self.C.score_table.keys()) if idx >= 0]
    
    for i, scan_index in enumerate(scan_indices):
        group, element = self.C.score_table[scan_index]
        vertical_path = self.find_pattern_crop(crop_dir, image_label, "vertical", scan_index)
        horizontal_path = self.find_pattern_crop(crop_dir, image_label, "horizontal", scan_index)

        vertical_result = None
        horizontal_result = None
        vertical_img = None
        horizontal_img = None
        vertical_confidence = None
        horizontal_confidence = None
        
        if vertical_path is not None:
            vertical_img = cv2.imread(str(vertical_path))
            if vertical_img is not None:
                vertical_result, vertical_confidence = self.classify_pattern_resolution(vertical_img)
        if horizontal_path is not None:
            horizontal_img = cv2.imread(str(horizontal_path))
            # rotate image 90 degree clockwise
            if self.C.OPTIONAL_SETTING:
                horizontal_img = cv2.rotate(horizontal_img, cv2.ROTATE_90_CLOCKWISE)
            if horizontal_img is not None:
                horizontal_result, horizontal_confidence = self.classify_pattern_resolution(horizontal_img)

        # for visualization
        evaluated_crops.append(
            {
                "group": group,
                "element": element,
                "vertical_img": vertical_img,
                "horizontal_img": horizontal_img,
                "vertical_result": vertical_result,
                "horizontal_result": horizontal_result,
                "vertical_confidence": vertical_confidence,
                "horizontal_confidence": horizontal_confidence,
            }
        )

        # loop breaking condition
        if ((str(vertical_result).lower() == "unresolved" or str(horizontal_result).lower() == "unresolved") and self.C.SCORE_METHOD == "min") \
            or ((str(vertical_result).lower() == "unresolved" and str(horizontal_result).lower() == "unresolved") and (self.C.SCORE_METHOD == "max" or self.C.SCORE_METHOD == "mean")):
            
            # Look ahead to verify if the next two indices contain any unresolved patterns
            is_fluke = False
            if i + 1 < len(scan_indices):
                unresolved_in_lookahead = False
                for offset in range(1, 3):
                    if i + offset < len(scan_indices):
                        next_idx = scan_indices[i + offset]
                        
                        # Check vertical pattern of future index
                        v_path = self.find_pattern_crop(crop_dir, image_label, "vertical", next_idx)
                        if v_path is not None:
                            v_img = cv2.imread(str(v_path))
                            if v_img is not None:
                                v_res, _ = self.classify_pattern_resolution(v_img)
                                if str(v_res).lower() == "unresolved":
                                    unresolved_in_lookahead = True
                                    break
                                    
                        # Check horizontal pattern of future index
                        h_path = self.find_pattern_crop(crop_dir, image_label, "horizontal", next_idx)
                        if h_path is not None:
                            h_img = cv2.imread(str(h_path))
                            if self.C.OPTIONAL_SETTING:
                                h_img = cv2.rotate(h_img, cv2.ROTATE_90_CLOCKWISE)
                            if h_img is not None:
                                h_res, _ = self.classify_pattern_resolution(h_img)
                                if str(h_res).lower() == "unresolved":
                                    unresolved_in_lookahead = True
                                    break
                
                        
                # If no unresolved patterns were found in the look-ahead, treat this break as a fluke
                if not unresolved_in_lookahead:
                    is_fluke = True

            # If it's not a fluke, execute the standard termination logic
            if not is_fluke:
                if self.C.PATTERN_CLASSIFICATION_SHOW_PLOT:
                    self.show_pattern_classification_results(evaluated_crops)
                if self.C.DEBUG_MODE:
                    if last_resolved_result is not None:
                        print(
                            f"Pattern crop classifier best focus: "
                            f"group {last_resolved_result['group']}, element {last_resolved_result['element']}"
                        )
                    else:
                        print("Pattern crop classifier found unresolved at first scanned element")
                if last_resolved_result is None:
                    raise RuntimeError("usaf_algo.score_pattern_crops: Pattern crop classifier found unresolved at first scanned element, no valid focus score can be determined.")
                return last_resolved_result

        if (str(vertical_result).lower() == "resolved" and str(horizontal_result).lower() == "resolved" and self.C.SCORE_METHOD == "min") \
            or ((str(vertical_result).lower() == "resolved" or str(horizontal_result).lower() == "resolved") and (self.C.SCORE_METHOD == "max" or self.C.SCORE_METHOD == "mean")):
            last_resolved_result = {
                "group": group,
                "element": element,
                "scan_index": scan_index,
            }

    if self.C.DEBUG_MODE:
        if last_resolved_result is not None:
            print(
                f"Pattern crop classifier best focus: "
                f"group {last_resolved_result['group']}, element {last_resolved_result['element']}"
            )
        else:
            print("Pattern crop classifier found no resolved pattern")
    if self.C.PATTERN_CLASSIFICATION_SHOW_PLOT:
        self.show_pattern_classification_results(evaluated_crops)
    return last_resolved_result



















def find_best_focus_group(self, scores_list, threshold=0.3):
    '''
    Find the index in the scores where the descending order of scores changes to ascending order,
    or where the score drops below a certain threshold (e.g., 0.2), which indicates the best focus group.
    Return the corresponding group and element number from the score table.
    '''
    # We need at least 2 scores to compare
    if scores_list is None:
        return None, None
    chosen_index = 0
    if len(scores_list) < 2:
        print("Not enough scores to compare")
        return self.C.score_table[chosen_index], chosen_index

    last_yolo_index = 1
    for i in range(0, len(scores_list)): 
        if scores_list[i]["score"] > threshold and scores_list[i]["type"] == "yolo":
            last_yolo_index = i + 1

    last_local_min_index = 1
    for i in range(0, len(scores_list)):
        if scores_list[i]["score"] > threshold and scores_list[i]["type"] == "local_min":
            last_local_min_index = i + 1

    last_index = max(last_yolo_index, last_local_min_index)

    if last_index == len(scores_list):
        print("all resolved")
        chosen_index = len(self.C.score_table) - 1
        return self.C.score_table[chosen_index], chosen_index
    
    for i in range(last_index, len(scores_list)):
        if self.C.FOCUS_GROUP_LAST_ABOVE_THRESHOLD:
            if scores_list[i]["score"] > threshold:
                chosen_index = min(i, len(self.C.score_table) - 1)
        elif scores_list[i]["score"] > scores_list[i - 1]["score"] * 1.2 or scores_list[i]["score"] < threshold:
            # If the score starts going UP, the previous index was the "bottom"
            chosen_index = min(i - 1, len(self.C.score_table) - 1)
            return self.C.score_table[chosen_index], chosen_index

    if self.C.FOCUS_GROUP_LAST_ABOVE_THRESHOLD:
        return self.C.score_table[chosen_index], chosen_index

    # If it never goes up, return first element
    print("No score goes up")
    chosen_index = len(self.C.score_table) - 1
    return self.C.score_table[chosen_index], chosen_index











# --------------------------------------------------------------------------------------------
# FFT scoring
# --------------------------------------------------------------------------------------------


# The element could not be measured at this scale -- not a verdict about focus,
# so the resolution-limit walk steps over it instead of stopping. The coarsest
# element hits this routinely: a few periods of a 90 px period is past the
# largest patch fft_scoring will build.
FFT_UNMEASURABLE = ("patch too small", "patch off image", "no contrast", "no template")


def score_scanlines_fft(self, gray, scanlines, side_length):
    """MTF of every scanline's element, keyed the same way as the contrast scores.

    gray is the whole frame as float in [0, 1]; scanlines carries the endpoints
    the grid produced, which give both the patch centre and the bar angle. The
    bar frequency comes from side_length, so this needs no extra calibration
    beyond fft_scoring.MM_PER_USAF_UNIT.
    """
    if not self.C.FFT_SCORING or not scanlines:
        return {}

    px_per_mm = fft_scoring.px_per_mm_from_side_length(side_length, self.C.G1)
    white_level = fft_scoring.frame_white_level(gray)
    unique_count = len(self.C.score_table)

    scores = {}
    for index, scanline in scanlines.items():
        group, element = self.C.score_table[index % unique_count]
        row = fft_scoring.score_element(
            gray, scanline["pt_a"], scanline["pt_b"], group, element, px_per_mm,
            white_level=white_level,
            patch_periods=self.C.FFT_PATCH_PERIODS,
            mtf_threshold=self.C.FFT_MTF_THRESHOLD,
            detect_db=self.C.FFT_DETECT_DB,
        )
        row["orientation"] = "vertical" if index < unique_count else "horizontal"
        scores[index] = row

    if self.C.FFT_DEBUG:
        print(f"FFT scoring: {px_per_mm:.0f} px/mm from side_length {side_length:.1f}, "
              f"G1 {self.C.G1}, white level {white_level:.3f}")
    return scores


def merge_fft_orientations(self, fft_scores):
    """One entry per element, vertical and horizontal merged by SCORE_METHOD.

    Mirrors how the contrast scores are merged, so the two paths can be compared
    element for element. An element whose patch could not be built in one
    orientation falls back to the other rather than dropping out.
    """
    unique_count = len(self.C.score_table)
    merged = {}
    for index in range(unique_count):
        pair = [fft_scores.get(index), fft_scores.get(index + unique_count)]
        usable = [r for r in pair if r is not None and r["status"] not in FFT_UNMEASURABLE
                  and np.isfinite(r["mtf"])]
        group, element = self.C.score_table[index]
        entry = {"group": group, "element": element, "scan_index": index,
                 "vertical": pair[0], "horizontal": pair[1]}

        if not usable:
            # Either unmeasurable (skip it) or past the sampling limit (stop there).
            statuses = [r["status"] for r in pair if r is not None]
            entry.update(mtf=float("nan"), detect_db=float("nan"),
                         status=statuses[0] if statuses else "missing")
            merged[index] = entry
            continue

        mtfs = [r["mtf"] for r in usable]
        dbs = [r["detect_db"] for r in usable]
        if self.C.SCORE_METHOD == "max":
            mtf, detect_db = max(mtfs), max(dbs)
        elif self.C.SCORE_METHOD == "mean":
            mtf, detect_db = float(np.mean(mtfs)), float(np.mean(dbs))
        else:
            mtf, detect_db = min(mtfs), min(dbs)

        entry.update(mtf=float(mtf), detect_db=float(detect_db),
                     status="resolved" if mtf >= self.C.FFT_MTF_THRESHOLD
                     and detect_db >= self.C.FFT_DETECT_DB else "unresolved")
        merged[index] = entry
    return merged


def find_fft_focus_group(self, fft_scores):
    """Finest element the FFT resolves, with every coarser measured one resolved too.

    Same reading as score_pattern_crops, on a different measurement: walk from
    coarse to fine and stop at the first element that is unresolved or past the
    sampling limit. Returns the usual {group, element, scan_index} or None.
    """
    if not fft_scores:
        return None

    merged = self.merge_fft_orientations(fft_scores)
    best = None
    for index in sorted(merged):
        entry = merged[index]
        if entry["status"] in FFT_UNMEASURABLE or entry["status"] == "missing":
            continue
        if entry["status"] != "resolved":
            break
        best = entry

    if self.C.FFT_DEBUG:
        for index in sorted(merged):
            entry = merged[index]
            print(f"  FFT g{entry['group']}e{entry['element']}: "
                  f"mtf {entry['mtf']:.3f} db {entry['detect_db']:6.1f}  {entry['status']}")
        if best is None:
            print("FFT found no resolved element")
        else:
            print(f"FFT best focus: group {best['group']}, element {best['element']}")

    if best is None:
        return None
    return {"group": best["group"], "element": best["element"],
            "scan_index": best["scan_index"], "mtf": best["mtf"]}


def combine_focus_results(self, classifier_result, fft_result):
    """Reconcile the classifier's answer with the FFT's.

    With FFT_EXTEND_ONLY the FFT can only push the answer finer, never coarser:
    on real frames it reads 0 to 5 elements past the classifier and never short
    of it, so a coarser FFT answer means the FFT failed, not that the classifier
    was optimistic.
    """
    if fft_result is None:
        return classifier_result
    if classifier_result is None:
        return fft_result
    if not self.C.FFT_EXTEND_ONLY:
        return fft_result
    if fft_result["scan_index"] <= classifier_result["scan_index"]:
        return classifier_result
    if self.C.DEBUG_MODE or self.C.FFT_DEBUG:
        print(f"FFT extends the score from "
              f"g{classifier_result['group']}e{classifier_result['element']} to "
              f"g{fft_result['group']}e{fft_result['element']}")
    return fft_result
