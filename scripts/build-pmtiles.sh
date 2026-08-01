#!/usr/bin/env bash
# Build a static, immutable NSW cadastre PMTiles archive from a FileGDB snapshot.
#
# Usage:
#   scripts/build-pmtiles.sh /path/to/Lot_EPSG7844.gdb 20260801
#
# The output is build/pmtiles/nsw-cadastre-<version>.pmtiles. It deliberately is
# not tracked by git: publish that exact immutable filename to object storage.
set -euo pipefail

source_gdb=${1:?"Usage: $0 /path/to/Lot_EPSG7844.gdb YYYYMMDD"}
version=${2:?"Usage: $0 /path/to/Lot_EPSG7844.gdb YYYYMMDD"}
output_dir=${PMTILES_OUTPUT_DIR:-build/pmtiles}
output_base="$output_dir/nsw-cadastre-$version"
mbtiles="$output_base.mbtiles"
pmtiles="$output_base.pmtiles"
temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/cadastre-pmtiles.XXXXXX")

cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT

for command in ogr2ogr tippecanoe pmtiles; do
  command -v "$command" >/dev/null || {
    echo "Missing $command. On macOS run: brew install gdal tippecanoe pmtiles" >&2
    exit 1
  }
done

[[ -d "$source_gdb" ]] || {
  echo "FileGDB directory not found: $source_gdb" >&2
  exit 1
}
[[ "$version" =~ ^[0-9]{8}$ ]] || {
  echo "Snapshot version must be YYYYMMDD, got: $version" >&2
  exit 1
}

mkdir -p "$output_dir"
rm -f "$mbtiles" "$pmtiles"

echo "Building $pmtiles from $source_gdb"
# GeoJSONSeq is streamed directly into Tippecanoe so the several-gigabyte
# intermediate GeoJSON file is never written. Keep only the two properties the
# browser needs. The source is GDA2020 (EPSG:7844), and tiles must be WGS84.
#
# We retain every lot (rather than using Tippecanoe's feature/tile-size dropping
# options). The archive begins at the UI's parcel zoom of 14; geometry at z18 is
# overscaled by Mapbox GL for closer views, avoiding a much larger z22 archive.
ogr2ogr \
  -f GeoJSONSeq /vsistdout/ "$source_gdb" \
  -s_srs EPSG:7844 -t_srs EPSG:4326 \
  -sql "SELECT cadid AS id, lotidstring AS lot_number, SHAPE AS geometry FROM Lot" \
  2>"$temp_dir/ogr2ogr.stderr" |
  tippecanoe \
    --output="$mbtiles" \
    --layer=lots \
    --name="NSW Cadastre $version" \
    --description="NSW cadastral lots from FileGDB snapshot $version" \
    --minimum-zoom=14 \
    --maximum-zoom=18 \
    --use-attribute-for-id=id \
    --no-feature-limit \
    --no-tile-size-limit \
    --detect-shared-borders \
    --no-simplification-of-shared-nodes \
    --temporary-directory="$temp_dir" \
    --force \
    -

pmtiles convert "$mbtiles" "$pmtiles"
pmtiles verify "$pmtiles"
pmtiles show "$pmtiles"

echo
echo "Archive ready: $pmtiles"
echo "Upload it unchanged under the same immutable filename, then set:"
echo "VITE_CADASTRE_PMTILES_URL=https://tiles.example.com/$(basename "$pmtiles")"
