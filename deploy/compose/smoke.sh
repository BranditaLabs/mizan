#!/usr/bin/env bash
# Smoke test for the production image, run against `docker compose up` (H-10).
# Usage: deploy/compose/smoke.sh [project]   (expects the stack from docker-compose.yml)
set -euo pipefail
P=${1:-mizan}
API=${API_URL:-http://localhost:8080}
WORKER=${WORKER_URL:-http://localhost:8081}
TOKEN=${METRICS_TOKEN:-local-metrics-token-change-me}
dc() { docker compose -p "$P" "$@"; }
fail() { echo "FAIL: $*" >&2; dc logs --tail 50 >&2 || true; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

for _ in $(seq 1 60); do [ "$(code "$API/health/ready")" = 200 ] && break; sleep 2; done
[ "$(code "$API/health/ready")" = 200 ] || fail "API not ready"
for _ in $(seq 1 30); do [ "$(code "$WORKER/health")" = 200 ] && break; sleep 1; done
[ "$(dc ps -a migrate --format '{{.ExitCode}}')" = 0 ] || fail "migrations did not exit 0"
[ "$(docker inspect -f '{{.Config.User}}' "$(dc ps -q api)")" = "65532:65532" ] || fail "API does not run as nonroot"

[ "$(code "$API/v1/openapi.json")" = 200 ] || fail "openapi"
[ "$(code "$API/v1/me")" = 401 ] || fail "/v1/me should need a token"
[ "$(code "$API/metrics")" = 401 ] || fail "/metrics should need the metrics token"
curl -sf -H "Authorization: Bearer $TOKEN" "$API/metrics" | grep '^mizan_db_pool_connections{state="waiting"} 0$' >/dev/null || fail "API metrics"
curl -sf "$WORKER/health" | grep '"role":"worker"' >/dev/null || fail "worker health"
curl -sf -H "Authorization: Bearer $TOKEN" "$WORKER/metrics" | grep '^mizan_outbox_jobs{status="dead"} 0$' >/dev/null || fail "worker metrics"
dc logs api | grep '"message":"Nest application successfully started"' >/dev/null || fail "API logs are not JSON"

# Graceful stop: SIGTERM, clean exit 0, last log line flushed.
dc stop -t 30 api worker >/dev/null
for s in api worker; do
  [ "$(dc ps -a "$s" --format '{{.ExitCode}}')" = 0 ] || fail "$s did not exit 0 on SIGTERM"
  dc logs "$s" | grep 'SIGTERM received, shutting down' >/dev/null || fail "$s did not log its shutdown"
done
echo "smoke: ok"
