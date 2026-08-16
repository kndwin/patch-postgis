import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { CorsOptions } from "./cors";

describe("API CORS preflight", () => {
  test("allows the browser trace context preflight", async () => {
    const request = {
      method: "OPTIONS",
      headers: {
        origin: "https://patch-postgis.kndwin.workers.dev",
        "access-control-request-method": "GET",
        "access-control-request-headers": "b3,traceparent",
      },
    } as unknown as HttpServerRequest.HttpServerRequest;

    const response = await Effect.runPromise(
      HttpMiddleware.cors(CorsOptions)(Effect.succeed(HttpServerResponse.empty())).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
    expect(response.headers["access-control-allow-methods"]).toBe("GET, POST");
    expect(response.headers["access-control-allow-headers"]).toBe(
      "Content-Type,b3,traceparent,tracestate,baggage",
    );
  });
});
