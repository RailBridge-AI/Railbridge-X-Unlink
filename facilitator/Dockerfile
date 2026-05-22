FROM node:22-bookworm-slim AS deps
WORKDIR /app/facilitator
COPY facilitator/package.json facilitator/package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app/facilitator
COPY facilitator ./
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/facilitator

COPY --from=builder /app/facilitator ./

ENV NODE_ENV=production
EXPOSE 4022

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/facilitator-implementation.js"]

