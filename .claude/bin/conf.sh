# Package config lookup, sourced by .claude/bin/check, .claude/bin/baseline and the hooks (POSIX sh).
# A package is a folder with its own .claude/kit.conf; the project root's .claude/kit.conf is the fallback.
# Paths are relative to the project root. KIT_CONF_ROOT (default: the root) and KIT_CONF_DIR (default: .claude)
# say where configs are looked up, so /onboard can measure a baseline with configs it only staged
# (KIT_CONF_ROOT=.work/onboard/files KIT_CONF_DIR=dot-claude).
# shellcheck shell=sh

KIT_CONF_ROOT=${KIT_CONF_ROOT:-.}
KIT_CONF_DIR=${KIT_CONF_DIR:-.claude}
# The root config's bin folder, for adapter helpers that kit.conf commands call ("$KIT_BIN/coverage-files.mjs").
KIT_BIN=$(CDPATH='' cd -- "$KIT_CONF_ROOT/$KIT_CONF_DIR/bin" 2>/dev/null && pwd) || KIT_BIN=$PWD/.claude/bin
export KIT_BIN

# conf_file <package>: the config file of a package.
conf_file() {
  printf '%s/%s/%s/kit.conf' "$KIT_CONF_ROOT" "$1" "$KIT_CONF_DIR"
}

# package_of <path>: the package folder ("." for the root) whose config owns the path.
package_of() {
  _dir=$(dirname -- "$1")
  while [ "$_dir" != . ] && [ "$_dir" != / ]; do
    if [ -f "$(conf_file "$_dir")" ]; then
      printf '%s\n' "$_dir"
      return 0
    fi
    _dir=$(dirname -- "$_dir")
  done
  printf '.\n'
}

# packages: every package folder, the root first.
packages() {
  printf '.\n'
  (cd "$KIT_CONF_ROOT" && find . \( -name node_modules -o -name .git -o -name .work -o -name .venv \) -prune -o \
    -path "./*/$KIT_CONF_DIR/kit.conf" -type f -print) | sed -e 's|^\./||' -e "s|/$KIT_CONF_DIR/kit\.conf\$||" | sort
}

# conf_value <package> <variable>: the value a package's config gives a variable, sourced in its folder.
conf_value() {
  (
    conf=$(CDPATH='' cd -- "$(dirname -- "$(conf_file "$1")")" 2>/dev/null && pwd)/kit.conf
    cd "$1" 2>/dev/null || exit 0
    [ -f "$conf" ] || exit 0
    # shellcheck source=/dev/null
    . "$conf"
    eval "printf '%s' \"\${$2:-}\""
  )
}

# base_ref: the base branch, KIT_BASE or origin's default branch, else main.
base_ref() {
  if [ -n "${KIT_BASE:-}" ]; then printf '%s' "$KIT_BASE"; return; fi
  git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || printf 'main'
}

# merge_base: the point the branch left the base; the working tree is compared with it.
merge_base() {
  git merge-base "$(base_ref)" HEAD 2>/dev/null || git rev-parse "$(base_ref)" 2>/dev/null || git rev-parse HEAD
}

# matches_any <file> <space-separated shell patterns>: true if the file matches one of them.
matches_any() {
  set -f
  for _pattern in $2; do
    # shellcheck disable=SC2254
    case $1 in
      $_pattern | */$_pattern) set +f; return 0 ;;
    esac
  done
  set +f
  return 1
}
