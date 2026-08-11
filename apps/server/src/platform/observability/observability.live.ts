import { BunHttpClient } from "@effect/platform-bun";
import { Layer, Logger } from "effect";
import { OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

const resource = { serviceName: "patch-postgis-server" } as const;

const OtlpLive = Layer.merge(
  OtlpTracer.layerFromConfig({ resource }),
  OtlpMetrics.layerFromConfig({ resource }),
).pipe(Layer.provide(OtlpSerialization.layerProtobuf), Layer.provide(BunHttpClient.layer));

/** Process-wide stdout logging and optional native Effect OTLP traces/metrics. */
export const ObservabilityLive = Layer.merge(
  Logger.layer([Logger.consoleJson, Logger.tracerLogger]),
  OtlpLive,
);
