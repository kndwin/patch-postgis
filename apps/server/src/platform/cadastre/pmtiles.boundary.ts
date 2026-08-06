export const PMTILES_MAGIC = "pmtiles";

export const isPublishObjectKey = (value: unknown): value is string =>
  typeof value === "string" && /^runs\/[0-9a-f]{64}\/tiles\/lots\.pmtiles$/.test(value);

export const normalizeEtag = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const result = value.trim().replace(/^"|"$/g, "");
  return result.length > 0 ? result : null;
};
export const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const normalizeTileBaseUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
};
export const isValidTileBaseUrl = (value: string): boolean => normalizeTileBaseUrl(value) !== null;

export const validPmtilesHeader = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 127 &&
  new TextDecoder().decode(bytes.slice(0, 7)) === PMTILES_MAGIC &&
  bytes[7] === 3;

export const validPmtilesMetadata = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const metadata = value as Record<string, unknown>;
  const min = metadata.minzoom;
  const max = metadata.maxzoom;
  const format = metadata.format;
  const vectorLayers = metadata.vector_layers;
  if (min !== "14" || max !== "18" || format !== "pbf" || !Array.isArray(vectorLayers))
    return false;
  const lots = vectorLayers.find(
    (item) =>
      typeof item === "object" && item !== null && (item as Record<string, unknown>).id === "lots",
  );
  if (lots === undefined || typeof lots !== "object" || lots === null) return false;
  const fields = (lots as Record<string, unknown>).fields;
  return typeof fields === "object" && fields !== null && "id" in fields && "lot_number" in fields;
};

export const validPmtilesHeaderJson = (value: string): boolean => {
  try {
    const header = JSON.parse(value) as Record<string, unknown>;
    return header.tile_type === "mvt" && header.minzoom === 14 && header.maxzoom === 18;
  } catch {
    return false;
  }
};
export const validPmtilesMetadataJson = (value: string): boolean => {
  try {
    return validPmtilesMetadata(JSON.parse(value));
  } catch {
    return false;
  }
};

export const encodedPublicTileUrl = (base: string, objectKey: string): string =>
  `${base.replace(/\/$/, "")}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
