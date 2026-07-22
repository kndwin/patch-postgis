import { defineRailway, image, project, service, volume } from "railway/iac";

export default defineRailway((ctx) => {
  // This is deliberately an image-backed service rather than Railway's managed
  // postgres helper: the application needs the PostGIS extension from this image.
  const postgisData = volume("postgis-data", {
    // Volumes are regional. Keep the database service in the same Railway region.
    region: "us-west2",
    sizeMB: 4096,
  });

  const postgis = service("postgis", {
    source: image("postgis/postgis:16-3.4"),
    regions: { "us-west2": 1 },
    volumeMounts: {
      "/var/lib/postgresql/data": postgisData,
    },
    env: {
      POSTGRES_PASSWORD: ctx.shared.POSTGRES_PASSWORD,
      POSTGRES_DB: "patch_postgis",
      POSTGRES_USER: "postgres",
      PGDATA: "/var/lib/postgresql/data/pgdata",
      DATABASE_URL:
        "postgres://${{postgis.POSTGRES_USER}}:${{postgis.POSTGRES_PASSWORD}}@${{postgis.RAILWAY_PRIVATE_DOMAIN}}:5432/${{postgis.POSTGRES_DB}}",
    },
  });

  const app = service("app", {
    // The repository is intentionally not declared here. The target app service
    // is connected to the repository in Railway; omitting source lets IaC own
    // deployment settings without replacing that connection with a guessed repo.
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    start: "bun src/main.ts",
    preDeploy: "bunx --no-install drizzle-kit migrate",
    healthcheck: "/health",
    env: {
      DATABASE_URL: postgis.env.DATABASE_URL,
    },
  });

  return project("patch-postgis", {
    resources: [postgis, app, postgisData],
  });
});
