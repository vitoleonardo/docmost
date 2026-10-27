#!/bin/sh
set -u

script=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)/check-ee-imports.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failed=0
run=0

mkdir "$tmp/repo" && cd "$tmp/repo" || exit 2
git init -q -b main .
git config user.email test@example.com
git config user.name test
mkdir -p src
printf 'import { Feature } from "@/ee/features";\n' >src/legacy.tsx
git add . && git commit -q -m base

expect() {
  run=$((run + 1))
  git checkout -q -B "case-$run" main
  mkdir -p "$(dirname -- "$3")"
  printf '%s\n' "$4" >"$3"
  git add . && git commit -q -m "case $run"
  "$script" main >"$tmp/out" 2>&1
  code=$?
  if [ "$code" -eq "$1" ]; then
    echo "ok   $2"
  else
    echo "FAIL $2: exit $code, expected $1"
    sed 's/^/     /' "$tmp/out"
    failed=$((failed + 1))
  fi
}

expect 1 "blocks a client alias import" src/a.tsx 'import { useHasFeature } from "@/ee/hooks/use-feature";'
expect 1 "blocks a server package import" src/b.ts "import { LicenseService } from '@docmost/ee/licence/license.service';"
expect 1 "blocks a relative import" src/c.ts 'import { x } from "../ee/x";'
expect 1 "blocks a dynamic import" src/d.tsx 'const Page = lazy(() => import("@/ee/pages/page"));'
expect 1 "blocks a require" src/e.js 'const x = require("../../ee/x");'
expect 1 "blocks a re-export" src/f.ts 'export * from "@docmost/ee";'
expect 1 "blocks the from line of a multi-line import" src/g.ts '} from "@/ee/features";'
expect 0 "passes an import that only contains ee in a name" src/h.ts 'import { fee } from "@/lib/fee"; import y from "./employee/ee-like";'
expect 0 "passes an unrelated change" src/i.ts 'export const answer = 42;'
expect 0 "ignores ee imports in non-source files" docs/j.md 'import x from "@/ee/x";'

run=$((run + 1))
git checkout -q -B "case-$run" main
printf '// touched\n' >>src/legacy.tsx
git commit -q -am "case $run"
if "$script" main >"$tmp/out" 2>&1; then echo "ok   passes a legacy ee import the branch did not add"; else echo "FAIL passes a legacy ee import the branch did not add"; failed=$((failed + 1)); fi

echo "$run run, $failed failed"
[ "$failed" -eq 0 ]
