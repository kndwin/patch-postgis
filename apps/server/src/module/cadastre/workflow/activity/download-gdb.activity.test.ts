import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { downloadProviderArtifact, MAX_ARTIFACT_SIZE } from "./download-gdb.activity";

const providerUrl = "https://portal.spatial.nsw.gov.au/exports/export.zip";
const originalFetch = globalThis.fetch;
const directories: string[] = [];
const setFetch = (fetcher: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) => {
  globalThis.fetch = fetcher as typeof fetch;
};

const response = (body: BodyInit | null, status = 200, length?: number) =>
  new Response(body, {
    status,
    headers: length === undefined ? {} : { "content-length": String(length) },
  });

const setupFile = async () => {
  const directory = await mkdtemp(join("/tmp", "download-gdb-test-"));
  directories.push(directory);
  return join(directory, "export.zip");
};

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("provider artifact download", () => {
  test("streams a response with Content-Length", async () => {
    const file = await setupFile();
    setFetch(async () => response("gdb", 200, 3));
    expect(await downloadProviderArtifact(providerUrl, file)).toMatchObject({ size: 3 });
    expect(await readFile(file, "utf8")).toBe("gdb");
  });

  test("retries a truncated declared-length stream", async () => {
    const file = await setupFile();
    let attempts = 0;
    setFetch(async () => {
      attempts += 1;
      return attempts === 1 ? response("short", 200, 10) : response("complete", 200, 8);
    });
    expect(await downloadProviderArtifact(providerUrl, file)).toMatchObject({ size: 8 });
    expect(attempts).toBe(2);
    expect(await readFile(file, "utf8")).toBe("complete");
  });

  test("streams a response without Content-Length", async () => {
    const file = await setupFile();
    setFetch(async () => response("without a length"));
    expect(await downloadProviderArtifact(providerUrl, file)).toMatchObject({ size: 16 });
  });

  test("retries transient HTTP failures and succeeds", async () => {
    const file = await setupFile();
    let attempts = 0;
    setFetch(async () => (++attempts < 2 ? response(null, 503) : response("ok", 200, 2)));
    expect(await downloadProviderArtifact(providerUrl, file)).toMatchObject({ size: 2 });
    expect(attempts).toBe(2);
  });

  test("stops after three permanent transient HTTP failures", async () => {
    const file = await setupFile();
    let attempts = 0;
    setFetch(async () => {
      attempts += 1;
      return response(null, 503);
    });
    const error = await downloadProviderArtifact(providerUrl, file).catch((value) => value);
    expect(error).toMatchObject({
      category: "http",
      status: 503,
    });
    expect(attempts).toBe(3);
  });

  test("does not retry a declared oversized payload", async () => {
    const file = await setupFile();
    let attempts = 0;
    setFetch(async () => {
      attempts += 1;
      return response(null, 200, MAX_ARTIFACT_SIZE + 1);
    });
    const error = await downloadProviderArtifact(providerUrl, file).catch((value) => value);
    expect(error).toMatchObject({
      category: "validation",
    });
    expect(attempts).toBe(1);
  });

  test("rejects streamed overflow without Content-Length", async () => {
    const file = await setupFile();
    setFetch(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          body: (async function* () {
            yield { byteLength: MAX_ARTIFACT_SIZE + 1 };
          })(),
        }) as unknown as Response,
    );
    const error = await downloadProviderArtifact(providerUrl, file).catch((value) => value);
    expect(error).toMatchObject({
      category: "validation",
    });
    expect(await Bun.file(file).exists()).toBe(false);
  });

  test("bounds and redacts redirect/fetch failures", async () => {
    const file = await setupFile();
    let attempts = 0;
    setFetch(async () => {
      attempts += 1;
      throw new Error(`${providerUrl}?token=secret`);
    });
    const error = (await downloadProviderArtifact(providerUrl, file).catch(
      (value) => value,
    )) as Error;
    expect(attempts).toBe(3);
    expect(error.message).toBe("Provider download failed");
    expect(error.message).not.toContain("secret");
  });
});
