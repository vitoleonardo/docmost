---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mts"
  - "**/*.cts"
---

# TypeScript

- Strict mode. No `any`, `@ts-ignore`, `@ts-expect-error` or `as unknown as` unless a comment on the same line explains why. Prefer `unknown` plus narrowing.
- No `eslint-disable` or `biome-ignore` without a reason in the same comment.
- Handle every promise: `await` it, return it, or mark it deliberately with `void`. No floating promises.
- Validate external data with a schema (Zod or the project's library) and derive the type from the schema instead of writing it twice.
