export type Position = [number, number];
type InputPosition = readonly number[];

const signedArea = (ring: readonly InputPosition[]): number => {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area +=
      ring[index]![0] * ring[index + 1]![1] -
      ring[index + 1]![0] * ring[index]![1];
  }
  return area / 2;
};

const contains = (
  ring: readonly InputPosition[],
  point: InputPosition,
): boolean => {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [x, y] = ring[index]!;
    const [previousX, previousY] = ring[previous]!;
    if (y > point[1] !== previousY > point[1]) {
      const crossingX =
        ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
      if (point[0] < crossingX) inside = !inside;
    }
  }
  return inside;
};

/** Convert Esri rings (clockwise exteriors, counter-clockwise holes) to GeoJSON. */
export const ringsToMultiPolygonCoordinates = (
  rings: readonly (readonly InputPosition[])[],
): Position[][][] => {
  const exteriors = rings
    .filter((ring) => signedArea(ring) < 0)
    .map((ring) => [ring.map(([x, y]) => [x, y] as Position)] as Position[][]);
  for (const ring of rings) {
    if (signedArea(ring) >= 0 && ring.length > 0) {
      const exterior = exteriors.find((candidate) =>
        contains(candidate[0]!, ring[0]!),
      );
      if (exterior) exterior.push(ring.map(([x, y]) => [x, y] as Position));
    }
  }
  return exteriors;
};
