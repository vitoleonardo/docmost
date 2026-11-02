# ai-service

Python (FastAPI) service that holds all AI logic for this fork: ingestion and retrieval, extraction, the wiki agent, the inference layer and evals. Docmost talks to it only through the `ai-bridge` server module. See `docs/spec.md` section 5.

What it does, with recordings and an architecture diagram: [root README](../README.md#ai-knowledge-assistant-this-fork). How to run and test it: [`docs/runbook.md`](../docs/runbook.md), sections "AI bridge and ai-service" to "Evals"; to try everything at once, `scripts/run-demo.sh`.
