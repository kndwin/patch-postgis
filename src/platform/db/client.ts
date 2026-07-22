import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Layer, Redacted } from "effect";
import * as Effect from "effect/Effect";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/patch_postgis";

export const PgClientLive = PgClient.layer({
  url: Redacted.make(connectionString),
  maxConnections: 10,
});

const dbEffect = PgDrizzle.makeWithDefaults();
export type Database = Effect.Success<typeof dbEffect>;
export class Db extends Context.Service<Db, Database>()("Db") {}
export const DbLive = Layer.effect(Db, dbEffect).pipe(
  Layer.provide(PgClientLive),
);
