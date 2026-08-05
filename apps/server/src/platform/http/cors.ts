import { HttpRouter } from "effect/unstable/http";

export const CorsLive = HttpRouter.cors({
  allowedOrigins: [],
  allowedMethods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86_400,
  credentials: false,
});
