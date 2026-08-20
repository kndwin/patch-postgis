const trustedHost = "portal.spatial.nsw.gov.au";

/** Returns the trusted NSW export URL in an email, if one is present. */
export function extractTrustedCadastreDownloadUrl(parsedEmail: unknown): string | null {
  if (typeof parsedEmail !== "object" || parsedEmail === null) return null;
  const email = parsedEmail as { readonly text?: unknown; readonly html?: unknown };
  const sources = [email.html, email.text].filter(
    (value): value is string => typeof value === "string",
  );
  for (const source of sources) {
    // PostalMime leaves HTML entities encoded in html bodies.
    const decoded = source.replaceAll(/&amp;/gi, "&");
    for (const match of decoded.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      const candidate = match[0].replace(/[),.;]+$/, "");
      if (isTrustedCadastreDownloadUrl(candidate)) return new URL(candidate).toString();
    }
  }
  return null;
}

export function isTrustedCadastreDownloadUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === trustedHost &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/exports/") &&
      url.pathname.toLowerCase().endsWith(".zip")
    );
  } catch {
    return false;
  }
}
