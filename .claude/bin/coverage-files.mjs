// Coverage for .claude/bin/baseline, read from coverage/coverage-summary.json (Istanbul json-summary).
// Prints "<file> TAB <covered lines> TAB <total lines>" per file, or with --total the overall line percentage.
// Usage: node .claude/bin/coverage-files.mjs [--total]
import { readFileSync } from "node:fs";

const summary = JSON.parse(
  readFileSync(
    process.env.COVERAGE_SUMMARY ?? "coverage/coverage-summary.json",
    "utf8",
  ),
);

if (process.argv.includes("--total")) {
  console.log(summary.total.lines.pct);
} else {
  for (const [file, data] of Object.entries(summary)) {
    if (file !== "total") {
      console.log(`${file}\t${data.lines.covered}\t${data.lines.total}`);
    }
  }
}
