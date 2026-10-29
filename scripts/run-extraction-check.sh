#!/usr/bin/env bash
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)

EXTRACT_DATABASE=${EXTRACT_DATABASE:-docmost_extract_check}
EXTRACT_PG_ADMIN_URL=${EXTRACT_PG_ADMIN_URL:-postgresql://docmost:docmost@127.0.0.1:5433/postgres}
EXTRACT_REDIS_URL=${EXTRACT_REDIS_URL:-redis://127.0.0.1:6380/11}
EXTRACT_WIKI_PORT=${EXTRACT_WIKI_PORT:-3101}
EXTRACT_AI_PORT=${EXTRACT_AI_PORT:-8102}
EXTRACT_LLM_BASE_URL=${EXTRACT_LLM_BASE_URL:-http://127.0.0.1:11434/v1}
EXTRACT_LLM_MODEL=${EXTRACT_LLM_MODEL:-qwen3:8b}
EXTRACT_AI_ROLE=docmost_ai_extract
EXTRACT_HEALTH_TIMEOUT=${EXTRACT_HEALTH_TIMEOUT:-180}

case "$EXTRACT_DATABASE" in
  docmost_extract*) ;;
  *)
    echo "Refusing to reset database $EXTRACT_DATABASE: the name must start with docmost_extract" >&2
    exit 1
    ;;
esac
case "$EXTRACT_DATABASE" in
  *[!A-Za-z0-9_]*)
    echo "Refusing database name $EXTRACT_DATABASE: only letters, digits and underscores" >&2
    exit 1
    ;;
esac
case "$EXTRACT_REDIS_URL" in
  */0 | */)
    echo "Refusing to flush Redis database 0 in $EXTRACT_REDIS_URL: use a dedicated database number" >&2
    exit 1
    ;;
esac

for tool in psql openssl curl uv node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is required" >&2
    exit 1
  fi
done

EXTRACT_APP_SECRET=${EXTRACT_APP_SECRET:-$(openssl rand -hex 32)}
EXTRACT_SERVICE_TOKEN=${EXTRACT_SERVICE_TOKEN:-$(openssl rand -hex 32)}
EXTRACT_BRIDGE_SECRET=${EXTRACT_BRIDGE_SECRET:-$(openssl rand -hex 32)}
EXTRACT_AI_PASSWORD=${EXTRACT_AI_PASSWORD:-$(openssl rand -hex 32)}

wiki_url="http://127.0.0.1:$EXTRACT_WIKI_PORT"
ai_url="http://127.0.0.1:$EXTRACT_AI_PORT"

require_free_port() {
  local port=$1 probe=0
  curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$port/" 2>/dev/null || probe=$?
  if [ "$probe" -ne 7 ]; then
    echo "Port $port is already in use: stop the process on it or choose another port" >&2
    exit 1
  fi
}
require_free_port "$EXTRACT_WIKI_PORT"
require_free_port "$EXTRACT_AI_PORT"

