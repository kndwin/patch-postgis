import { describe, expect, test } from "bun:test";
import {
  ringsToMultiPolygonCoordinates,
  type Position,
} from "./cadastre.geometry";

const clockwise = (points: Position[]) => points;
const counterClockwise = (points: Position[]) =>
  [...points].reverse() as Position[];

describe("Esri ring conversion", () => {
  test("converts one exterior to one polygon", () => {
    const exterior = clockwise([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
    expect(ringsToMultiPolygonCoordinates([exterior])).toEqual([[exterior]]);
  });
  test("assigns a hole to its containing exterior", () => {
    const exterior = clockwise([
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 0],
      [0, 0],
    ]);
    const hole = counterClockwise([
      [1, 1],
      [1, 2],
      [2, 2],
      [2, 1],
      [1, 1],
    ]);
    expect(ringsToMultiPolygonCoordinates([exterior, hole])).toEqual([
      [exterior, hole],
    ]);
  });
  test("keeps multiple exteriors as separate polygons", () => {
    const first = clockwise([
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
    const second = clockwise([
      [3, 0],
      [3, 1],
      [4, 1],
      [4, 0],
      [3, 0],
    ]);
    expect(ringsToMultiPolygonCoordinates([first, second])).toEqual([
      [first],
      [second],
    ]);
  });
});
