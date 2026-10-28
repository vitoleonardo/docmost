# ADR 0003: Answer generation

Status: accepted (28.10.2026)

## Context

Spec section 5 names Pydantic AI as the default for answer generation. Ask streams plain text with citation markers; it needs no tools and no structured output. Spec section 6 requires one OpenAI-compatible API for every inference mode (local first, hosted later), so the call is the same whatever serves the model.

## Decision

ai-service calls `/chat/completions` with plain `httpx` streaming and parses the server-sent events itself. No agent framework.

- Request: `stream` true, `temperature` 0, `reasoning_effort` "none" (keeps qwen3's thinking out of the stream on Ollama; verified 28.10.2026).
- Timeouts: connect 10 s, read 60 s. The model must start within 60 s; the same limit also catches a stall mid-answer.
- Every transport error, timeout, non-2xx status and malformed stream becomes one `ModelUnavailable`. Text already yielded stays with the caller.
- Closing the generator closes the HTTP response, so a stopped answer stops generation.
- The model registry and capability matrix (spec section 6) wait for the first task that needs another capability: structured output in M7, tool calling in M8. Pydantic AI is reconsidered there.

## Consequences

- No new dependency; the client is about 60 lines and tested with `httpx.MockTransport`.
- Switching inference mode changes `AI_LLM_BASE_URL` and `AI_LLM_MODEL`, not code.
- Retries, token counting and provider quirks are not handled. M7 and M8 may replace the client; the `stream(messages)` interface stays small enough to move.
