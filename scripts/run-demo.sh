#!/usr/bin/env bash
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
. "$root/scripts/local-stack.sh"

database=${DEMO_DATABASE:-docmost_demo}
database_prefix=docmost_demo
pg_admin_url=${DEMO_PG_ADMIN_URL:-$default_pg_admin_url}
redis_url=${DEMO_REDIS_URL:-redis://127.0.0.1:6380/8}
wiki_port=${DEMO_WIKI_PORT:-3104}
ai_port=${DEMO_AI_PORT:-8105}
llm_base_url=${DEMO_LLM_BASE_URL:-$default_llm_base_url}
llm_model=${DEMO_LLM_MODEL:-$default_llm_model}
ai_role=docmost_ai_demo
health_timeout=${DEMO_HEALTH_TIMEOUT:-$default_health_timeout}
index_timeout=${DEMO_INDEX_TIMEOUT:-900}
media_dir="$root/docs/media"

record=false
case "${1:-}" in
  "") ;;
  --record) record=true ;;
  *)
    echo "Usage: scripts/run-demo.sh [--record]" >&2
    exit 1
    ;;
esac

to_gif() {
  local speed=$1 output=$2
  shift 2
  local inputs=() filter="" index=0 input
  for input in "$@"; do
    inputs+=(-i "$input")
    filter="$filter[$index:v]"
    index=$((index + 1))
  done
  ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex \
    "${filter}concat=n=$index:v=1:a=0,setpts=PTS/$speed,fps=10,scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
    "$media_dir/$output"
  echo "Wrote docs/media/$output ($(du -h "$media_dir/$output" | cut -f1))"
}

record_demo() {
  local videos="$work_dir/videos"
  command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is required for --record" >&2; exit 1; }
  (cd "$root" && DEMO_URL="$wiki_url" DEMO_VIDEO_DIR="$videos" \
    pnpm exec playwright test -c playwright.demo.config.ts)
  mkdir -p "$media_dir"
  to_gif 1.5 ai-ask.gif "$videos/ask.webm"
  to_gif 1.5 ai-permissions.gif "$videos/permissions-student.webm" "$videos/permissions-owner.webm"
  to_gif 2 ai-extraction.gif "$videos/extraction.webm"
  to_gif 3 ai-agent.gif "$videos/agent.webm"
}

start_stack

echo "Indexing the seed data (the first run downloads the embedding model)"
wait_until_indexed || exit 2

if [ "$record" = true ]; then
  record_demo
  exit 0
fi

cat <<EOF

The demo runs on $wiki_url (model $llm_model). Press Ctrl-C to stop it; that drops $database.
Password for every login: seed-demo-password
  joerg.ostmoor@ostmooimooi.example.com   Geschäftsführer, sees everything
  sabine.kettler@ostmooimooi.example.com  Projektleiterin
  tobias.renner@ostmooimooi.example.com   Vertriebler
  lukas.brehm@ostmooimooi.example.com     Werkstudent, sees the least
EOF
wait "$wiki_pid"
