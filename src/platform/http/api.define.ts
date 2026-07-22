import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { cadastreGroup } from "../../module/cadastre/cadastre.http.define";

const health = HttpApiEndpoint.get("health", "/health", {
  success: Schema.Struct({ status: Schema.Literal("ok") }),
});

export const AppApi = HttpApi.make("patch-postgis").add(
  HttpApiGroup.make("system").add(health),
  cadastreGroup,
);
