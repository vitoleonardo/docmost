#!/usr/bin/env bash
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
. "$root/scripts/local-stack.sh"

database=${EXTRACT_DATABASE:-docmost_extract_check}
database_prefix=docmost_extract
pg_admin_url=${EXTRACT_PG_ADMIN_URL:-$default_pg_admin_url}
redis_url=${EXTRACT_REDIS_URL:-redis://127.0.0.1:6380/11}
wiki_port=${EXTRACT_WIKI_PORT:-3101}
ai_port=${EXTRACT_AI_PORT:-8102}
llm_base_url=${EXTRACT_LLM_BASE_URL:-$default_llm_base_url}
llm_model=${EXTRACT_LLM_MODEL:-$default_llm_model}
ai_role=docmost_ai_extract
health_timeout=${EXTRACT_HEALTH_TIMEOUT:-$default_health_timeout}
app_secret=${EXTRACT_APP_SECRET:-}
service_token=${EXTRACT_SERVICE_TOKEN:-}
bridge_secret=${EXTRACT_BRIDGE_SECRET:-}
ai_password=${EXTRACT_AI_PASSWORD:-}

start_stack

export STACK_WIKI_URL="$wiki_url"
export STACK_AI_DATABASE_URL="$ai_database_url"
export STACK_SERVICE_TOKEN=$service_token
export STACK_BRIDGE_SECRET=$bridge_secret
export STACK_REDIS_URL="$redis_url"
export STACK_LLM_BASE_URL="$llm_base_url"
export STACK_LLM_MODEL="$llm_model"

run_stack_tests tests/test_stack_extract.py "$@"
