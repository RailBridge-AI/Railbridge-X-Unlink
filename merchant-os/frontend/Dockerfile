FROM node:22-bookworm-slim AS deps
WORKDIR /app/merchant-os/frontend
COPY merchant-os/frontend/package.json merchant-os/frontend/package-lock.json ./
RUN npm ci

FROM deps AS builder
ARG MERCHANT_OS_API_URL=http://localhost:4030
ENV MERCHANT_OS_API_URL=${MERCHANT_OS_API_URL}
COPY merchant-os/frontend ./
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app/merchant-os/frontend
ENV NODE_ENV=production

COPY --from=builder /app/merchant-os/frontend ./

EXPOSE 3000
CMD ["npm", "run", "start", "--", "-p", "3000", "-H", "0.0.0.0"]

