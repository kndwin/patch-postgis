export const publishActionForRequest = (request: Request): string | null =>
  new URL(request.url).searchParams.get("action");

export const routePublishRequest = (
  request: Request,
): "create" | "part" | "complete" | "abort" | null => {
  const action = publishActionForRequest(request);
  if (request.method === "POST" && (action === "create" || action === "complete")) return action;
  if (request.method === "PUT" && action === "part") {
    const part = Number(
      new URL(request.url).searchParams.get("partNumber") ?? request.headers.get("x-part-number"),
    );
    return Number.isInteger(part) && part >= 1 && part <= 10000 ? "part" : null;
  }
  if (request.method === "DELETE" && action === "abort") return "abort";
  return null;
};
