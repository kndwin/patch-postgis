export type Position = [number, number];
export type MultiPolygonCoordinates = readonly (readonly (readonly (readonly [
  number,
  number,
])[])[])[];
export type MultiPolygonGeometry = {
  readonly type: "MultiPolygon";
  readonly coordinates: MultiPolygonCoordinates;
};
