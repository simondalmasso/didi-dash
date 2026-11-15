# Didi Dash — agent operating contract

Before changing the ledger, Worker, extractor or dashboard, read this file and `docs/DATA-STATUS.md`.

## Evidence discipline

- Separate production KV, local worktree, A22 evidence and historical chat claims.
- Prefer a fresh `GET /api/export` with cache-busting over old exports or remembered counts.
- Do not report a zero count from a missing/unsynced source as proof that no activity occurred.
- Do not call a day complete if the export is truncated, trips are missing actual kilometres, or durations are missing.
- Keep discrepancies visible. Never infer missing amounts, dates, kilometres, fuel litres, station names or odometer readings.

## Privacy and ledger contract

- Never persist or send passenger names, phone numbers, pickup/drop-off addresses, coordinates, or raw OCR rows.
- The accepted trip detail fields are `service_type`, `duration_seconds`, `fare_breakdown` (distance, time, wait, dynamic base, differential price, tariff reimbursement), `fare_total_ars`, `adjusted_from_ars`, `earnings_adjusted` and `detail_verified`.
- Fare component keys are a strict whitelist. Unknown nested fields must be discarded.
- Existing fare values must not be overwritten by conflicting detail. Classify conflicts as ambiguous.
- A fuel record requires a valid date. Keep the existing three undated ARS 30,000 records undated unless source evidence identifies them.
- Rewards, fuel, work sessions and wallet withdrawals remain separate ledger collections. Withdrawal principal is a cash transfer, not an expense; only an observed withdrawal fee may reduce recorded cash.
- Trip gaps are not “waiting time” or connected time unless a recorded work session proves the interval.

## API and write path

- Public reads: `GET /api/trips`, `/api/rewards`, `/api/fuel`, `/api/sessions`, `/api/withdrawals`, `/api/export`, `/api/health`.
- The only write path is authenticated `POST /api/ingest` with `Authorization: Bearer INGEST_TOKEN`.
- Use the deployed `?dry=1` preview first. It must normalize and classify exactly as commit does and must not write KV.
- Commit only after reviewing the preview counts, by-day classifications and ambiguities.
- Never send a raw import file directly from browser code to the Worker. Browser writes go through the DPAPI-protected Windows Companion on `127.0.0.1:43197`.
- The Companion allows only the fixed production dashboard Origin, expected Host and fixed Worker destination. Never add a generic URL-forwarding or shell-command route.
- Never print or place `INGEST_TOKEN` in chat, browser storage, logs, committed files or screenshots.

## Development and release

- Preserve all pre-existing worktree changes. Never run `git reset --hard`, `git clean`, or destructive checkout commands on the active worktree.
- Run `npm test`, syntax checks for modified modules, and `git diff --check` before claiming completion.
- Do not weaken tests to make the suite green.
- Deployment, merge, repository writes and production ledger writes require explicit user authorization. The 2026-11-15 deployment and 2026-11-14 ledger import were explicitly authorized in this conversation.
- For each new ingestion source, keep a sanitized evidence summary and update `docs/DATA-STATUS.md`.


## Data Fina rules

- Read docs/DATA-FINA-SCHEMA.md before changing fare component ingestion or presentation.
- Canonical breakdown uses six codes: distancia, tiempo, espera, base_dinamica, diferencial, reembolso_tarifario. The wait component is required in the model because DiDi displays it separately.
- Accept only breakdown.source="actual"; do not store estimated fare components.
- A component is present only when it has a non-null observed amount. Null is not zero.
- The sum must reconcile to the trip total within ARS 2. Otherwise keep the trip amount and mark the breakdown for review; never allocate the unexplained residual to a fabricated category.
- The aggregation in public/data-fina.mjs reads both canonical breakdown and the legacy flat fare_breakdown format without rewriting KV.
- Only reconciled detail contributes to component allocations. Partial and missing detail gross remains unallocated.
- Cash after purchases is trips + rewards - recorded fuel purchases; it is not operating profit. Undated fuel remains unassigned to any date/month.
- Per-passenger-hour divides by sum of trip durations, not online/connected time. No synchronized work sessions means connected hours remain unknown.
- The Etios 8.8 L/100 km figure is a road-test reference, not an observed consumption value for this car.
