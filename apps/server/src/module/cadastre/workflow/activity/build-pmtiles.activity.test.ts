import { describe, expect, test } from "bun:test";
import { safePgArgs, tippecanoeArgs } from "./build-pmtiles.activity";

describe("PMTiles build commands", () => {
  test("streams GeoJSONSeq through the real stdin device with production tile options", () => {
    const args = tippecanoeArgs("/work/lots.mbtiles", "/work/tmp");
    expect(args.at(-1)).toBe("/dev/stdin");
    expect(args).toContain("--no-feature-limit");
    expect(args).toContain("--no-tile-size-limit");
    expect(args).toContain("--detect-shared-borders");
    expect(args).toContain("--no-simplification-of-shared-nodes");
    expect(args).toContain("--temporary-directory=/work/tmp");
  });

  test("exports only browser-required fields without putting the password in argv", () => {
    const args = safePgArgs("postgres://user:s%20ecret@db.example/cadastre");
    expect(args.join(" ")).toContain(
      "SELECT id, lot_number, ST_Force2D(geometry) AS geometry FROM cadastre_lots",
    );
    expect(args.join(" ")).not.toContain("s ecret");
    expect(args.join(" ")).not.toContain("password=");
  });
});
