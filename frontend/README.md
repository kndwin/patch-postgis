# Patch PostGIS — MVT Visual Tester

Minimal Vite + Mapbox GL JS frontend to visually exercise the synced
cadastre MVT tile API served by the backend.

## Requirements

- **Mapbox access token** — sign up at [mapbox.com](https://www.mapbox.com/)
  and create a public token on your account page.
- Set the token in a local `.env` file (see Setup below).

## Setup

```bash
# 1. Create your local env file from the example
cp .env.example .env
# Edit .env and paste your Mapbox public token:
#   VITE_MAPBOX_ACCESS_TOKEN=pk.ey...

# 2. Install dependencies
bun install
```

## Quick start

```bash
# 1. Start the backend (port 3000)
cd ..          # repo root
bun run start

# 2. In a second terminal, start the Vite dev server
cd frontend
bun run dev     # → http://localhost:5173
```

The Vite dev server proxies `/tiles` → `http://localhost:3000`, so without a
PMTiles URL the browser requests tiles same-origin at `/tiles/{z}/{x}/{y}.mvt`.

## Static PMTiles production tiles

The map can instead read a single immutable PMTiles archive from object storage
and a CDN. Mapbox GL fetches only HTTP byte ranges for visible tiles, so this
removes per-tile Railway, application, and PostGIS work. Set this build-time
environment variable to switch sources:

```bash
VITE_CADASTRE_PMTILES_URL=https://tiles.example.com/nsw-cadastre-20260801.pmtiles
```

The host must support `Range` requests, preserve the `.pmtiles` URL extension,
and return permissive CORS headers. The R2 CORS policy to apply is committed at
`infra/cloudflare/r2-cors.json`. Build an archive from a FileGDB snapshot:

```bash
brew install tippecanoe pmtiles
scripts/build-pmtiles.sh /path/to/Lot_EPSG7844.gdb 20260801
```

This produces `build/pmtiles/nsw-cadastre-20260801.pmtiles`. Upload it with the
same versioned filename, cache it indefinitely, and change the URL only for a
new snapshot. The Railway API remains available for lot lookup and ArcGIS
compatibility, and is the fallback when the variable is unset.

If `VITE_MAPBOX_ACCESS_TOKEN` is missing, the app renders an in-page
configuration error instead of a blank map.

## Map defaults

- **Basemap:** Mapbox Light v11 style
- **Center:** Sydney CBD `[151.2093, -33.8688]`
- **Zoom:** 14 (practical parcel zoom)
- **Vector source-layer:** `lots`
- **Parcel rendering:** semi-transparent orange fill + dark outline,
  rendered above the Mapbox basemap.

## UI

| Element        | What it does                                                 |
| -------------- | ------------------------------------------------------------ |
| Status bar     | Shows loading / idle / error state                           |
| Parcels toggle | Shows/hides lot vector layers                                |
| Hover          | Highlights the hovered lot                                   |
| Click popup    | Shows `id` and `lot_number` of the clicked lot               |
| Error panel    | Displays tile fetch or API errors (top-right)                |
| Config error   | Full-page overlay when `VITE_MAPBOX_ACCESS_TOKEN` is missing |

## Scripts

| Script    | Command                                              |
| --------- | ---------------------------------------------------- |
| `dev`     | `bun run dev` — start Vite dev server                |
| `build`   | `bun run build` — production build → `dist/`         |
| `preview` | `bun run preview` — preview production build locally |

The production build outputs to `frontend/dist/`.
