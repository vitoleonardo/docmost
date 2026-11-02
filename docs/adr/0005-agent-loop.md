# ADR 0005: Agent loop

Status: accepted (29.10.2026)

## Context

M8 runs an agent that searches pages, reads them and proposes changes. Spec section 5 allows LangGraph only if its interrupt and resume is the simplest way to implement confirmed writes. Spec section 6 still requires one OpenAI-compatible API for every inference mode. ADR 0004 left the model registry to the first task that needs tool calling.

## Decision

The agent is a plain loop in `ai-service` over the OpenAI-compatible tools API on the existing `httpx` client. No LangGraph, no Pydantic AI, no new dependency.

- Confirmation happens outside the run. The wiki applies a stored proposal from the user's session, and the run never waits for the user. There is nothing to interrupt or resume, so LangGraph's main feature has no use here.
- `ChatModel.complete_tools` posts to `/chat/completions` with `tools`, `stream` false, `temperature` 0 and `reasoning_effort` "none", and returns the text, the tool calls (arguments parsed to an object, or kept as the raw string when they are not a JSON object) and `usage.prompt_tokens` and `usage.completion_tokens`.
- Each model call ends within its deadline in total, not per read, or when the run's cancel event is set. Transport errors, HTTP errors, a late answer and malformed bodies become `ModelUnavailable`; a cancel becomes `ModelCallCancelled`.

## Consequences

- The loop enforces the limits itself: 20 tool calls, 10 minutes, 200,000 tokens, a cut-off input detected from `prompt_tokens`, and 120 s per model call.
- One model call runs at a time, which suits a single local model.
- A cancel or deadline shuts down the call's socket, so the model server sees the client leave and stops generating, and the background thread ends at once. Each call opens its own connection (`Connection: close`) so that its socket is known from the connect trace; a connection that opens after the abort is shut down as soon as it exists.
- The M10 evals measure task success, because the loop cannot make a model choose the right tool.