server_base=${EXTRACT_PG_ADMIN_URL%/*}
server_host=${server_base#*@}
admin_credentials=${server_base#*://}
admin_credentials=${admin_credentials%@*}
extract_database_url="$server_base/$EXTRACT_DATABASE"
extract_ai_database_url="postgresql://$EXTRACT_AI_ROLE:$EXTRACT_AI_PASSWORD@$server_host/$EXTRACT_DATABASE"

work_dir=$(mktemp -d)
mkdir -p "$work_dir/apps/server" "$work_dir/ai-service"
wiki_pid=""
ai_pid=""

flush_redis() {
  (cd "$root/ai-service" && REDIS_URL="$EXTRACT_REDIS_URL" uv run python -c \
    "import os, redis; redis.Redis.from_url(os.environ['REDIS_URL']).flushdb()")
}

cleanup() {
  for pid in "$ai_pid" "$wiki_pid"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  psql "$EXTRACT_PG_ADMIN_URL" -q \
    -c "DROP DATABASE IF EXISTS $EXTRACT_DATABASE WITH (FORCE)" \
    -c "DROP ROLE IF EXISTS $EXTRACT_AI_ROLE" >/dev/null 2>&1 || true
  flush_redis >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

echo "Creating database $EXTRACT_DATABASE"
psql "$EXTRACT_PG_ADMIN_URL" -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS $EXTRACT_DATABASE WITH (FORCE)" \
  -c "CREATE DATABASE $EXTRACT_DATABASE"
flush_redis

export DATABASE_URL="$extract_database_url"
export REDIS_URL="$EXTRACT_REDIS_URL"
export APP_SECRET=$EXTRACT_APP_SECRET
export APP_URL="$wiki_url"
export PORT="$EXTRACT_WIKI_PORT"
export STORAGE_DRIVER=local
export AI_BRIDGE_SECRET=$EXTRACT_BRIDGE_SECRET
export AI_SERVICE_TOKEN=$EXTRACT_SERVICE_TOKEN
export AI_SERVICE_URL="$ai_url"
export NODE_ENV=production

if [ ! -f "$root/apps/server/dist/main.js" ]; then
  echo "Building the server"
  pnpm --dir "$root" --filter ./apps/server run build
fi

echo "Applying the wiki migrations"
pnpm --dir "$root" --filter ./apps/server run migration:latest

echo "Seeding the wiki (storage in $work_dir/data/storage)"
(cd "$work_dir/apps/server" && node "$root/apps/server/dist/integrations/seed/seed-main")

echo "Preparing the AI service schema"
(
  cd "$root/ai-service"
  AI_DB_ADMIN_URL="postgresql://$admin_credentials@$server_host/$EXTRACT_DATABASE" \
    AI_DATABASE_URL="$extract_ai_database_url" \
    uv run python -m ai_service.db_setup
  AI_DATABASE_URL="$extract_ai_database_url" uv run alembic upgrade head
)

wait_until_up() {
  local label=$1 url=$2 pid=$3 waited=0 code
  until code=$(curl -s -o /dev/null -w '%{http_code}' "$url") && [ "$code" != "000" ]; do
    if [ "$waited" -ge "$EXTRACT_HEALTH_TIMEOUT" ] || ! kill -0 "$pid" 2>/dev/null; then
      echo "$label not reachable at $url" >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$label ready after ${waited}s"
}

echo "Starting the wiki on $wiki_url"
(cd "$work_dir/apps/server" && exec node "$root/apps/server/dist/main") >"$work_dir/wiki.log" 2>&1 &
wiki_pid=$!
wait_until_up "Wiki" "$wiki_url/api/health" "$wiki_pid" || {
  tail -n 40 "$work_dir/wiki.log" >&2
  exit 1
}

echo "Starting the AI service on $ai_url (model $EXTRACT_LLM_MODEL at $EXTRACT_LLM_BASE_URL)"
(
  cd "$work_dir/ai-service"
  export AI_DATABASE_URL="$extract_ai_database_url"
  export AI_WIKI_URL="$wiki_url"
  export AI_SERVICE_PORT="$EXTRACT_AI_PORT"
  export AI_LLM_BASE_URL="$EXTRACT_LLM_BASE_URL"
  export AI_LLM_MODEL="$EXTRACT_LLM_MODEL"
  exec uv run --project "$root/ai-service" python -m ai_service
) >"$work_dir/ai-service.log" 2>&1 &
ai_pid=$!
wait_until_up "AI service" "$ai_url/v1/session" "$ai_pid" || {
  tail -n 40 "$work_dir/ai-service.log" >&2
  exit 1
}

export STACK_WIKI_URL="$wiki_url"
export STACK_AI_DATABASE_URL="$extract_ai_database_url"
export STACK_SERVICE_TOKEN=$EXTRACT_SERVICE_TOKEN
export STACK_BRIDGE_SECRET=$EXTRACT_BRIDGE_SECRET
export STACK_REDIS_URL="$EXTRACT_REDIS_URL"
export STACK_LLM_BASE_URL="$EXTRACT_LLM_BASE_URL"
export STACK_LLM_MODEL="$EXTRACT_LLM_MODEL"

status=0
(cd "$root/ai-service" && uv run pytest -m stack -s tests/test_stack_extract.py "$@") || status=$?
exit "$status"
