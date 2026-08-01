# Tiles worker

The worker serves raw `.pmtiles` archive GET/HEAD/range requests and exposes
Mapbox GL-compatible vector tiles at `/<archive>.pmtiles/{z}/{x}/{y}.mvt`.
