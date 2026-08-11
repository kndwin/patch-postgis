import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOgr2OgrArgs,
  databaseToolEnvironment,
  parseDatabaseUrl,
  resolveSourcePath,
  stagingIdentifiers,
} from "./cadastre-sync.service";
import { fileGdbRoot } from "../workflow/activity/import-postgis.activity";

describe("stagingIdentifiers", () => {
  test("are deterministic, distinct, valid, and fit PostgreSQL's identifier limit", () => {
    const a = stagingIdentifiers("a".repeat(64));
    const b = stagingIdentifiers("b".repeat(64));
    expect(a).toEqual(stagingIdentifiers("a".repeat(64)));
    expect(a.table).not.toBe(b.table);
    expect(a.index).not.toBe(b.index);
    for (const identifier of [a.table, a.index, b.table, b.index]) {
      expect(identifier.length).toBeLessThanOrEqual(63);
      expect(identifier).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });
});

describe("fileGdbRoot", () => {
  test("accepts the FileGDB archive layout", () => {
    expect(
      fileGdbRoot(["Lot_EPSG7844.gdb/a00000001.gdbtable", "Lot_EPSG7844.gdb/a00000001.gdbtablx"]),
    ).toBe("Lot_EPSG7844.gdb");
  });
  test("rejects unsafe, duplicate, empty, and non-GDB archives", () => {
    expect(() => fileGdbRoot([])).toThrow();
    expect(() => fileGdbRoot(["data.csv"])).toThrow();
    expect(() => fileGdbRoot(["a.gdb/x", "a.gdb/x"])).toThrow();
    expect(() => fileGdbRoot(["../a.gdb/x"])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseDatabaseUrl
// ---------------------------------------------------------------------------

describe("parseDatabaseUrl", () => {
  test("extracts host, port, dbname, user, password from a standard URL", () => {
    const { safePgConnString, password, redacted } = parseDatabaseUrl(
      "postgres://alice:secret@db.example.com:5433/mydb",
    );
    expect(safePgConnString).toContain("host=db.example.com");
    expect(safePgConnString).toContain("port=5433");
    expect(safePgConnString).toContain("dbname=mydb");
    expect(safePgConnString).toContain("user=alice");
    expect(safePgConnString).not.toContain("secret");
    expect(password).toBe("secret");
    // redacted must never leak the password
    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("password=***");
    expect(redacted).toContain("host=db.example.com");
  });

  test("handles default port 5432 when none specified", () => {
    const { safePgConnString } = parseDatabaseUrl("postgres://u:p@localhost/mydb");
    expect(safePgConnString).toContain("port=5432");
  });

  test("handles empty password", () => {
    const { safePgConnString, redacted } = parseDatabaseUrl("postgres://u:@localhost/mydb");
    // password= is omitted when empty
    expect(safePgConnString).not.toContain("password=");
    expect(redacted).not.toContain("password=");
  });

  test("URL-decodes percent-encoded user and password", () => {
    const { safePgConnString, password } = parseDatabaseUrl(
      "postgres://us%40r:p%3Ass@localhost/db",
    );
    expect(safePgConnString).toContain("user=us@r");
    expect(safePgConnString).not.toContain("p:ss");
    expect(password).toBe("p:ss");
  });

  test("rejects a non-postgres URL", () => {
    // Parses as a URL but has wrong protocol or empty hostname.
    expect(() => parseDatabaseUrl("http:///path")).toThrow("Invalid DATABASE_URL");
    expect(() => parseDatabaseUrl("not-a-url:::")).toThrow("Invalid DATABASE_URL");
  });

  test("handles postgresql:// scheme", () => {
    const { safePgConnString } = parseDatabaseUrl("postgresql://u:p@localhost/db");
    expect(safePgConnString).toContain("host=localhost");
    expect(safePgConnString).toContain("dbname=db");
  });

  test("single-quotes password containing spaces so ogr2ogr PG: parser handles it", () => {
    const { safePgConnString, redacted } = parseDatabaseUrl(
      "postgres://alice:p%20a%20s%20s@localhost/db",
    );
    // The safe connection string must never contain the password.
    expect(safePgConnString).not.toContain("p a s s");
    // Redacted version must not leak the password, quoted or unquoted.
    expect(redacted).not.toContain("p a s s");
    expect(redacted).not.toContain("p%20a");
    expect(redacted).toContain("password=***");
  });

  test("escapes single-quotes inside password values", () => {
    const { safePgConnString } = parseDatabaseUrl("postgres://u:p%27word@localhost/db");
    // p'word → inside a quoted PG value must become p\\'word
    expect(safePgConnString).not.toContain("p\\'word");
  });

  test("keeps backslash passwords out of the safe connection string", () => {
    const { safePgConnString, password, redacted } = parseDatabaseUrl(
      "postgres://u:p%5Cword@localhost/db",
    );
    expect(password).toBe("p\\word");
    expect(safePgConnString).not.toContain("p\\word");
    expect(redacted).not.toContain("p\\word");
  });

  test("single-quotes username containing spaces", () => {
    const { safePgConnString } = parseDatabaseUrl("postgres://my%20user:p@localhost/db");
    expect(safePgConnString).toContain("user='my user'");
  });

  test("single-quotes dbname containing spaces", () => {
    const { safePgConnString } = parseDatabaseUrl("postgres://u:p@localhost/my%20db");
    expect(safePgConnString).toContain("dbname='my db'");
  });

  test("redacted version never contains the raw password even when quoted", () => {
    const { redacted } = parseDatabaseUrl("postgres://u:p%20a%20s%20s@localhost/db");
    expect(redacted).not.toContain("'p a s s'");
    expect(redacted).not.toContain("p a s s");
    expect(redacted).toContain("password=***");
  });
});

describe("databaseToolEnvironment", () => {
  test("passes PGPASSWORD without inheriting DATABASE_URL", () => {
    expect(
      databaseToolEnvironment("secret", {
        PATH: "/usr/bin",
        DATABASE_URL: "postgres://user:secret@db/database",
      }),
    ).toEqual({ PATH: "/usr/bin", PGPASSWORD: "secret" });
  });
});

// ---------------------------------------------------------------------------
// buildOgr2OgrArgs
// ---------------------------------------------------------------------------

describe("buildOgr2OgrArgs", () => {
  test("enables PostgreSQL COPY with the exact contiguous GDAL config arguments", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/x.gdb",
      "host=h port=5432 dbname=d user=u",
      "cadastre_lots_staging_test",
    );

    const configIndex = args.indexOf("--config");
    expect(args.slice(configIndex, configIndex + 3)).toEqual(["--config", "PG_USE_COPY", "YES"]);
  });

  test("builds an argument array with no shell metacharacters", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/mydata.gdb",
      "host=localhost port=5432 dbname=mydb user=u",
      "cadastre_lots_staging_test",
    );

    // Must be a plain array – no shell-string concatenation.
    expect(Array.isArray(args)).toBe(true);

    // Every argument must be free of shell-significant characters.
    for (const arg of args) {
      expect(arg).not.toContain(";");
      expect(arg).not.toContain("&&");
      expect(arg).not.toContain("|");
      expect(arg).not.toContain("`");
      expect(arg).not.toContain("$(");
    }
  });

  test("includes the PG connection string", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/x.gdb",
      "host=h port=5432 dbname=d user=u",
      "cadastre_lots_staging_test",
    );
    const pgArg = args.find((a) => a.startsWith("PG:"));
    expect(pgArg).toBe("PG:host=h port=5432 dbname=d user=u");
  });

  test("sets staging table name", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/x.gdb",
      "host=h port=5432 dbname=d user=u",
      "cadastre_lots_staging_test",
    );
    const nlnIdx = args.indexOf("-nln");
    expect(nlnIdx).toBeGreaterThan(-1);
    expect(args[nlnIdx + 1]).toBe("cadastre_lots_staging_test");
  });

  test("includes -append flag so ogr2ogr never auto-creates the table", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/x.gdb",
      "host=h port=5432 dbname=d user=u",
      "cadastre_lots_staging_test",
    );
    expect(args).toContain("-append");
  });

  test("sets source CRS to EPSG:7844 (GDA2020)", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/x.gdb",
      "host=h port=5432 dbname=d user=u",
      "cadastre_lots_staging_test",
    );
    const srsIdx = args.indexOf("-s_srs");
    expect(srsIdx).toBeGreaterThan(-1);
    expect(args[srsIdx + 1]).toBe("EPSG:7844");
  });

  test("sets target CRS to EPSG:4326", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/x.gdb",
      "host=h port=5432 dbname=d user=u",
      "cadastre_lots_staging_test",
    );
    const tIdx = args.indexOf("-t_srs");
    expect(tIdx).toBeGreaterThan(-1);
    expect(args[tIdx + 1]).toBe("EPSG:4326");
  });

  test("promotes geometries to multi-type and sets geometry column name", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/x.gdb",
      "host=h port=5432 dbname=d user=u",
      "cadastre_lots_staging_test",
    );
    expect(args).toContain("-nlt");
    expect(args).toContain("PROMOTE_TO_MULTI");
    expect(args).toContain("-lco");
    expect(args).toContain("GEOMETRY_NAME=geometry");
  });

  test("selects cadid→id, lotidstring→lot_number, and SHAPE→geometry from Lot layer", () => {
    const args = buildOgr2OgrArgs(
      "/tmp/x.gdb",
      "host=h port=5432 dbname=d user=u",
      "cadastre_lots_staging_test",
    );
    const sqlIdx = args.indexOf("-sql");
    expect(sqlIdx).toBeGreaterThan(-1);
    expect(args[sqlIdx + 1]).toBe(
      "SELECT cadid AS id, lotidstring AS lot_number, SHAPE AS geometry FROM Lot",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveSourcePath
// ---------------------------------------------------------------------------

describe("resolveSourcePath", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sync-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CADASTRE_FILEGDB_PATH;
  });

  test("returns explicit path when it points to an existing directory", () => {
    const dir = join(tmpDir, "my.gdb");
    mkdirSync(dir);
    expect(resolveSourcePath(dir)).toBe(dir);
  });

  test("throws when explicit path does not exist", () => {
    expect(() => resolveSourcePath("/does/not/exist.gdb")).toThrow();
  });

  test("throws when explicit path is a file, not a directory", () => {
    const file = join(tmpDir, "notadir.txt");
    writeFileSync(file, "hello");
    expect(() => resolveSourcePath(file)).toThrow("is not a directory");
  });

  test("falls back to CADASTRE_FILEGDB_PATH env var", () => {
    const dir = join(tmpDir, "env.gdb");
    mkdirSync(dir);
    process.env.CADASTRE_FILEGDB_PATH = dir;
    // No explicit path → uses env var
    expect(resolveSourcePath()).toBe(dir);
  });

  test("throws when CADASTRE_FILEGDB_PATH points to a file", () => {
    const file = join(tmpDir, "envfile.txt");
    writeFileSync(file, "hello");
    process.env.CADASTRE_FILEGDB_PATH = file;
    expect(() => resolveSourcePath()).toThrow("is not a directory");
  });

  test("throws when CADASTRE_FILEGDB_PATH is set but empty, and no downloads fallback", () => {
    process.env.CADASTRE_FILEGDB_PATH = "";
    // Point HOME at an empty directory so the downloads fallback finds nothing.
    const emptyHome = mkdtempSync(join(tmpdir(), "emptyhome-"));
    const oldHome = process.env.HOME;
    process.env.HOME = emptyHome;
    try {
      expect(() => resolveSourcePath()).toThrow(/No \*\.gdb directory found|Cannot read/);
    } finally {
      process.env.HOME = oldHome;
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  test("picks the newest *.gdb from the downloads fallback", () => {
    // Create a fake ~/Downloads with two .gdb dirs of different ages.
    const dl = join(tmpDir, "Downloads");
    mkdirSync(dl);
    const older = join(dl, "old.gdb");
    const newer = join(dl, "new.gdb");
    mkdirSync(older);
    mkdirSync(newer);

    // Touch older so its mtime is earlier.
    const olderStat = statSync(older);
    const newerStat = statSync(newer);
    // On some filesystems the creation order already gives newer a later
    // mtime; if they happen to be equal we explicitly enforce the order
    // by writing a dummy file.
    if (newerStat.mtimeMs <= olderStat.mtimeMs) {
      // Force a tiny delay so mtime differs.
      const waitUntil = Date.now() + 10;
      while (Date.now() < waitUntil) {
        // busy-wait (tests run locally so this is fine)
      }
      writeFileSync(join(newer, ".touch"), "");
    }

    const oldHome = process.env.HOME;
    process.env.HOME = tmpDir;
    try {
      expect(resolveSourcePath()).toBe(newer);
    } finally {
      process.env.HOME = oldHome;
    }
  });

  test("explicit path takes precedence over env var and downloads", () => {
    const explicit = join(tmpDir, "explicit.gdb");
    mkdirSync(explicit);
    const envDir = join(tmpDir, "envdir.gdb");
    mkdirSync(envDir);
    process.env.CADASTRE_FILEGDB_PATH = envDir;

    // Also create a downloads fallback to prove it's ignored.
    const dl = join(tmpDir, "Downloads");
    mkdirSync(dl);
    mkdirSync(join(dl, "downloads.gdb"));

    const oldHome = process.env.HOME;
    process.env.HOME = tmpDir;
    try {
      expect(resolveSourcePath(explicit)).toBe(explicit);
    } finally {
      process.env.HOME = oldHome;
    }
  });
});
