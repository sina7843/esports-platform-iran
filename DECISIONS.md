# Decision log

| ID | Decision | Basis / status |
|---|---|---|
| D-001 | Full ESP-SRS replaces the old Dragon requirements; no feature cuts to fit seven prompts. | Supplied user requirements and maximum seven prompts. |
| D-002 | Retain Vue/TypeScript/Fastify/Mongo/Compose template defaults. | Adapted engineering choice; review existing code before migration. |
| D-003 | Restore mandatory backup/restore and full financial flows. | ESP-SRS overrides old template exclusions. |
| D-004 | Production needs Iranian/self-hosted providers; mocks only for development/test. | BASE/INTG/FIN, replacing template mock-only scope. |
| D-005 | No inherited fixed age, tournament ceiling, coins or generic wallet. | Absent from ESP-SRS; per-event rules and documented capacity apply. |
| D-006 | Brand/domain, real providers, approved game packages, fees, formulas, retention approval and publisher permissions remain explicit decisions. | ESP-SRS 17.2; never invent approval. |

Append material implementation decisions with date, owner, rationale and effect on requirement IDs. Do not silently weaken scope or acceptance targets.
