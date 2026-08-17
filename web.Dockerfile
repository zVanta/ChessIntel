# Checkmate Coach — Next.js web app
FROM node:20-bookworm-slim

WORKDIR /app

# Build tools only needed if better-sqlite3 can't fetch a prebuilt binary
# for this Node version. Kept for reliability; can be removed once verified.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_SITE_NAME=Checkmate Coach
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
