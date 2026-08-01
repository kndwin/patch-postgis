FROM oven/bun:1.3.14

RUN apt-get update && apt-get install -y --no-install-recommends gdal-bin && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "src/main.ts"]
