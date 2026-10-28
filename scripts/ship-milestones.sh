#!/bin/sh
set -u

milestones="m3:ai-bridge m4:indexing m5:ask m6:leak-tests m7:extraction m8:agent m9:request-log m10:evals"
first_base=m2-seed-data
run_dir=.work/ship-run
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

cd "$(git rev-parse --show-toplevel)" || exit 2
mkdir -p "$run_dir"

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
Open exactly one PR for this milestone with gh pr create --draft --base $1 --head $2. Never split the milestone into several PRs, even past 400 changed lines; the user decided one PR per milestone. Log the oversize under Decisions to review.
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

run_session() {
  milestone=$1 slug=$2 base=$3 branch=$4 attempt=$5
  KIT_APPROVAL=autonomous claude -p "/ship-feature $slug ($milestone in docs/spec.md sections 8 and 9)" \
    --dangerously-skip-permissions \
    --append-system-prompt "$(headless_rules "$base" "$branch")" \
    --output-format stream-json --verbose \
    >"$run_dir/$milestone.$attempt.jsonl" 2>"$run_dir/$milestone.$attempt.err"
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
  fi

  log "START $milestone on $branch (base $base)"
  for attempt in 1 2; do
    run_session "$milestone" "$slug" "$base" "$branch" "$attempt" || log "$milestone: session $attempt exited with $?"
    shipped "$branch" && break
    has_questions "$branch" && halt "$milestone: questions in .work/$branch.md"
  done
  shipped "$branch" || halt "$milestone: no in-review PR after 2 sessions; see $run_dir/$milestone.*.jsonl"

  log "DONE $milestone $(pr_url "$branch")"
  git checkout --quiet "$branch" || halt "$milestone: cannot return to $branch"
  [ -z "$(git status --porcelain)" ] || halt "$milestone: working tree not clean after the session"
  base=$branch
done

[ $dry_run -eq 1 ] || { log "CHAIN DONE"; notify "All milestones have PRs"; }
