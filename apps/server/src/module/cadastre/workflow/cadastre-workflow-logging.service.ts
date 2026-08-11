import { Cause } from "effect";

const safeErrorLabel = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return typeof value;
  const candidate = "_tag" in value ? value._tag : value instanceof Error ? value.name : undefined;
  return typeof candidate === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(candidate)
    ? candidate
    : "object";
};

/** Summarizes dispatch failures without serializing workflow payloads or error values. */
export const safeWorkflowExecuteCause = (cause: Cause.Cause<unknown>) => ({
  "cause.reason_count": cause.reasons.length,
  "cause.reason_tags": [...new Set(cause.reasons.map((reason) => reason._tag))].join(","),
  "cause.error_labels": [
    ...new Set(
      cause.reasons.flatMap((reason) =>
        Cause.isFailReason(reason)
          ? [safeErrorLabel(reason.error)]
          : Cause.isDieReason(reason)
            ? [safeErrorLabel(reason.defect)]
            : [],
      ),
    ),
  ].join(","),
});
