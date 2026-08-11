FROM debian:bookworm-slim AS tippecanoe-tool

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git build-essential libsqlite3-dev zlib1g-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN git clone --depth 1 --branch 2.79.0 https://github.com/felt/tippecanoe.git && test "$(git -C tippecanoe rev-parse HEAD)" = 68ab8dcc229f95b8b25877697d5e8d66783af503 && make -C tippecanoe -j"$(nproc)" && install -m 0755 tippecanoe/tippecanoe /usr/local/bin/tippecanoe
RUN /usr/local/bin/tippecanoe --version

FROM golang:1.25-bookworm AS pmtiles-tool

WORKDIR /build
RUN git clone --depth 1 --branch v1.30.3 https://github.com/protomaps/go-pmtiles.git && test "$(git -C go-pmtiles rev-parse HEAD)" = b50d7b1acd72c02bf428e78f0f5c9dab020b6174 && cd go-pmtiles && CGO_ENABLED=0 go build -trimpath -o /usr/local/bin/pmtiles . && /usr/local/bin/pmtiles --help >/dev/null

FROM oven/bun:1.3.14

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gdal-bin unzip && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=tippecanoe-tool /usr/local/bin/tippecanoe /usr/local/bin/tippecanoe
COPY --from=pmtiles-tool /usr/local/bin/pmtiles /usr/local/bin/pmtiles
RUN test -r /etc/ssl/certs/ca-certificates.crt && tippecanoe --version && pmtiles --help >/dev/null && unzip -v >/dev/null

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/http-contract packages/http-contract
RUN bunx --bun pnpm@10.33.4 install --frozen-lockfile --filter @patch/server... --shamefully-hoist

COPY apps/server/drizzle.config.ts apps/server/tsconfig.json ./
COPY apps/server/src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "src/main.ts"]
