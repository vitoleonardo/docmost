# ADR 0001: Local model

Status: accepted (28.10.2026)

## Context

Local inference is the only mode in Must (spec section 6). The model runs in Ollama on the MacBook Pro (M3 Pro, 18 GB). Docker Desktop's VM takes 4 GB, so about 14 GB remain for the model and macOS: about 8B parameters at 4-bit (5 to 6 GB). A 14B model fits only with little else running.

The model serves three tasks, which set the criteria:

| Criterion | Task | Why it matters |
|---|---|---|
| German answers from context, with the source, and "no information" when the context lacks it | M5 Ask | Wrong or invented answers are the main risk; the no-source answer must read the same for missing and restricted content |
| Tool calling | M8 Agent | The agent's tools (search, read page, propose update) are its only way to act |
| Structured output against a JSON schema | M7 Extraction | The review UI needs every field typed |
| Speed (tokens per second, latency) | all | Streaming answers in the side panel |

## Candidates

Installed on the MacBook (`ollama list`, 28.10.2026): `qwen3:8b` (5.2 GB), `llama3.1:latest` (8B, 4.9 GB). Not considered: `qwen2.5-coder:7b` (tuned for code), `llama3.2` (3B), `deepseek-r1` (reasoning output, slow for streaming).

Before deciding, check the Ollama library for current models of about 8B with tool support and German, and add them here (spec section 6: verify model names at build time).

## Method

A smoke probe, not the eval: four German tasks, three runs each, temperature 0, `think` off for qwen3. It shows whether a model can do each task at all. The M10 suites produce the numbers that go into `reports/eval-local.md`.

Prompts use fictional data only. The probe is three runs on four short prompts, so it rules a model out but does not prove it good enough.

## Results

Probe on 28.10.2026, Ollama 0.40.11, 3 runs per task. Seconds and tokens per second are averages per call.

| Model | German answer with source | Says "no information" | Tool call | Contract JSON (fields correct) | Contract JSON (ISO date) | tok/s |
|---|---|---|---|---|---|---|
| qwen3:8b | 3/3, 1.5 s | 3/3, 0.5 s | 3/3, 1.5 s | 3/3, 4.2 s | 0/3 | 22 to 26 |
| llama3.1:8b | 0/3, 0.6 s | 3/3, 0.3 s | 3/3, 1.3 s | 3/3, 3.1 s | 0/3 | 26 to 31 |

- llama3.1 answers "30 Urlaubstage pro Kalenderjahr." without the source page, in every run. Ask requires the source, so this is a real failure.
- Both models extract every contract field correctly but write the date as `01.02.2026`. The ISO format was asked for only in the schema's `description`, which Ollama's structured output does not enforce. The probe scored this as a failure; it is a schema and prompt issue, not a model one.
- Both pick `search_pages` with a sensible query.

## Decision

`qwen3:8b`, with `think` off for Ask and Extraction. It is the only candidate that cites its source, and its speed is enough for streaming. Newer models from the Ollama library were not probed; if the M10 evals fall short, they are the first thing to try, on the same probe.

Dates in Extraction are not left to the model: the schema gets a `pattern` for ISO dates, and ai-service normalises German dates (`DD.MM.YYYY`) before validation. M7's plan decides which, with a test for each.

## Consequences

- The model is one entry in the model registry and capability matrix (spec section 6); changing it later is a configuration change plus an eval run.
- The M10 eval report names the model and its version.
