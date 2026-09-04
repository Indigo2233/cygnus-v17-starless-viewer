# Cygnus 7x9 v17 Starless Pseudocolor Viewer

Zoomable deep-zoom viewer for the Cygnus mosaic rendered with the v17
true-red / violet pseudocolor mapping (starless, nonlinear input).

- Full resolution: 55622 x 46752 px
- Pixel scale: 1.25005 arcsec / px
- Grayscale toggle for a luminance-only view
- Star overlay (`cygnus_stars_v10`) coloured from Gaia DR3 / Hipparcos
  and stretched with the locked v9 asinh + glow curve
- OpenSeadragon based, works on desktop and mobile browsers

The star layer is composited with `lighter` and fades as you zoom out, so
unresolved stars do not wash the dust lanes into haze.

Open [index.html](https://indigo2233.github.io/cygnus-v17-starless-viewer/)
to browse the image like a sky-survey map.

Source pipeline: OKLab continuous color corridor, percentile-normalized
broad coverage and red halo, violet highlight blend, chroma-preserving
gamut compression. JPEG quality 94 / 4:4:4 on the master, DZI tiles at
quality 85.
