import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  LotErrorSchemas,
  LotParamsSchema,
  LotResponseSchema,
} from "./cadastre.http.schema";

const getLot = HttpApiEndpoint.get("getLot", "/lots/:id", {
  params: LotParamsSchema,
  success: LotResponseSchema,
  error: LotErrorSchemas,
});

export const cadastreGroup = HttpApiGroup.make("cadastre").add(getLot);
