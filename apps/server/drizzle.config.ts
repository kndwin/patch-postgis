export default {
  dialect: "postgresql",
  schema: "./src/platform/database/schema.ts",
  out: "./src/platform/database/migration",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/patch_postgis",
  },
};
