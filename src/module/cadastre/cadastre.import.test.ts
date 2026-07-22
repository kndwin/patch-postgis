import { describe, expect, test } from "bun:test";
import {
  nextSydneyObjectIdIndex,
  sortSydneyObjectIds,
  SYDNEY_ID_BATCH_SIZE,
  SYDNEY_IMPORT_CONCURRENCY,
} from "./cadastre.service";

describe("Sydney initial ID snapshot import", () => {
  test("sorts OBJECTIDs numerically without mutating the snapshot source", () => {
    const ids = [10, 2, 1];
    expect(sortSydneyObjectIds(ids)).toEqual([1, 2, 10]);
    expect(ids).toEqual([10, 2, 1]);
  });

  test("uses 100-ID batches and four-request waves", () => {
    expect(SYDNEY_ID_BATCH_SIZE).toBe(100);
    expect(SYDNEY_IMPORT_CONCURRENCY).toBe(4);
    expect(nextSydneyObjectIdIndex(0, SYDNEY_ID_BATCH_SIZE)).toBe(100);
  });
});
