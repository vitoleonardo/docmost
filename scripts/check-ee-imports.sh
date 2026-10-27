#!/bin/sh
set -u

base=${1:-origin/main}
set -- ':(glob)**/*.ts' ':(glob)**/*.tsx' ':(glob)**/*.mts' ':(glob)**/*.cts' \
  ':(glob)**/*.js' ':(glob)**/*.jsx' ':(glob)**/*.mjs' ':(glob)**/*.cjs'
if [ -f .claude/kit.conf ]; then
  for p in $(sh -c '. ./.claude/kit.conf; echo "${KIT_PROTECTED_PATHS:-}"'); do
    set -- "$@" ":(exclude)${p%/}"
  done
fi

diff=$(git diff -U0 --no-color "$base...HEAD" -- "$@") || {
  echo "check-ee-imports: git diff against $base failed." >&2
  exit 2
}

found=$(printf '%s\n' "$diff" | awk -v quotes="\"'" '
  BEGIN {
    q = "[" quotes "]"
    nq = "[^" quotes "]"
    specifier = "(from|import|require)[ \t]*\\(?[ \t]*" q nq "+" q
  }
  /^\+\+\+ / { file = substr($0, 7); next }
  /^@@/ { split($3, pos, ","); line = substr(pos[1], 2) + 0; next }
  /^\+/ {
    text = substr($0, 2)
    rest = text
    while (match(rest, specifier)) {
      spec = substr(rest, RSTART, RLENGTH)
      sub("^" nq "*" q, "", spec)
      sub(q "$", "", spec)
      if (spec ~ /(^|\/)ee(\/|$)/) { printf "%s:%d: %s\n", file, line, text; break }
      rest = substr(rest, RSTART + RLENGTH)
    }
    line++
  }
')

if [ -n "$found" ]; then
  printf '%s\n' "$found"
  echo "check-ee-imports: the branch adds imports from the ee code, which is enterprise-licensed. Remove them."
  exit 1
fi
echo "check-ee-imports: no new imports from the ee code."
