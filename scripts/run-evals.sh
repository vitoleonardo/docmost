#!/usr/bin/env bash
set -eu

judge_key=${EVAL_ANTHROPIC_API_KEY:-}
unset EVAL_ANTHROPIC_API_KEY

root=$(cd "$(dirname "$0")/.." && pwd)
. "$root/scripts/local-stack.sh"

database=${EVAL_DATABASE:-docmost_eval_run}
database_prefix=docmost_eval
pg_admin_url=${EVAL_PG_ADMIN_URL:-$default_pg_admin_url}
redis_url=${EVAL_REDIS_URL:-redis://127.0.0.1:6380/9}
wiki_port=${EVAL_WIKI_PORT:-3103}
ai_port=${EVAL_AI_PORT:-8104}
llm_base_url=${EVAL_LLM_BASE_URL:-$default_llm_base_url}
llm_model=${EVAL_LLM_MODEL:-$default_llm_model}
ai_role=docmost_ai_eval
health_timeout=${EVAL_HEALTH_TIMEOUT:-$default_health_timeout}
index_timeout=${EVAL_INDEX_TIMEOUT:-900}
app_secret=${EVAL_APP_SECRET:-}
service_token=${EVAL_SERVICE_TOKEN:-}
bridge_secret=${EVAL_BRIDGE_SECRET:-}
ai_password=${EVAL_AI_PASSWORD:-}

start_stack

echo "Indexing the seed data (the first run downloads the embedding model)"
wait_until_indexed || exit 2

status=0
if [ -n "$judge_key" ]; then
  (cd "$root/ai-service" && EVAL_WIKI_URL="$wiki_url" EVAL_MODEL="$llm_model" \
    EVAL_ANTHROPIC_API_KEY="$judge_key" uv run python -m ai_service.eval_suite "$@") || status=$?
else
  (cd "$root/ai-service" && EVAL_WIKI_URL="$wiki_url" EVAL_MODEL="$llm_model" \
    uv run python -m ai_service.eval_suite "$@") || status=$?
fi
if [ "$status" -ne 0 ]; then
  echo "AI service log tail:" >&2
  tail -n 40 "$ai_log" >&2
fi
exit "$status"
