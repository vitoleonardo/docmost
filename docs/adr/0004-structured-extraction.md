# ADR 0004: Structured extraction

Status: accepted (29.10.2026)

## Context

M7 extracts five contract fields from a PDF and needs the model's answer as JSON that matches a schema. ADR 0003 kept plain `httpx` for streaming text and said Pydantic AI is reconsidered in M7. Spec section 6 still requires one OpenAI-compatible API for every inference mode.

## Decision

Structured output goes through the OpenAI-compatible `response_format` with a `json_schema` on the existing `httpx` client. No Pydantic AI and no new dependency. This amends ADR 0003's note that Pydantic AI is reconsidered in M7.

- Request: `ChatModel.complete_json` posts to `/chat/completions` with `stream` false, `temperature` 0, `reasoning_effort` "none" and `response_format` `{"type": "json_schema", "json_schema": {"name": "extraction", "schema": ...}}`.
- Measured on 29.10.2026 with Ollama 0.40.11 and qwen3:8b: the answer conforms to the schema; a 2-page seed contract takes 16 to 20 s.
- The call has an overall limit of 180 s. Every transport error, timeout, non-2xx status, non-JSON body and missing or non-string `choices[0].message.content` becomes one `ModelUnavailable` with a short cause that holds no model content.
- Ollama's OpenAI endpoint ignores a per-request context size: `options.num_ctx` had no effect, and the prompt was cut to 2,050 tokens at the default context of 4,096. The context is therefore set on the runtime (`OLLAMA_CONTEXT_LENGTH=16384`).
- The extraction detects a cut-off input from `usage.prompt_tokens`, which `complete_json` returns next to the text, and reports it as `context_too_small`.

## Consequences

- No new dependency; one more request shape on a client that is still small and tested with `httpx.MockTransport`.
- The runtime setting is a human step in the runbook; a runtime with a smaller context fails visibly instead of answering from a truncated contract.
- A provider that ignores `response_format` produces text the extraction rejects as invalid; the user sees the model-unavailable message.
- The model registry and capability matrix still wait for the first task that needs another capability (tool calling in M8).
