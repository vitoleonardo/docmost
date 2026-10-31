# Shared helpers for the kit's hooks. POSIX sh, no jq or other runtime needed.
# shellcheck shell=sh

KIT_ROOT=${CLAUDE_PROJECT_DIR:-$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)}
cd "$KIT_ROOT" || exit 1

# shellcheck source=../bin/conf.sh
. "$(dirname -- "$0")/../bin/conf.sh"
approval_from_environment=$(export -p | grep -E '^(export|declare -x) KIT_(APPROVAL|GATE_[A-Z]+)=')
if [ -f .claude/kit.conf ]; then
  # shellcheck source=/dev/null
  . ./.claude/kit.conf
fi
eval "$approval_from_environment"

# file_value <path relative to the root> <variable>: the variable from the config of the file's package.
# In a monorepo a package's .claude/kit.conf decides its own source and test patterns.
file_value() {
  conf_value "$(package_of "$1")" "$2"
}

# Hook input arrives as one JSON document on stdin.
HOOK_INPUT=$(cat)

# Print the string value of a JSON key from the hook input (last occurrence),
# with the common escapes undone. Good enough for paths and commands; not a
# general JSON parser.
json_string() {
  printf '%s' "$HOOK_INPUT" | tr '\n' ' ' |
    sed -nE 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p' |
    sed -e 's/\\"/"/g' -e 's/\\\//\//g' -e 's/\\[nt]/ /g' -e 's/\\\\/\\/g'
}

json_bool() {
  printf '%s' "$HOOK_INPUT" | grep -Eq '"'"$1"'"[[:space:]]*:[[:space:]]*true'
}

# Encode stdin as the body of a JSON string (without the surrounding quotes).
json_escape() {
  esc=$(printf '\033')
  sed "s/${esc}\[[0-9;]*[A-Za-z]//g" | tr -d '\000-\010\013\014\016-\037' |
    awk 'BEGIN { ORS = "" } {
      gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "")
      if (NR > 1) print "\\n"
      print
    }'
}

# Per-session state files under .work/ (gitignored).
state_file() {
  sid=$(json_string session_id | tr -cd 'A-Za-z0-9_-')
  mkdir -p .work
  [ -f .work/.gitignore ] || printf '*\n!.gitignore\n' >.work/.gitignore
  printf '.work/session-%s.%s' "${sid:-unknown}" "$1"
}

# Path relative to the project root, or empty if the file is outside it.
relative_path() {
  case $1 in
    "$KIT_ROOT"/*) printf '%s' "${1#"$KIT_ROOT"/}" ;;
    /*) ;;
    *) printf '%s' "$1" ;;
  esac
}

kit_check() {
  if [ "$1" = typecheck ] && [ -f .claude/baseline.tsv ]; then
    .claude/bin/check --against-baseline typecheck
  else
    .claude/bin/check "$@"
  fi
}
