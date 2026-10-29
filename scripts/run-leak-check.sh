#!/usr/bin/env bash
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)

LEAK_DATABASE=${LEAK_DATABASE:-docmost_leak}
LEAK_PG_ADMIN_URL=${LEAK_PG_ADMIN_URL:-postgresql://docmost:docmost@127.0.0.1:5433/postgres}
LEAK_REDIS_URL=${LEAK_REDIS_URL:-redis://127.0.0.1:6380/13}
LEAK_WIKI_PORT=${LEAK_WIKI_PORT:-3100}
LEAK_APP_SECRET=${LEAK_APP_SECRET:-leak-test-secret-app-0123456789abcdef}
LEAK_SERVICE_TOKEN=${LEAK_SERVICE_TOKEN:-leak-test-secret-service-0123456789abcdef}
LEAK_BRIDGE_SECRET=${LEAK_BRIDGE_SECRET:-leak-test-secret-bridge-0123456789abcdef}
LEAK_AI_ROLE=docmost_ai_leak
LEAK_AI_PASSWORD=leak-test-secret-ai-role
LEAK_SEED_PASSWORD=${LEAK_SEED_PASSWORD:-seed-demo-password}
LEAK_HEALTH_TIMEOUT=${LEAK_HEALTH_TIMEOUT:-120}

case "$LEAK_DATABASE" in
  docmost_leak*) ;;
  *)
    echo "Refusing to reset database $LEAK_DATABASE: the name must start with docmost_leak" >&2
    exit 1
    ;;
esac
case "$LEAK_DATABASE" in
  *[!A-Za-z0-9_]*)
    echo "Refusing database name $LEAK_DATABASE: only letters, digits and underscores" >&2
    exit 1
    ;;
esac

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to create the leak-check database" >&2
  exit 1
fi

wiki_url="http://127.0.0.1:$LEAK_WIKI_PORT"

port_probe=0
curl -s -o /dev/null --max-time 5 "$wiki_url/" 2>/dev/null || port_probe=$?
if [ "$port_probe" -ne 7 ]; then
  echo "Port $LEAK_WIKI_PORT is already in use: stop the process on it or set LEAK_WIKI_PORT" >&2
  exit 1
fi

server_base=${LEAK_PG_ADMIN_URL%/*}
server_host=${server_base#*@}
admin_credentials=${server_base#*://}
admin_credentials=${admin_credentials%@*}
leak_database_url="$server_base/$LEAK_DATABASE"
leak_ai_database_url="postgresql://$LEAK_AI_ROLE:$LEAK_AI_PASSWORD@$server_host/$LEAK_DATABASE"

work_dir=$(mktemp -d)
server_log="$work_dir/wiki.log"
server_pid=""

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

echo "Creating database $LEAK_DATABASE"
psql "$LEAK_PG_ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $LEAK_DATABASE WITH (FORCE)" \
  -c "CREATE DATABASE $LEAK_DATABASE"

export DATABASE_URL="$leak_database_url"
export REDIS_URL="$LEAK_REDIS_URL"
export APP_SECRET="$LEAK_APP_SECRET"
export APP_URL="$wiki_url"
export PORT="$LEAK_WIKI_PORT"
export STORAGE_DRIVER=local
export AI_BRIDGE_SECRET="$LEAK_BRIDGE_SECRET"
export AI_SERVICE_TOKEN="$LEAK_SERVICE_TOKEN"
export AI_SERVICE_URL="http://127.0.0.1:1"
export NODE_ENV=production

if [ ! -f "$root/apps/server/dist/main.js" ]; then
  echo "Building the server"
  pnpm --dir "$root" --filter ./apps/server run build
fi

echo "Applying the wiki migrations"
pnpm --dir "$root" --filter ./apps/server run migration:latest

echo "Rebuilding the seed data"
(cd "$root/apps/server" && node dist/integrations/seed/seed-main)

echo "Preparing the AI service schema"
(
  cd "$root/ai-service"
  AI_DB_ADMIN_URL="postgresql://$admin_credentials@$server_host/$LEAK_DATABASE" \
    AI_DATABASE_URL="$leak_ai_database_url" \
    uv run python -m ai_service.db_setup
  AI_DATABASE_URL="$leak_ai_database_url" uv run alembic upgrade head
)

echo "Starting the wiki on $wiki_url"
(cd "$root/apps/server" && exec node dist/main) >"$server_log" 2>&1 &
server_pid=$!

waited=0
until curl -fsS -o /dev/null "$wiki_url/api/health" 2>/dev/null; do
  if [ "$waited" -ge "$LEAK_HEALTH_TIMEOUT" ] || ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Wiki not reachable at $wiki_url/api/health" >&2
    tail -n 40 "$server_log" >&2
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done
if ! kill -0 "$server_pid" 2>/dev/null; then
  echo "The wiki started on $wiki_url exited after its health check; another process answers on port $LEAK_WIKI_PORT" >&2
  tail -n 40 "$server_log" >&2
  exit 1
fi
echo "Wiki ready after ${waited}s"

export LEAK_WIKI_URL="$wiki_url"
export LEAK_SERVICE_TOKEN
export LEAK_BRIDGE_SECRET
export LEAK_AI_DATABASE_URL="$leak_ai_database_url"
export LEAK_REDIS_URL
export LEAK_SEED_PASSWORD

status=0
(cd "$root/ai-service" && uv run pytest -m leak "$@") || status=$?
exit "$status"
