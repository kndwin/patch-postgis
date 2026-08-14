import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { AtomHttpApi } from "effect/unstable/reactivity";
import { AppApi } from "@patch/http-contract";

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "https://api.localhost";

export const httpClient = HttpApiClient.make(AppApi, { baseUrl }).pipe(
  Effect.provide(FetchHttpClient.layer),
);

const atomHttpClientLayer = FetchHttpClient.layer;

export class AppHttpClient extends AtomHttpApi.Service<AppHttpClient>()("AppHttpClient", {
  api: AppApi,
  httpClient: atomHttpClientLayer,
  baseUrl,
}) {}
