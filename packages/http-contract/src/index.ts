import { HttpApi } from "effect/unstable/httpapi";
import { cadastreGroup } from "./cadastre.http-api";
import { systemGroup } from "./system.http-api";
import { workflowGroup } from "./workflow.http-api";

export * from "./cadastre.http-api";
export * from "./cadastre.schema";
export * from "./cadastre-download-url";
export * from "./system.http-api";
export * from "./workflow.http-api";
export * from "./workflow.schema";

export const AppApi = HttpApi.make("patch-postgis").add(systemGroup, cadastreGroup, workflowGroup);
