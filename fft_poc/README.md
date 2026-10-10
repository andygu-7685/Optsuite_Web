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
