# Cadastre email development resources

The development Cloudflare stack receives
`cadastre-export-staging@decoco.work` and archives messages in
`patch-postgis-cadastre-email-staging`. Resource definitions live in
`infra/dev/cloudflare.ts`; Worker logic lives in
`apps/server/src/platform/cloudflare/email/email.worker-handler.ts`.

## Cloudflare resources

```sh
pnpm infra:dev:plan
pnpm infra:dev:apply
```

Alchemy v2 commands run through Bun because the v2 CLI loads TypeScript
directly:

```sh
bun alchemy plan infra/dev/cloudflare.ts --stage dev
bun alchemy deploy infra/dev/cloudflare.ts --stage dev
```

Cloudflare credentials are read by Alchemy from the local environment/profile.
The callback URL and token are deployment environment variables; never commit
the token.

## Local development

Start Postgres with the development resources:

```sh
docker compose -f infra/dev/docker-compose.yml up -d
```

Run the Worker with Wrangler local observability:

```sh
X_LOCAL_OBSERVABILITY=true \
  npx wrangler@4.118.0 dev \
  --config infra/dev/cloudflare.email.wrangler.jsonc \
  --local --port 8787
```

Deliver the fixture email:

```sh
curl -X POST \
  'http://localhost:8787/cdn-cgi/handler/email?from=fixture@example.test&to=cadastre-export-staging@decoco.work' \
  --data-binary @apps/server/src/platform/cloudflare/email/sample.eml
```

Open the local trace UI at
`http://localhost:8787/cdn-cgi/explorer`. The Worker uses `effect-cf` for its
Effect runtime, typed R2 binding, and Worker entrypoint.

## Production resources

Production Cloudflare resources are defined in `infra/prod/cloudflare.ts` and
Railway resources in `infra/prod/railway.ts`.
