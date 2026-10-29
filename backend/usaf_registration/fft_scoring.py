"""Template-referenced FFT scoring of a single USAF element.

The pipeline accounts for four properties of real target frames:

  1. polarity   -- this target has bright bars on black, so the patch border is
                   the dark reference and the bright reference comes from the
                   frame. See contrast_amplitude().
  2. angle      -- the bar direction comes from the scanline, so a rotated
                   target works.
  3. patch size -- sized in bar periods instead of a fixed 72 px, so the same
                   call works from group 2 to group 9.
  4. scale      -- px/mm is derived from the calibrated side_length.

The measurement itself is unchanged: the patch's power at the element's *known*
bar frequency, divided by the power of an ideal rendering of the same element at
the same scale, angle and pixel sampling.

    mtf = sqrt((P_patch - P_noise) / P_template)

Nothing is searched for, which matters -- a blind peak search on these patches
locks onto the neighbouring element block. Because both sides go through the
same window and FFT, the window's leakage cancels in the ratio, and because
only spectral magnitudes are compared, a pixel or two of registration error
does not move the answer.

Standalone: numpy + OpenCV, nothing from this package is imported.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

PAD = 4                     # zero-padding factor -> finer frequency grid
DISC = 0.08                 # integration radius around the bar frequency, as a fraction of f
NOISE_BAND = (0.75, 1.25)   # annulus (fractions of f) the noise floor is estimated from
NOISE_GUARD = 0.5           # ...excluding this radius around the bar peak
# Above this (cycles/px) the +f peak and the wrapped -f peak overlap, so the
# reading depends on the bars' sub-pixel phase: reported, not used for scores.
NEAR_NYQUIST = 0.42

# Patch width in bar periods. The 3-bar block is 2.5 periods across and 5 long,
# so this is the block plus a margin for registration error. Wider is worse two
# ways: more empty field under the Hann window costs signal, and on a real
# target the neighbouring element -- only 12% away in frequency, against a disc
# of 8% -- starts leaking in.
PATCH_PERIODS = 4.0
MIN_PATCH_PX = 16
MAX_PATCH_PX = 256          # keeps the oversampled template render bounded
MIN_PATCH_PERIODS = 3.0     # below this there are too few cycles to measure

MTF_THRESHOLD = 0.15        # starting points from synthetic bars, not calibrated
DETECT_DB = 6.0

# Millimetres per USAF coordinate unit at the G1 = 2 nesting level, i.e. per
# unit of the side_length that grid_calculation returns. DISC below wants this
# good to about 3%, so it was measured by sweeping the assumed scale and taking
# the peak of the mean MTF. Four of five calibration frames landed on 0.565
# exactly and the blurriest on 0.527, over side_lengths of 225-231 px. Recalibrate
# for a new optical setup; an earlier estimate from scanline
# spans came out at 0.78, a factor of sqrt(2) (three elements) off, which is
# enough to halve every MTF without looking obviously wrong.
MM_PER_USAF_UNIT = 0.565


# --------------------------------------------------------------------------
# USAF bookkeeping and scale
# --------------------------------------------------------------------------

def lp_per_mm(group: int, element: int) -> float:
    return float(2.0 ** (group + (element - 1) / 6.0))


def px_per_mm_from_side_length(side_length: float, g1: int) -> float:
    """Image scale from the calibrated grid.

    side_length is pixels per USAF coordinate unit, and the coordinate system is
    re-based on whichever nested square was detected: every step of the nesting
    is two groups, so one unit shrinks by 2 ** (g1 - 2) millimetres.
    """
    return float(side_length) * 2.0 ** (g1 - 2) / MM_PER_USAF_UNIT


def element_period_px(side_length: float, g1: int, group: int, element: int) -> float:
    """Bar period in pixels for one element of the scanline grid.

    Equivalent to (side_length / MM_PER_USAF_UNIT) * 2 ** (-2 - d - (e - 1) / 6)
    with d = group - g1, so g1 cancels and the same per-index constant holds at
    every nesting level.
    """
    return px_per_mm_from_side_length(side_length, g1) / lp_per_mm(group, element)


def scanline_angle_deg(pt_a, pt_b) -> float:
    """Direction across the bars, in the image's row/column frame."""
    dx = float(pt_b[0]) - float(pt_a[0])
    dy = float(pt_b[1]) - float(pt_a[1])
    return float(np.degrees(np.arctan2(dy, dx)) % 180.0)


