# Cygnus 4x9 v17 Starless Pseudocolor Viewer

Zoomable deep-zoom viewer for the Cygnus mosaic rendered with the v17
true-red / violet pseudocolor mapping (starless, nonlinear input).

- Full resolution: 31810 x 45863 px
- Grayscale toggle for a luminance-only view
- Star overlay at the same full resolution, toggleable
- OpenSeadragon based, works on desktop and mobile browsers

The star overlay is measured, not synthesised. Amplitude, shape and position
come from the photographed Ha pair (with-stars minus starless); Gaia DR3
supplies nothing but hue, matched astrometrically to 0.14 arcsec residual over
774k detections, with Hipparcos filling in the bright stars Gaia saturates on.

Only stars well above the sky get a halo, and only a narrow one. A wider halo
was tried and is wrong: the tone curve's shoulder pushes the whole halo disc to
the ceiling at once, so a star becomes a flat plate with a hard rim that reads
as a ring around it. Faint and medium stars stay point-like.

Its opacity follows the zoom level. Stars too faint to resolve individually are
real light, but a screenful covering thousands of them reads as haze and
flattens the dust lanes, so the layer fades towards 55% as the view pulls back
from 1:1 rather than having its faint end deleted from the data.

Open [index.html](https://indigo2233.github.io/cygnus-v17-starless-viewer/)
to browse the image like a sky-survey map.

Source pipeline: OKLab continuous color corridor, percentile-normalized
broad coverage and red halo, violet highlight blend, chroma-preserving
gamut compression.
