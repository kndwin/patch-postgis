import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

/* ── Configuration ─────────────────────────────────────────────────── */
const ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
// An immutable PMTiles archive on object storage/CDN. Leave unset to retain
// the live Railway MVT endpoint for local development and migration rollback.
const CADASTRE_PMTILES_URL = import.meta.env.VITE_CADASTRE_PMTILES_URL;

if (!ACCESS_TOKEN) {
  document.getElementById("config-error").hidden = false;
  document.getElementById("config-error-body").textContent =
    "Missing VITE_MAPBOX_ACCESS_TOKEN. " +
    "Copy frontend/.env.example → frontend/.env and set your Mapbox access token, " +
    "then restart the dev server.";
  document.getElementById("status-text").textContent =
    "Config error — see panel";
  document.getElementById("status-text").style.color = "#c44";
  throw new Error("Missing VITE_MAPBOX_ACCESS_TOKEN");
}

mapboxgl.accessToken = ACCESS_TOKEN;

/* ── Sydney CBD ────────────────────────────────────────────────────── */
const CENTER = [151.2093, -33.8688];
const ZOOM = 14;

/* ── UI elements ───────────────────────────────────────────────────── */
const statusText = document.getElementById("status-text");
const toggleParcels = document.getElementById("toggle-parcels");
const errorPanel = document.getElementById("error-panel");
const errorBody = document.getElementById("error-body");
const errorClose = document.getElementById("error-close");

function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? "#c44" : "";
}

function showError(text) {
  errorBody.textContent = text;
  errorPanel.hidden = false;
}

errorClose.addEventListener("click", () => {
  errorPanel.hidden = true;
});

/* ── Map ───────────────────────────────────────────────────────────── */
const map = new mapboxgl.Map({
  container: "map",
  center: CENTER,
  zoom: ZOOM,
  style: "mapbox://styles/mapbox/light-v11",
  attributionControl: true,
});

/* ── Vector parcel source (added once style is loaded) ─────────────── */
map.on("style.load", () => {
  const parcelSource = {
    type: "vector",
    minzoom: 12,
    maxzoom: 22,
    // The tile payload exposes the lot id as a property rather than MVT's
    // optional numeric feature id. Promote it so feature-state can target lots.
    promoteId: "id",
  };

  if (CADASTRE_PMTILES_URL) {
    // Mapbox GL JS reads the PMTiles directory and fetches only the byte ranges
    // for visible tiles. The archive must be served with HTTP Range support.
    parcelSource.url = CADASTRE_PMTILES_URL;
  } else {
    parcelSource.tiles = [`${location.origin}/tiles/{z}/{x}/{y}.mvt`];
  }

  map.addSource("parcels", parcelSource);

  /* ── Parcel fill ───────────────────────────────────────────────── */
  map.addLayer({
    id: "parcels-fill",
    type: "fill",
    source: "parcels",
    "source-layer": "lots",
    paint: {
      "fill-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        "#172554",
        ["boolean", ["feature-state", "hover"], false],
        "#1e40af",
        "#1d4ed8",
      ],
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.65,
        ["boolean", ["feature-state", "hover"], false],
        0.5,
        0.35,
      ],
      "fill-outline-color": "#2563eb",
    },
  });

  /* ── Parcel outline ────────────────────────────────────────────── */
  map.addLayer({
    id: "parcels-line",
    type: "line",
    source: "parcels",
    "source-layer": "lots",
    paint: {
      "line-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        "#172554",
        ["boolean", ["feature-state", "hover"], false],
        "#1e3a8a",
        "#1e40af",
      ],
      "line-width": 1.5,
    },
  });

  /* ── Hover state tracking ──────────────────────────────────────── */
  let hoveredId = null;
  let selectedId = null;

  map.on("mousemove", "parcels-fill", (e) => {
    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      if (feature.id !== hoveredId) {
        if (hoveredId !== null) {
          map.setFeatureState(
            { source: "parcels", sourceLayer: "lots", id: hoveredId },
            { hover: false },
          );
        }
        hoveredId = feature.id;
        map.setFeatureState(
          { source: "parcels", sourceLayer: "lots", id: hoveredId },
          { hover: true },
        );
        map.getCanvas().style.cursor = "pointer";
      }
    } else {
      if (hoveredId !== null) {
        map.setFeatureState(
          { source: "parcels", sourceLayer: "lots", id: hoveredId },
          { hover: false },
        );
      }
      hoveredId = null;
      map.getCanvas().style.cursor = "";
    }
  });

  map.on("mouseleave", "parcels-fill", () => {
    if (hoveredId !== null) {
      map.setFeatureState(
        { source: "parcels", sourceLayer: "lots", id: hoveredId },
        { hover: false },
      );
    }
    hoveredId = null;
    map.getCanvas().style.cursor = "";
  });

  /* ── Click → popup ─────────────────────────────────────────────── */
  map.on("click", "parcels-fill", (e) => {
    if (!e.features || e.features.length === 0) return;
    const feature = e.features[0];
    const props = feature.properties;

    if (feature.id !== selectedId) {
      if (selectedId !== null) {
        map.setFeatureState(
          { source: "parcels", sourceLayer: "lots", id: selectedId },
          { selected: false },
        );
      }
      selectedId = feature.id;
      map.setFeatureState(
        { source: "parcels", sourceLayer: "lots", id: selectedId },
        { selected: true },
      );
    }

    const id = props.id ?? "—";
    const lotNumber = props.lot_number ?? "—";

    new mapboxgl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(
        `<strong>Lot</strong><br>` +
          `ID: <code>${id}</code><br>` +
          `Lot&nbsp;#: <code>${lotNumber}</code>`,
      )
      .addTo(map);
  });

  /* ── Map loaded ────────────────────────────────────────────────── */
  setStatus("Map loaded ✓");

  /* ── Toggle parcel visibility ──────────────────────────────────── */
  toggleParcels.addEventListener("change", () => {
    const visible = toggleParcels.checked ? "visible" : "none";
    map.setLayoutProperty("parcels-fill", "visibility", visible);
    map.setLayoutProperty("parcels-line", "visibility", visible);
  });
});

/* ── Tile / API error capture ──────────────────────────────────────── */
map.on("error", (e) => {
  const msg = e?.error?.message ?? e?.error ?? "Unknown map error";
  setStatus("Map error", true);
  showError(`Map error: ${msg}`);
});

map.on("sourcedata", (e) => {
  if (e.sourceId !== "parcels" || !e.isSourceLoaded) return;
  const src = map.getSource("parcels");
  if (!src) return;

  const original = src.loadTile.bind(src);
  src.loadTile = function (tile, ...rest) {
    const check = () => {
      if (
        tile.state === "errored" ||
        (tile.request && tile.request.status >= 400)
      ) {
        const msg =
          tile.request?.statusText ??
          `Tile ${tile.tileID.canonical?.z ?? "?"}/${tile.tileID.canonical?.x ?? "?"}/${tile.tileID.canonical?.y ?? "?"} failed`;
        showError(`Tile error: ${msg}`);
      }
    };

    const result = original.call(this, tile, ...rest);
    // Schedule a microtask to let tile state settle.
    queueMicrotask(check);
    return result;
  };
});

map.once("idle", () => {
  if (statusText.textContent === "Loading…") {
    setStatus("Map idle ✓");
  }
});
