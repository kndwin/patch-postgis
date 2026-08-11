import { Effect } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { AtomHttpApi } from "effect/unstable/reactivity";
import { Layer } from "effect";
import { AppApi } from "@patch/http-contract";

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "https://api.localhost";

export const httpClient = HttpApiClient.make(AppApi, { baseUrl }).pipe(
  Effect.provide(FetchHttpClient.layer),
  // The API's CORS preflight does not allow the traceparent header.
  Effect.provideService(HttpClient.TracerPropagationEnabled, false),
);

const atomHttpClientLayer = Layer.merge(
  FetchHttpClient.layer,
  Layer.succeed(HttpClient.TracerPropagationEnabled, false),
);

export class AppHttpClient extends AtomHttpApi.Service<AppHttpClient>()("AppHttpClient", {
  api: AppApi,
  httpClient: atomHttpClientLayer,
  baseUrl,
}) {}