# --------------------------------------------------------------------------
# template
# --------------------------------------------------------------------------

def element_fine(group, element, px_per_mm, angle_deg, shape, shift=(0.0, 0.0), oversample=8):
    """Ideal USAF element on a grid `oversample` times finer than the pixels:
    three dark bars (0) on a bright field (1), period/2 wide and 2.5 periods
    long (5:1). angle_deg is the direction across the bars: 0 = vertical bars."""
    h, w = shape
    period = px_per_mm / lp_per_mm(group, element)
    ys = (np.arange(h * oversample) + 0.5) / oversample - h / 2 - shift[1]
    xs = (np.arange(w * oversample) + 0.5) / oversample - w / 2 - shift[0]
    xx, yy = np.meshgrid(xs, ys)
    t = np.radians(angle_deg)
    u = xx * np.cos(t) + yy * np.sin(t)    # across the bars
    v = -xx * np.sin(t) + yy * np.cos(t)   # along the bars
    k = np.round(u / period)               # nearest bar centre: -1, 0, +1
    bar = (np.abs(k) <= 1) & (np.abs(u - k * period) < period / 4) & (np.abs(v) < 1.25 * period)
    return np.where(bar, 0.0, 1.0)


def bin_pixels(fine: np.ndarray, oversample: int) -> np.ndarray:
    """Area-average onto the pixel grid: the sensor's pixel integration."""
    h, w = fine.shape[0] // oversample, fine.shape[1] // oversample
    return fine.reshape(h, oversample, w, oversample).mean(axis=(1, 3))


def lowpass(fine: np.ndarray, cutoff_cpx: float, oversample: int) -> np.ndarray:
    """Remove everything above cutoff (cycles per *pixel*) from a fine-grid image."""
    spec = np.fft.fft2(fine - 1.0)  # background is 1, so this is periodic-clean
    fy = np.fft.fftfreq(fine.shape[0]) * oversample
    fx = np.fft.fftfreq(fine.shape[1]) * oversample
    keep = np.hypot(*np.meshgrid(fx, fy)) <= cutoff_cpx
    return np.real(np.fft.ifft2(spec * keep)) + 1.0


def template_oversample(period_px: float) -> int:
    """Finer sampling for finer bars: the bar edge is period/4 from its centre,
    so what matters is sub-samples per bar, not per patch."""
    return int(np.clip(round(32.0 / max(period_px, 1e-6)), 2, 16))


def render_element(group, element, px_per_mm, angle_deg, shape, band_limit=None, oversample=8):
    """Ideal element as the sensor would see it. With band_limit (cycles/px) the
    bar harmonics are removed before pixel binning, so they cannot alias back
    onto the fundamental the score is measured at."""
    fine = element_fine(group, element, px_per_mm, angle_deg, shape, oversample=oversample)
    if band_limit:
        fine = lowpass(fine, band_limit, oversample)
    return bin_pixels(fine, oversample)


# --------------------------------------------------------------------------
# spectral measurement
# --------------------------------------------------------------------------

def power_spectrum(img: np.ndarray) -> np.ndarray:
    h, w = img.shape
    window = np.outer(np.hanning(h), np.hanning(w))
    spec = np.fft.fft2((img - img.mean()) * window, s=(PAD * h, PAD * w))
    return np.abs(np.fft.fftshift(spec)) ** 2


@lru_cache(maxsize=64)
def freq_grid(shape):
    fx = np.fft.fftshift(np.fft.fftfreq(PAD * shape[1]))
    fy = np.fft.fftshift(np.fft.fftfreq(PAD * shape[0]))
    return np.meshgrid(fx, fy)


