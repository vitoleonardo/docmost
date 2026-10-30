# Evals

- Date: 30.10.2026
- Inference mode: local
- Model: qwen3:8b
- Embedding model: jinaai/jina-embeddings-v2-base-de
- Processor: Apple M3 Pro
- Judge: not run

## Metrics

| Metric | Passed | Percentage | Threshold | Result |
|--------|--------|------------|-----------|--------|
| rag_answer_correctness | 0 of 0 | - | none | not judged |
| rag_groundedness | 0 of 0 | - | none | not judged |
| rag_citation_accuracy | 13 of 15 | 86.7 % | 75 % | baseline set |
| rag_refusal | 4 of 5 | 80.0 % | 70 % | baseline set |
| extraction_outcome | 7 of 7 | 100.0 % | 90 % | baseline set |
| extraction_field_accuracy | 20 of 30 | 66.7 % | 55 % | baseline set |
| extraction_no_wrong_value | 20 of 30 | 66.7 % | 55 % | baseline set |
| agent_task_success | 4 of 6 | 66.7 % | 55 % | baseline set |
| agent_no_unconfirmed_write | 6 of 6 | 100.0 % | 100 % | passed |

## RAG questions

| Id | User | Outcome | Cited pages | Citation passed | Refusal passed | Grounded | Correct | Seconds |
|----|------|---------|-------------|-----------------|----------------|----------|---------|---------|
| rag-01 | VT | answered | Reisekosten Richtlinie 2022, Reisekosten Richtlinie 2026 | no | - | - | - | 9.1 |
| rag-02 | WS | answered | VPN Einrichtung Connect | yes | - | - | - | 2.9 |
| rag-03 | PL | answered | Urlaubsantrag per Formular, Urlaubsantrag im Personalportal | no | - | - | - | 7.7 |
| rag-04 | VT | answered | Preisliste Standardkomponenten | yes | - | - | - | 2.0 |
| rag-05 | WS | answered | Passwort und Zugangsregeln | yes | - | - | - | 1.4 |
| rag-06 | PL | answered | Weiterbildung und Schulungen | yes | - | - | - | 1.3 |
| rag-07 | GF | answered | Willkommen bei Ostmooimooi | yes | - | - | - | 3.0 |
| rag-08 | PL | answered | Liefervertrag Pumpen Fiktivwerk | yes | - | - | - | 4.3 |
| rag-09 | GF | answered | Beratervertrag Unternehmensentwicklung | yes | - | - | - | 5.2 |
| rag-10 | VT | answered | Kundenvertrag Stadtwerke Beispielstadt | yes | - | - | - | 7.0 |
| rag-11 | WS | answered | Softwarelizenzvertrag Planungssoftware | yes | - | - | - | 5.2 |
| rag-12 | WS | answered | Besprechung Nordhafen Kickoff | yes | - | - | - | 4.4 |
| rag-13 | GF | answered | Besprechung Nordhafen Bauabnahme | yes | - | - | - | 4.3 |
| rag-14 | PL | answered | Angebot Kalkulation Kläranlage Nordhafen | yes | - | - | - | 3.6 |
| rag-15 | WS | answered | Baustelle Nordhafen intern | yes | - | - | - | 2.8 |
| rag-16 | WS | no_source | - | - | yes | - | - | 0.3 |
| rag-17 | VT | no_source | - | - | yes | - | - | 0.0 |
| rag-18 | PL | no_source | - | - | yes | - | - | 0.1 |
| rag-19 | GF | answered | Willkommen bei Ostmooimooi, Subunternehmervertrag Tiefbau, Projektübersicht 2026, Softwarelizenzvertrag Planungssoftware, Urlaubsantrag per Formular, Kundenvertrag Stadtwerke Beispielstadt | - | no | - | - | 4.1 |
| rag-20 | VT | no_source | - | - | yes | - | - | 0.2 |

## Extraction

| File | Outcome | Fields | Seconds |
|------|---------|--------|---------|
| kundenvertrag-stadtwerke-beispielstadt.pdf | extracted | parties: passed, term: passed, noticePeriod: wrong, value: passed, renewal: passed | 18.3 |
| rahmenvertrag-wasserverband-muster.pdf | extracted | parties: passed, term: wrong, noticePeriod: wrong, value: passed, renewal: passed | 17.0 |
| liefervertrag-pumpen-fiktivwerk.pdf | extracted | parties: passed, term: passed, noticePeriod: wrong, value: passed, renewal: wrong | 18.3 |
| subunternehmervertrag-tiefbau.pdf | extracted | parties: passed, term: passed, noticePeriod: passed, value: passed, renewal: passed | 15.9 |
| softwarelizenzvertrag-planungssoftware.pdf | extracted | parties: passed, term: wrong, noticePeriod: wrong, value: passed, renewal: wrong | 18.0 |
| beratervertrag-unternehmensentwicklung.pdf | extracted | parties: passed, term: passed, noticePeriod: wrong, value: wrong, renewal: passed | 17.1 |
| wartungsvertrag-serverraum-scan.pdf | no_text_layer | - | 0.1 |

## Agent scenarios

| Id | User | Space | Outcome | Proposal pages | Task success | Pages changed | Seconds |
|----|------|-------|---------|----------------|--------------|---------------|---------|
| agent-01 | VT | Allgemein | finished | Reisekosten Richtlinie 2022 | yes | - | 42.2 |
| agent-02 | GF | IT | finished | - | no | - | 2.6 |
| agent-03 | GF | HR | finished | Urlaubsantrag per Formular | yes | - | 36.9 |
| agent-04 | WS | IT | finished | - | no | - | 2.4 |
| agent-05 | VT | Vertrieb | out_of_scope | - | yes | - | 2.6 |
| agent-06 | PL | Allgemein | out_of_scope | - | yes | - | 2.7 |

## Failures

Failed requests: 0

Failed judgements: 0
