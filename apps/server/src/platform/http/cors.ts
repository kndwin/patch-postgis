import { HttpRouter } from "effect/unstable/http";

export const CorsOptions = {
  allowedOrigins: [],
  allowedMethods: ["GET", "POST"],
  // Effect's HTTP client propagates W3C trace context on browser requests.
  // These headers must be allowed during the browser's preflight.
  allowedHeaders: ["Content-Type", "traceparent", "tracestate", "baggage"],
  maxAge: 86_400,
  credentials: false,
} as const;

export const CorsLive = HttpRouter.cors(CorsOptions);
