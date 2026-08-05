type ArcgisQuery = {
  readonly where: string;
  readonly outFields?: string;
  readonly returnGeometry: string;
  readonly f: string;
  readonly outSR: string;
};

export type ParsedArcgisQuery =
  | { readonly _tag: "Valid"; readonly id: string; readonly returnGeometry: boolean }
  | { readonly _tag: "Invalid" };

/** Deliberately narrow ArcGIS compatibility surface; never pass a where clause to SQL. */
export const parseArcgisQuery = (query: ArcgisQuery): ParsedArcgisQuery => {
  const match = /^CADID=([A-Za-z0-9_-]+)$/.exec(query.where);
  if (
    match === null ||
    (query.outFields !== undefined && query.outFields !== "*") ||
    query.f !== "geojson" ||
    query.outSR !== "4326" ||
    (query.returnGeometry !== "true" && query.returnGeometry !== "false")
  )
    return { _tag: "Invalid" };
  return { _tag: "Valid", id: match[1], returnGeometry: query.returnGeometry === "true" };
};
