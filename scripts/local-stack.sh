#!/usr/bin/env bash

: "${root:?scripts/local-stack.sh is sourced after root is set}"

default_pg_admin_url=postgresql://docmost:docmost@127.0.0.1:5433/postgres
default_llm_base_url=http://127.0.0.1:11434/v1
default_llm_model=qwen3:8b
default_health_timeout=180

require_tools() {
  local tool
  for tool in psql openssl curl uv node; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "$tool is required" >&2
      exit 1
    fi
  done
}

require_database_name() {
  local name=$1 prefix=$2
  case "$name" in
    "$prefix"*) ;;
    *)
      echo "Refusing to reset database $name: the name must start with $prefix" >&2
      exit 1
      ;;
  esac
  case "$name" in
    *[!A-Za-z0-9_]*)
      echo "Refusing database name $name: only letters, digits and underscores" >&2
      exit 1
      ;;
  esac
}

require_dedicated_redis() {
  local url=$1
  if ! (cd "$root/ai-service" && REDIS_URL="$url" uv run python -c \
    "import os, sys, redis
db = redis.Redis.from_url(os.environ['REDIS_URL']).connection_pool.connection_kwargs.get('db', 0)
sys.exit(0 if isinstance(db, int) and 1 <= db <= 15 else 1)" >/dev/null 2>&1); then
    echo "Refusing to flush Redis in $url: redis-py must select a dedicated database number from 1 to 15" >&2
    exit 1
  fi
}

flush_redis() {
  (cd "$root/ai-service" && REDIS_URL="$1" uv run python -c \
    "import os, redis; redis.Redis.from_url(os.environ['REDIS_URL']).flushdb()")
}

require_free_port() {
  local port=$1 probe=0
  curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$port/" 2>/dev/null || probe=$?
  if [ "$probe" -ne 7 ]; then
    echo "Port $port is already in use: stop the process on it or choose another port" >&2
    exit 1
  fi
}

split_admin_url() {
  server_base=${1%/*}
  server_host=${server_base#*@}
  admin_credentials=${server_base#*://}
  admin_credentials=${admin_credentials%@*}
}

build_server_unless_built() {
  if [ ! -f "$root/apps/server/dist/main.js" ]; then
    echo "Building the server"
    pnpm --dir "$root" --filter ./apps/server run build
  fi
}

prepare_ai_schema() {
  (
    cd "$root/ai-service" || exit
    AI_DB_ADMIN_URL="postgresql://$admin_credentials@$server_host/$database" \
      AI_DATABASE_URL="$ai_database_url" \
      uv run python -m ai_service.db_setup
    AI_DATABASE_URL="$ai_database_url" uv run alembic upgrade head
  )
}

wait_until_up() {
  local label=$1 url=$2 pid=$3 log=$4 waited=0 code
  until code=$(curl -s -o /dev/null -w '%{http_code}' "$url") && [ "$code" != "000" ]; do
    if [ "$waited" -ge "$health_timeout" ] || ! kill -0 "$pid" 2>/dev/null; then
      echo "$label not reachable at $url" >&2
      tail -n 40 "$log" >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$label ready after ${waited}s"
}

stop_stack() {
  local pid
  for pid in "$ai_pid" "$wiki_pid"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  psql "$pg_admin_url" -q \
    -c "DROP DATABASE IF EXISTS $database WITH (FORCE)" \
    -c "DROP ROLE IF EXISTS $ai_role" >/dev/null 2>&1 || true
  flush_redis "$redis_url" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}

create_database() {
  echo "Creating database $database"
  psql "$pg_admin_url" -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS $database WITH (FORCE)" \
    -c "CREATE DATABASE $database"
  flush_redis "$redis_url"
}

export_wiki_environment() {
  export DATABASE_URL="$server_base/$database"
  export REDIS_URL="$redis_url"
  export APP_SECRET=$app_secret
  export APP_URL="$wiki_url"
  export PORT="$wiki_port"
  export STORAGE_DRIVER=local
  export AI_BRIDGE_SECRET=$bridge_secret
  export AI_SERVICE_TOKEN=$service_token
  export AI_SERVICE_URL="$ai_url"
  export NODE_ENV=production
}

start_wiki() {
  echo "Starting the wiki on $wiki_url"
  (cd "$work_dir/apps/server" && exec node "$root/apps/server/dist/main") >"$work_dir/wiki.log" 2>&1 &
  wiki_pid=$!
  wait_until_up "Wiki" "$wiki_url/api/health" "$wiki_pid" "$work_dir/wiki.log"
}

start_ai_service() {
  echo "Starting the AI service on $ai_url (model $llm_model at $llm_base_url)"
  (
    cd "$work_dir/ai-service" || exit
    export AI_DATABASE_URL="$ai_database_url"
    export AI_WIKI_URL="$wiki_url"
    export AI_SERVICE_PORT="$ai_port"
    export AI_LLM_BASE_URL="$llm_base_url"
    export AI_LLM_MODEL="$llm_model"
    exec uv run --project "$root/ai-service" python -m ai_service
  ) >"$ai_log" 2>&1 &
  ai_pid=$!
  wait_until_up "AI service" "$ai_url/v1/session" "$ai_pid" "$ai_log"
}

start_stack() {
  require_database_name "$database" "$database_prefix"
  require_tools
  require_dedicated_redis "$redis_url"

  app_secret=${app_secret:-$(openssl rand -hex 32)}
  service_token=${service_token:-$(openssl rand -hex 32)}
  bridge_secret=${bridge_secret:-$(openssl rand -hex 32)}
  ai_password=${ai_password:-$(openssl rand -hex 32)}

  wiki_url="http://127.0.0.1:$wiki_port"
  ai_url="http://127.0.0.1:$ai_port"
  require_free_port "$wiki_port"
  require_free_port "$ai_port"

  split_admin_url "$pg_admin_url"
  ai_database_url="postgresql://$ai_role:$ai_password@$server_host/$database"

  work_dir=$(mktemp -d)
  mkdir -p "$work_dir/apps/server" "$work_dir/ai-service"
  ai_log="$work_dir/ai-service.log"
  wiki_pid=""
  ai_pid=""
  trap stop_stack EXIT

  create_database
  export_wiki_environment
  build_server_unless_built

  echo "Applying the wiki migrations"
  pnpm --dir "$root" --filter ./apps/server run migration:latest

  echo "Seeding the wiki (storage in $work_dir/data/storage)"
  (cd "$work_dir/apps/server" && node "$root/apps/server/dist/integrations/seed/seed-main")

  echo "Preparing the AI service schema"
  prepare_ai_schema

  start_wiki
  start_ai_service
}

run_stack_tests() {
  local test_file=$1 status=0
  shift
  (cd "$root/ai-service" && uv run pytest -m stack -s "$test_file" "$@") || status=$?
  if [ "$status" -ne 0 ]; then
    echo "AI service log tail:" >&2
    tail -n 40 "$ai_log" >&2
  fi
  return "$status"
}
