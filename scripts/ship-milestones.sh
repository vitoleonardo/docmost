#!/bin/sh
set -u

cd "$(git rev-parse --show-toplevel)" || exit 2
run_dir=.work/ship-run
mkdir -p "$run_dir"
if [ -z "${SHIP_MILESTONES_PINNED:-}" ]; then
  cp scripts/ship-milestones.sh "$run_dir/ship-milestones.sh" || exit 2
  SHIP_MILESTONES_PINNED=1 exec sh "$run_dir/ship-milestones.sh" "$@"
fi

milestones="m3:ai-bridge m4:indexing m5:ask m6:leak-tests m7:extraction m8:agent m9:request-log m10:evals"
first_base=m2-seed-data
foundation_branch=m2-seed-data
max_session_seconds=$((4 * 3600))
max_idle_seconds=$((20 * 60))
max_identical_calls=6
max_turns=500
from=m3
dry_run=0

while [ $# -gt 0 ]; do
  case $1 in
    --from) from=${2:?--from needs a milestone, e.g. m4}; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) echo "usage: scripts/ship-milestones.sh [--from m3] [--dry-run]" >&2; exit 2 ;;
  esac
done

case " $milestones " in
  *" $from:"*) ;;
  *) echo "ship-milestones: unknown milestone $from" >&2; exit 2 ;;
esac

log() {
  line="$(date '+%d.%m.%Y %H:%M') $*"
  printf '%s\n' "$line" | tee -a "$run_dir/run.log"
}

notify() {
  osascript -e "display notification \"$1\" with title \"ship-milestones\"" >/dev/null 2>&1 || true
}

halt() {
  log "HALT $1"
  notify "Halted: $1"
  exit 1
}

headless_rules() {
  cat <<EOF
You run headless and unattended: nobody answers questions or permission prompts.
The user chose KIT_APPROVAL=autonomous on 28.10.2026: decide at every auto gate and log it under Decisions to review.
You are on branch $2, created off $1. Stay on it for the spec, the plan and the build; do not create another branch.
The base branch for review, verify and every gate is $1 (KIT_BASE=$1 is set), not main: earlier milestones are not part of this diff.
Open exactly one PR for this milestone with gh pr create --draft --base $1 --head $2. Never split the milestone into several PRs, even past 400 changed lines; the user decided one PR per milestone. Log the oversize under Decisions to review.
After two failed verify rounds, run one more verify round without asking when every failure is in tests or test setup, or needs a hotfix: a small product fix that keeps the spec as written (layout, responsive behaviour, a missing state). Route the hotfix through the implementer with a red test, then review and verify; log it under Decisions to review. The user allowed this on 29.10.2026. A failure that needs a spec change still stops.
When a step says stop and ask, or a failure stop is reached, write the question with its context under "## Questions for the user" in .work/$2.md, commit nothing half-done, and end the session.
Do not change earlier milestones' branches, specs or open decisions. Never merge a PR.
Every PR, commit and CI run you mention in the PR body gets its full URL.
EOF
}

pr_url() {
  gh pr list --head "$1" --state open --json url -q '.[0].url' 2>/dev/null
}

shipped() {
  [ -n "$(pr_url "$1")" ] && grep -E "\| *$1 *\|" specs/README.md | grep -q 'in-review'
}

has_questions() {
  [ -f ".work/$1.md" ] && grep -q '^## Questions for the user' ".work/$1.md"
}

loop_or_limit() {
  node -e '
    const [file, maxTurns, maxIdentical] = process.argv.slice(1);
    const lastCall = new Map();
    let turns = 0;
    for (const line of require("fs").readFileSync(file, "utf8").split("\n")) {
      if (!line.startsWith("{")) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type !== "assistant") continue;
      const agent = message.parent_tool_use_id ?? "main";
      if (agent === "main") turns++;
      for (const block of message.message?.content ?? []) {
        if (block.type !== "tool_use") continue;
        const call = block.name + " " + JSON.stringify(block.input);
        const previous = lastCall.get(agent);
        const count = previous?.call === call ? previous.count + 1 : 1;
        lastCall.set(agent, { call, count });
        if (count >= +maxIdentical) {
          console.log("the same tool call " + count + " times in a row: " + call.slice(0, 120));
          process.exit(0);
        }
      }
    }
    if (turns > +maxTurns) console.log("more than " + maxTurns + " turns");
  ' "$1" "$max_turns" "$max_identical_calls"
}

session_metrics() {
  node -e '
    let result;
    for (const line of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.includes("\"type\":\"result\"")) continue;
      try { result = JSON.parse(line); } catch { continue; }
    }
    const usage = result?.usage ?? {};
    const value = (number) => number ?? "-";
    console.log([value(result?.num_turns), value(result?.total_cost_usd), value(usage.input_tokens),
      value(usage.output_tokens), value(usage.cache_read_input_tokens), value(usage.cache_creation_input_tokens)].join("\t"));
  ' "$1"
}

usage_limit_reset() {
  node -e '
    let rejectedUntil = "";
    for (const line of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
      if (!line.includes("\"rate_limit_event\"")) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const info = event.rate_limit_info ?? {};
      rejectedUntil = info.status === "rejected" ? String(info.resetsAt ?? "") : "";
    }
    console.log(rejectedUntil);
  ' "$1"
}

wait_for_usage_reset() {
  until_epoch=$1
  log "WAIT $milestone: usage limit reached; resuming after $(date -r "$until_epoch" '+%d.%m.%Y %H:%M')"
  notify "$milestone waits for the usage limit to reset"
  remaining=$((until_epoch + 120 - $(date +%s)))
  [ "$remaining" -gt 0 ] && sleep "$remaining"
}

