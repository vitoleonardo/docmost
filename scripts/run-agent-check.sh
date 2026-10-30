#!/usr/bin/env bash
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
. "$root/scripts/local-stack.sh"

database=${AGENT_DATABASE:-docmost_agent_check}
database_prefix=docmost_agent
pg_admin_url=${AGENT_PG_ADMIN_URL:-$default_pg_admin_url}
redis_url=${AGENT_REDIS_URL:-redis://127.0.0.1:6380/10}
wiki_port=${AGENT_WIKI_PORT:-3102}
ai_port=${AGENT_AI_PORT:-8103}
llm_base_url=${AGENT_LLM_BASE_URL:-$default_llm_base_url}
llm_model=${AGENT_LLM_MODEL:-$default_llm_model}
ai_role=docmost_ai_agent
health_timeout=${AGENT_HEALTH_TIMEOUT:-$default_health_timeout}
app_secret=${AGENT_APP_SECRET:-}
service_token=${AGENT_SERVICE_TOKEN:-}
bridge_secret=${AGENT_BRIDGE_SECRET:-}
ai_password=${AGENT_AI_PASSWORD:-}

start_stack

export STACK_WIKI_URL="$wiki_url"
export STACK_AI_LOG="$ai_log"

run_stack_tests tests/test_stack_agent.py "$@"
