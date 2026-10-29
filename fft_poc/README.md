# FFT proof of concept — USAF group 8 / 9

A single standalone script, [fft_group89.py](fft_group89.py). It does not import
or modify anything under `usaf_registration/`; point it at whatever group 8/9
images you have.

## Idea

The scanline scorer measures `max - min` intensity along a line across the bars.
At group 8/9 the bars are only 2–5 px wide, so that difference is mostly shot
noise and the resolved/unresolved call gets unstable.

A windowed 2D FFT asks a different question: *is there periodic energy at the
bar pitch?* Three noisy bars still concentrate their energy into one spectral
peak, while noise spreads out, so the peak survives well past the point where
`max - min` stops meaning anything.

The metric is that peak divided by the spectrum's own radial median at the same
radius, in dB. Normalising by the radial median matters: without it the broad
low-frequency lobe of the bar block itself (or any illumination gradient) is the
tallest thing in the spectrum and gets mistaken for the bar pitch.

## Running

```bash
python fft_poc/fft_group89.py path/to/g8_crops
```

Useful flags:

| flag | what it does |
| --- | --- |
| `--roi X,Y,W,H` | crop in pixels before the FFT (`--roi-frac` for fractions of the image) |
| `--px-per-mm S` | enables the lp/mm readout and the nearest group/element guess |
| `--expect 8 9` | restricts the peak search to those groups' frequencies (needs `--px-per-mm`) |
| `--band FMIN,FMAX` | same, but in cycles/px, when you don't know the scale |
| `--threshold-db D` | resolved/unresolved cut on the peak-over-noise ratio (default 15) |
| `--summary` | one extra plot of the metric across all inputs — against Z when the filenames carry it (`..._Z61_870_...`) |
| `--save DIR` / `--no-show` | write PNGs / skip the interactive windows |

Example on a sweep of pre-cropped group 8 patches with a known scale:

```bash
python fft_poc/fft_group89.py ./g8_patches --px-per-mm 1140 --expect 8 9 --summary
```

## Output

Per image, a 2x2 figure: the patch, the log power spectrum with the peak
circled, the radial power profile with the noise floor and the expected group
8/9 element frequencies marked, and the intensity profile across the bars. Plus
a table on stdout:

```
image                        period_px   angle   cyc/px      dB  verdict
g8e1_blur0.6.png                  4.51    19.6   0.2219    34.5  resolved    252.9 lp/mm  g8e1
g8e1_blur2.0.png                  4.70    20.6   0.2128    18.4  resolved    242.6 lp/mm  g8e1
g8e1_blur3.0.png                  2.91   154.6   0.3437    11.0  unresolved
```

## Focus score against a template — [focus_score.py](focus_score.py)

`fft_group89.py` *searches* the spectrum for the bar peak. When you already know
which element a patch is, there is nothing to search for: `focus_score.py`
reads the spectrum at that element's known frequency and compares it with an
ideal rendering of the same element (the template) at the same scale, angle
and pixel sampling:

```
MTF = sqrt((P_patch - P_noise) / P_template)      at the bar frequency
```

That is the optics' modulation transfer at the bar frequency: 1 means full
contrast, 0 means the bars are blurred away. It doesn't depend on lighting or
the noise level, and because it compares spectral magnitudes (not pixels), it
tolerates a pixel or so of registration error. Per Z, the **focus score** is
the mean MTF over the group 8/9 elements, both bar orientations.

```bash
python fft_poc/make_test_images.py                                  # synthetic sweep -> fft_poc/test_images
python fft_poc/focus_score.py fft_poc/test_images --px-per-mm 1140  # -> fft_poc/test_images/report/report.html
```

Patches are named `g8e3_V_Z61_870.png` (element, `V`ertical/`H`orizontal bars,
optional Z). The test set is a known-answer sweep: Gaussian defocus with some
astigmatism, shot noise, and up to 1 px / 1 deg of misregistration. Its
`manifest.csv` holds the true MTF of every patch, and the report checks the
measurements against it.

The report (`report.html`, single file, plus PNGs and `scores.csv`) has:

- best focus Z (parabola-refined), per orientation, and the V–H gap (astigmatism)
- the Z range where the focus score stays above 50% of its peak
- the resolution limit at best focus (finest element with MTF >= 0.15 and >= 6 dB over noise, all coarser ones too)
- MTF vs lp/mm at best and half focus, an element x Z heatmap, and measured-vs-true MTF

Optional flags: `--na 0.4 --wavelength-nm 550` overlays the diffraction-limited
MTF; `--black` subtracts a camera offset; `--mtf-threshold` and `--detect-db`
set the resolved cut.

Limits: elements above 0.42 cycles/px (about 480 lp/mm at 1140 px/mm, so g9e1)
are measured but not scored. That close to Nyquist the result depends on
where the bars fall within a pixel. The patch needs to be mostly one element
on a white background, because the white level is read from the patch border.

## In the pipeline — [usaf_registration/fft_scoring.py](../usaf_registration/fft_scoring.py)

`focus_score.py` scores pre-cropped, axis-aligned patches of a positive target
at a scale given on the command line. `fft_scoring.py` is the same measurement
with the four things real pipeline frames need: the bar angle comes from the
scanline, the patch is sized in bar periods, the contrast reference handles a
negative target (bright bars on black, which is what this one is), and the
scale comes from the grid's own `side_length`.

```bash
python fft_poc/validate_fft_scoring.py     # six checks, including parity with focus_score.py
python fft_poc/calibrate_scale.py          # measures MM_PER_USAF_UNIT on real frames
```

`calibrate_scale.py` is not optional before trusting a number from a new optical
setup. The score reads the spectrum at the frequency it is told to expect, and
`MM_PER_USAF_UNIT` is what converts `side_length` into that frequency. Estimating
it from the scanline spans gave 0.78; sweeping it against real frames gives
0.565, a factor of sqrt(2) — three elements — which is enough to halve every MTF
without the curve looking wrong.

## Caveats

- The 15 dB threshold is a starting point from synthetic blurred bars, not a
  calibrated number. Run a focus sweep with `--summary` on real data and pick
  the knee.
- The script needs a patch that is mostly the bar element. It has no registration
  of its own — cropping is yours to supply via `--roi`, or upstream.
- `--px-per-mm` only affects labelling. Without it you still get the period in
  pixels and the resolved/unresolved call.
- Requires numpy and matplotlib; OpenCV is used for loading when present, which
  is what lets it read `.bmp`/`.tif` as well as `.png`.
