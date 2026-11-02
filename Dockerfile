# syntax=docker/dockerfile:1.7
# Mizan API image (ADR-0003: one image, two entry points).
#   API:     docker run IMAGE                              (apps/api/dist/main.js)
#   Worker:  docker run IMAGE apps/api/dist/worker.js
#   Migrate: docker run IMAGE packages/db/dist/cli.js migrate
# The runtime is distroless: node is the entrypoint; no shell, no npm, uid 65532.
# Behind a TLS-intercepting proxy, pass its CA: --secret id=ca,src=/path/ca.crt

ARG NODE_IMAGE=node:22.22.0-bookworm-slim
# Keep the Node version in step with NODE_IMAGE.
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot

FROM ${NODE_IMAGE} AS base
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
WORKDIR /app

# Build everything from the full workspace (dev dependencies included).
FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export npm_config_cafile=/run/secrets/ca; fi; \
    npm ci && npm run build:api
# Every workspace manifest, so the next stage can install with the same lockfile.
RUN mkdir /manifests && cp package.json package-lock.json /manifests/ \
 && find packages apps perf -name package.json -not -path "*/node_modules/*" -exec cp --parents {} /manifests \;

# Production dependencies of the API and the workspace packages it uses, nothing else.
FROM base AS prod-deps
COPY --from=build /manifests ./
RUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export npm_config_cafile=/run/secrets/ca; fi; \
    npm ci --omit=dev --ignore-scripts -w @mizan/api

FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production LOG_FORMAT=json PORT=8080
WORKDIR /app
COPY --from=prod-deps /app ./
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# Files stay root-owned, so the process (nonroot) cannot change its own code.
USER 65532:65532
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["apps/api/dist/main.js"]
