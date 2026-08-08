import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Layer, Redacted } from "effect";
import * as Effect from "effect/Effect";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/patch_postgis";

export const PgClientLive = PgClient.layer({
  url: Redacted.make(connectionString),
  maxConnections: 10,
  // Bounded wait when all connections are busy (e.g. concurrent Mapbox tile
  // requests).  Without this, queued connection acquisition blocks forever,
  // starving fibers and preventing pg_cancel_backend from reaching the pool.
  connectTimeout: "5 seconds",
});

const dbEffect = PgDrizzle.makeWithDefaults();
export type Database = Effect.Success<typeof dbEffect>;
export class Db extends Context.Service<Db, Database>()("Db") {}
// Keep the client in the layer output as well as using it to construct Drizzle.
// Consumers which need session-scoped PostgreSQL features (for example an
// advisory lock) must be able to reserve a connection from the same pool.
export const DbLive = Layer.effect(Db, dbEffect).pipe(Layer.provideMerge(PgClientLive));