@lru_cache(maxsize=512)
def _template_spectrum(group, element, angle_q, shape, px_per_mm_q):
    # Fundamental only: real optics have usually removed the 3rd harmonic
    # before the sensor, and an aliased one would sit right on the fundamental.
    period = px_per_mm_q / lp_per_mm(group, element)
    f = 1.0 / period
    tmpl = render_element(group, element, px_per_mm_q, angle_q, shape,
                          band_limit=2 * f, oversample=template_oversample(period))
    return power_spectrum(tmpl)


def template_spectrum(group, element, angle_deg, shape, px_per_mm):
    """Cached template power. The angle and scale are continuous here (unlike
    focus_score, where both were fixed), so they are quantised for the cache:
    0.5 deg and 0.1 px/mm move the fundamental far less than DISC."""
    return _template_spectrum(group, element, round(angle_deg * 2) / 2,
                              tuple(shape), round(float(px_per_mm), 1))


def border_level(img: np.ndarray, frac: int = 10) -> float:
    """Median of the patch border: the field the element sits on. Defocus
    spreads the bars but cannot change the level far away from them."""
    b = max(2, min(img.shape) // frac)
    frame = np.concatenate([img[:b].ravel(), img[-b:].ravel(),
                            img[:, :b].ravel(), img[:, -b:].ravel()])
    return float(np.median(frame))


def contrast_amplitude(patch, white_level=None, black_level=0.0, polarity="auto"):
    """(amplitude, polarity, field) for normalising a patch to unit contrast.

    The field level is read from the border. The opposite level -- what the bars
    approach at perfect focus -- cannot be read from the patch, because that is
    exactly what defocus destroys. For a positive target (dark bars, bright
    field) it is the black level, which is the sensor offset. For a negative one
    (bright bars on black, which is what this target is) it has to be measured
    somewhere the bars are large enough to reach it, i.e. over the whole frame,
    and passed in as white_level.
    """
    field = border_level(patch)
    if polarity == "auto":
        if white_level is None:
            polarity = "positive"
        else:
            polarity = "negative" if field < 0.5 * (white_level + black_level) else "positive"

    if polarity == "negative":
        if white_level is None:
            raise ValueError("fft_scoring.contrast_amplitude: a negative target needs white_level")
        amplitude = white_level - field
    else:
        amplitude = field - black_level
    return float(amplitude), polarity, field


def frame_white_level(img: np.ndarray, percentile: float = 99.5) -> float:
    """Bright reference for a negative target, over a whole frame. A high
    percentile rather than the max, so a hot pixel cannot set the scale."""
    return float(np.percentile(np.asarray(img, dtype=np.float64), percentile))


def score_patch(patch, group, element, px_per_mm, angle_deg, *,
                white_level=None, black_level=0.0, polarity="auto",
                mtf_threshold=MTF_THRESHOLD, detect_db=DETECT_DB, keep_images=False) -> dict:
    """MTF of one patch at its element's bar frequency.

    patch is float in [0, 1]; angle_deg is the direction across the bars.
    """
    patch = np.asarray(patch, dtype=np.float64)
    lpmm = lp_per_mm(group, element)
    f = lpmm / px_per_mm
    row = {"group": group, "element": element, "angle_deg": float(angle_deg),
           "lp_mm": lpmm, "f_cpx": f, "period_px": (1.0 / f) if f > 0 else float("inf"),
           "mtf": np.nan, "detect_db": np.nan, "polarity": polarity}

    if f >= 0.5:
        return {**row, "status": "beyond Nyquist"}
    if min(patch.shape) < MIN_PATCH_PX or min(patch.shape) * f < MIN_PATCH_PERIODS:
        return {**row, "status": "patch too small"}

    amplitude, polarity, field = contrast_amplitude(patch, white_level, black_level, polarity)
    row["polarity"] = polarity
    if not np.isfinite(amplitude) or amplitude <= 1e-6:
        return {**row, "status": "no contrast"}

    # Unit contrast, either polarity. The mean is removed inside power_spectrum
    # and only magnitudes are used, so the sign of the normalised patch does not
    # reach the result -- the amplitude is the whole point of this step.
    norm = (patch - field) / amplitude

    fxx, fyy = freq_grid(tuple(patch.shape))
    kx, ky = f * np.cos(np.radians(angle_deg)), f * np.sin(np.radians(angle_deg))
    d = np.minimum(np.hypot(fxx - kx, fyy - ky), np.hypot(fxx + kx, fyy + ky))
    r = np.hypot(fxx, fyy)
    disc = d < DISC * f
    ring = (r > NOISE_BAND[0] * f) & (r < NOISE_BAND[1] * f) & (d > NOISE_GUARD * f)
    if not disc.any() or not ring.any():
        return {**row, "status": "patch too small"}

    power = power_spectrum(norm)
    # White noise bins are exponentially distributed: mean = median / ln 2.
    p_noise = np.median(power[ring]) / np.log(2) * disc.sum()
    p_sig = power[disc].sum()
    p_tmpl = template_spectrum(group, element, angle_deg, patch.shape, px_per_mm)[disc].sum()
    if p_tmpl <= 0:
        return {**row, "status": "no template"}

    row["mtf"] = float(np.sqrt(max(p_sig - p_noise, 0.0) / p_tmpl))
    row["detect_db"] = float(10 * np.log10(max(p_sig, 1e-30) / max(p_noise, 1e-30)))
    if f > NEAR_NYQUIST:
        row["status"] = "near Nyquist"
    else:
        row["status"] = ("resolved" if row["mtf"] >= mtf_threshold and row["detect_db"] >= detect_db
                         else "unresolved")
    if keep_images:
        row["norm"] = norm
    return row


# --------------------------------------------------------------------------
# patch extraction
# --------------------------------------------------------------------------

def patch_size_px(period_px: float, patch_periods: float = PATCH_PERIODS) -> int:
    """Even patch side, in pixels, for a given bar period."""
    size = int(round(patch_periods * period_px))
    return int(np.clip(size + (size & 1), MIN_PATCH_PX, MAX_PATCH_PX))


def extract_patch(gray, pt_a, pt_b, period_px, patch_periods=PATCH_PERIODS):
    """Square patch centred on the scanline, sized from the bar period.

    No rotation: resampling a patch would blur it, and that blur would be read
    as the optics' own. The template is rendered at the scanline angle instead.
    Returns (patch, (x0, y0)) or (None, None) when it does not fit in the frame.
    """
    size = patch_size_px(period_px, patch_periods)
    half = size // 2
    cx = 0.5 * (float(pt_a[0]) + float(pt_b[0]))
    cy = 0.5 * (float(pt_a[1]) + float(pt_b[1]))
    x0, y0 = int(round(cx)) - half, int(round(cy)) - half
    if x0 < 0 or y0 < 0 or x0 + size > gray.shape[1] or y0 + size > gray.shape[0]:
        return None, None
    return gray[y0:y0 + size, x0:x0 + size], (x0, y0)


def score_element(gray, pt_a, pt_b, group, element, px_per_mm, *,
                  white_level=None, black_level=0.0, polarity="auto",
                  patch_periods=PATCH_PERIODS, mtf_threshold=MTF_THRESHOLD,
                  detect_db=DETECT_DB, keep_images=False) -> dict:
    """Score one element of the scanline grid, in place in the full frame.

    gray is a float image in [0, 1]; pt_a/pt_b are the scanline endpoints the
    grid produced, which cross the bars and so give both the patch centre and
    the bar angle.
    """
    period = px_per_mm / lp_per_mm(group, element)
    angle_deg = scanline_angle_deg(pt_a, pt_b)
    patch, origin = extract_patch(gray, pt_a, pt_b, period, patch_periods)
    if patch is None:
        return {"group": group, "element": element, "angle_deg": angle_deg,
                "lp_mm": lp_per_mm(group, element), "f_cpx": 1.0 / period,
                "period_px": period, "mtf": np.nan, "detect_db": np.nan,
                "polarity": polarity, "status": "patch off image"}

    row = score_patch(patch, group, element, px_per_mm, angle_deg,
                      white_level=white_level, black_level=black_level, polarity=polarity,
                      mtf_threshold=mtf_threshold, detect_db=detect_db, keep_images=keep_images)
    row["origin"] = origin
    row["patch_px"] = int(patch.shape[0])
    if keep_images:
        row["patch"] = patch
    return row
