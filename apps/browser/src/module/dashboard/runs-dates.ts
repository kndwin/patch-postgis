/** Parse ISO timestamps and the Effect DateTime wrapper persisted by older runs. */
export function parseRunDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.replace(/^DateTime\.\w+\((.*)\)$/, "$1");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRunDate(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  return parseRunDate(value)?.toLocaleString("en-AU", options) ?? "Time unavailable";
}
