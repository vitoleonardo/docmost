---
name: write-tests
description: Add or improve tests for a file, an acceptance criterion, or the current diff. Runs in the test-writer agent, which can only edit test files.
argument-hint: [file path | criterion ID | empty for the current diff]
context: fork
agent: test-writer
background: false
---

Write tests for: $ARGUMENTS

If that is empty, test the current change: run `git status --porcelain` and `git diff HEAD`, and cover the changed source files.

Follow your agent instructions: find the matching spec and criteria, follow the existing test conventions, cover the edge cases, run `.claude/bin/check test-related` on the new tests, and return the report in your agent's format. Say clearly which tests are expected red, which pass, and which passed without ever failing.
