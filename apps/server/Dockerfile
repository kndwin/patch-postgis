FROM oven/bun:1.3.14

RUN apt-get update && apt-get install -y --no-install-recommends gdal-bin && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/http-contract packages/http-contract
RUN bunx --bun pnpm@10.33.4 install --frozen-lockfile --filter @patch/server... --shamefully-hoist

COPY apps/server/drizzle.config.ts apps/server/tsconfig.json ./
COPY apps/server/src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "src/main.ts"]