record_session() {
  outcome=$1 file=$2 seconds=$3
  sessions=$run_dir/sessions.tsv
  [ -f "$sessions" ] ||
    printf 'date\tmilestone\tattempt\toutcome\tminutes\tturns\tcost_usd\tinput\toutput\tcache_read\tcache_write\n' >"$sessions"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%d.%m.%Y %H:%M')" "$milestone" "$attempt" "$outcome" \
    "$((seconds / 60))" "$(session_metrics "$file")" >>"$sessions"
}

record_stop() {
  state=.work/$1.md
  stop="- headless session $attempt | budget | watchdog: $2 | stopped the session | $3"
  [ -f "$state" ] || { printf '## Stops\n%s\n' "$stop" >"$state"; return; }
  grep -q '^## Stops[[:space:]]*$' "$state" || printf '\n## Stops\n' >>"$state"
  awk -v stop="$stop" '{ print } /^## Stops[ \t]*$/ { print stop }' "$state" >"$state.tmp" && mv "$state.tmp" "$state"
}

watch_session() {
  pid=$1 file=$2 started=$(date +%s)
  limit_reason=
  while kill -0 "$pid" 2>/dev/null; do
    sleep 60
    now=$(date +%s)
    reason=
    [ $((now - started)) -gt "$max_session_seconds" ] && reason="ran longer than $((max_session_seconds / 3600)) h"
    [ -z "$reason" ] && [ $((now - $(stat -f %m "$file"))) -gt "$max_idle_seconds" ] &&
      reason="no output for $((max_idle_seconds / 60)) min"
    [ -z "$reason" ] && reason=$(loop_or_limit "$file")
    if [ -n "$reason" ]; then
      log "LIMIT $milestone session $attempt stopped: $reason"
      limit_reason=$reason
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 1
    fi
  done
  wait "$pid"
}

run_session() {
  milestone=$1 slug=$2 base=$3 branch=$4 attempt=$5
  file=$run_dir/$milestone.$attempt.jsonl
  KIT_APPROVAL=autonomous KIT_BASE=$base claude -p "/ship-feature $slug ($milestone in docs/spec.md sections 8 and 9)" \
    --dangerously-skip-permissions \
    --append-system-prompt "$(headless_rules "$base" "$branch")" \
    --output-format stream-json --verbose \
    >"$file" 2>"$run_dir/$milestone.$attempt.err" &
  watch_session $! "$file"
}

base=$first_base
started=0
for entry in $milestones; do
  milestone=${entry%%:*}
  slug=${entry#*:}
  branch=$milestone-$slug
  [ "$milestone" = "$from" ] && started=1
  if [ $started -eq 0 ]; then
    base=$branch
    continue
  fi

  if [ $dry_run -eq 0 ] && shipped "$branch"; then
    log "SKIP $milestone already has $(pr_url "$branch")"
    base=$branch
    continue
  fi

  if [ $dry_run -eq 1 ]; then
    echo "$milestone: /ship-feature $slug on $branch, PR base $base"
    base=$branch
    continue
  fi

  [ -z "$(git status --porcelain)" ] || halt "$milestone: working tree not clean before start"
  if git rev-parse --verify --quiet "$branch" >/dev/null; then
    git checkout --quiet "$branch" || halt "$milestone: cannot check out $branch"
  else
    git checkout --quiet -b "$branch" "$base" || halt "$milestone: cannot create $branch off $base"
    git merge --quiet --no-edit "$foundation_branch" || { git merge --abort; halt "$milestone: merging $foundation_branch into $branch conflicts"; }
  fi

  log "START $milestone on $branch (base $base)"
  sessions_counted=0
  while [ "$sessions_counted" -lt 2 ]; do
    attempt=$((sessions_counted + 1))
    [ -e "$run_dir/$milestone.$attempt.jsonl" ] && attempt=$attempt.$(date +%s)
    session_started=$(date +%s)
    run_session "$milestone" "$slug" "$base" "$branch" "$attempt" || log "$milestone: session $attempt exited with $?"
    session_seconds=$(($(date +%s) - session_started))
    file=$run_dir/$milestone.$attempt.jsonl
    if shipped "$branch"; then
      record_session shipped "$file" "$session_seconds"
      break
    fi
    if has_questions "$branch"; then
      record_session questions "$file" "$session_seconds"
      halt "$milestone: questions in .work/$branch.md"
    fi
    reset=$(usage_limit_reset "$file")
    if [ -n "$reset" ]; then
      record_session "usage limit" "$file" "$session_seconds"
      wait_for_usage_reset "$reset"
      continue
    fi
    sessions_counted=$((sessions_counted + 1))
    if [ -n "$limit_reason" ]; then
      record_session "limit: $limit_reason" "$file" "$session_seconds"
      case $sessions_counted in
        1) record_stop "$branch" "$limit_reason" "resumed by the orchestrator" ;;
        *) record_stop "$branch" "$limit_reason" "chain halted" ;;
      esac
    else
      record_session "ended without a PR" "$file" "$session_seconds"
    fi
  done
  shipped "$branch" || halt "$milestone: no in-review PR after 2 sessions; see $run_dir/$milestone.*.jsonl"

  log "DONE $milestone $(pr_url "$branch")"
  git checkout --quiet "$branch" || halt "$milestone: cannot return to $branch"
  [ -z "$(git status --porcelain)" ] || halt "$milestone: working tree not clean after the session"
  base=$branch
done

[ $dry_run -eq 1 ] || { log "CHAIN DONE"; notify "All milestones have PRs"; }
