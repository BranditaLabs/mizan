# syntax=docker/dockerfile:1.7
# Mizan dashboard image (apps/web, docs/09): Next.js standalone server on distroless, uid 65532.
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.staging.example .
# NEXT_PUBLIC_* are baked into the browser bundle at build time; none of them is a secret.
# Behind a TLS-intercepting proxy, pass its CA: --secret id=ca,src=/path/ca.crt

ARG NODE_IMAGE=node:22.22.0-bookworm-slim
# Keep the Node version in step with NODE_IMAGE.
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot

FROM ${NODE_IMAGE} AS build
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
RUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export npm_config_cafile=/run/secrets/ca; fi; \
    test -n "$NEXT_PUBLIC_API_URL" || { echo "NEXT_PUBLIC_API_URL is required" >&2; exit 1; }; \
    npm ci \
 && npm run build -w @mizan/shared -w @mizan/design-system \
 && NEXT_OUTPUT=standalone npm run build -w @mizan/web \
 && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static \
 && if [ -d apps/web/public ]; then cp -r apps/web/public apps/web/.next/standalone/apps/web/public; fi

FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
USER 65532:65532
EXPOSE 8080
CMD ["apps/web/server.js"]
