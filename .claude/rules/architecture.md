# Architecture

- Where code goes, and searching before writing a second one: `structure.md`.
- Do not add a new architectural pattern (state library, ORM, DI container, API style) without asking.
- Entry points stay thin. A route handler, controller, server action, job or CLI command parses and validates input, calls a function that holds the logic, and maps the result. It contains no business rules.
- Business logic does not import framework request or response types, so it can be tested without a server.
- Data access lives in one layer. UI components and controllers do not query the database directly.
- Read environment variables in one config module that validates them at startup. Nowhere else reads the environment directly.
- Do not change a public contract (exported signatures used elsewhere, HTTP routes, response shapes, database schema, event names) unless the spec asks for it. When it does, list every caller in the plan.
- When a change spans a frontend and a backend, write the contract (route, method, request, response, errors, required role) into the plan before either side is built. Both sides use one shared type or schema for it.
- Keep diffs small and focused: one concern per change. If a change grows past 400 changed lines (excluding lockfiles and generated files), stop and propose how to split it.
- Do not refactor code the task does not touch. Note the opportunity in the PR description instead.
