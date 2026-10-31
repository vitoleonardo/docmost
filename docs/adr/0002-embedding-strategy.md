# ADR 0002: Embedding strategy

Status: accepted (28.10.2026)

## Context

Search over the wiki needs vectors for German text (spec section 6). Embeddings run in the ai-service process on the MacBook's CPU (M3 Pro, 18 GB); the language model already takes most of the memory (ADR 0001), so the embedder must be small and must not pull a deep-learning framework. The index lives in Postgres with pgvector, in the schema `ai` (spec section 5), and the space filter belongs in our own SQL. Pages hold German text with English product names, so a German or multilingual model is needed.

## Candidates

| Option | Size | Dimensions | Notes |
|---|---|---|---|
| fastembed + `jinaai/jina-embeddings-v2-base-de` | 0.64 GB | 768 | German and English, 8k context, Apache-2.0, ONNX runtime, no torch |
| fastembed + multilingual-MiniLM | small | 384 | Fast; paraphrase training, weaker for retrieval of long passages |
| fastembed + multilingual-mpnet | 1 GB | 768 | Multilingual; larger and slower than jina-de for no German-specific gain |
| fastembed + multilingual-e5-large | 2.2 GB | 1024 | Strong multilingual retrieval; too large to keep next to an 8B model |
| sentence-transformers | about 2 GB with torch | model-dependent | Widest model choice, but pulls torch 2.14 into a service that only embeds |

Index layer: LlamaIndex, or plain heading sections stored in pgvector.

## Decision

fastembed with `jinaai/jina-embeddings-v2-base-de`, configured by `AI_EMBEDDING_MODEL`. The model is cached in `ai-service/.cache/fastembed` (gitignored) and downloaded on the first worker start.

LlamaIndex is not used. Sections come from the Markdown headings in one small module, vectors go to pgvector, and the search is one SQL statement that filters by space ids. A framework would hide exactly the filter that spec section 7 depends on.

Probe on 28.10.2026 (Python 3.14 wheels install; CPU, M3 Pro):
- 30 German sentences embedded in 0.14 s.
- Cosine similarity 0.61 for related sentences, -0.04 for unrelated ones.

## Consequences

- The `embedding` column is an untyped `vector`, filtered by the page's `embedding_model`. A model change is a configuration change followed by the reconcile, not a migration. Pages of another model are left out of the search until re-indexed.
- Sections are cut at headings and hold at most 1,500 characters, so several fit into a local model's context.
- No ANN index in v1. The search is an exact scan, which is fast for the seed's few hundred sections. Add an HNSW index per model dimension when the index outgrows that.
- CI cannot download the model. Tests there use a deterministic hashing embedder; the criteria INDEX-AC13 to INDEX-AC15 and INDEX-AC23 also run locally with the real model (`pytest -m stack`).
- First worker start needs network and 0.64 GB of disk.
- Freshness, measured on 28.10.2026 with the seeded wiki (30 pages, 9 PDFs), the worker and the real model on one machine: a page changed through `POST /api/pages/update` is searchable 0.6 s after its new update time (four runs, each 0.6 s; poll interval 0.5 s). The ceiling in INDEX-AC23 is 60 s. The editor's own save delay is not part of this value.
