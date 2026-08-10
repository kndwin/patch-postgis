import { defineRailway, github, image, preserve, project, service, volume } from "railway/iac";

export default defineRailway((ctx) => {
  const singaporeRegion = "asia-southeast1-eqsg3a";

  // This is deliberately an image-backed service rather than Railway's managed
  // postgres helper: the application needs the PostGIS extension from this image.
  const postgisData = volume("postgis-data", {
    // Volumes are regional. Keep the database service in the same Railway region.
    region: singaporeRegion,
    sizeMB: 40_960,
  });

  const cadastreWork = volume("cadastre-work", {
    region: singaporeRegion,
    sizeMB: 51_200,
  });

  const postgis = service("postgis", {
    source: image("postgis/postgis:16-3.4"),
    replicas: { [singaporeRegion]: 1 },
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
    source: github("kndwin/patch-postgis"),
    replicas: { [singaporeRegion]: 1 },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/server/Dockerfile",
    },
    start: "bun src/main.ts",
    preDeploy: "bun src/platform/database/migrate.ts",
    healthcheck: "/health",
    volumeMounts: {
      "/data/cadastre": cadastreWork,
    },
    env: {
      DATABASE_URL: postgis.env.DATABASE_URL,
      CADASTRE_EMAIL_INGESTION_TOKEN: preserve(),
      CADASTRE_EXPORT_EMAIL: "cadastre-export@decoco.work",
      CADASTRE_ARTIFACT_URL: ctx.shared.CADASTRE_ARTIFACT_URL,
      CADASTRE_ARTIFACT_TOKEN: ctx.shared.CADASTRE_ARTIFACT_TOKEN,
      CADASTRE_WORK_DIR: "/data/cadastre",
      CADASTRE_TILE_URL: ctx.shared.CADASTRE_TILE_URL,
      CADASTRE_TILE_PUBLISH_TOKEN: ctx.shared.CADASTRE_TILE_PUBLISH_TOKEN,
      CADASTRE_WORKFLOW_TRIGGER_TOKEN: preserve(),
      // Keep the app listener aligned with the Railway domain target port.
      PORT: "3000",
    },
  });

  return project("patch-postgis", {
    resources: [postgis, app, postgisData, cadastreWork],
  });
});
