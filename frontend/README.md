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

The Vite dev server proxies `/tiles` → `http://localhost:3000`, so the
browser requests tiles same-origin at `/tiles/{z}/{x}/{y}.mvt`.

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
