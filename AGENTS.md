# Didi Dash — agent operating contract

Before changing the ledger, Worker, extractor or dashboard, read this file and `docs/DATA-STATUS.md`.

## Evidence discipline

- Separate production KV, local worktree, A22 evidence and historical chat claims.
- Prefer a fresh `GET /api/export` with cache-busting over old exports or remembered counts.
- Do not report a zero count from a missing/unsynced source as proof that no activity occurred.
- Do not call a day complete if the export is truncated, trips are missing actual kilometres, or durations are missing.
- Keep discrepancies visible. Never infer missing amounts, dates, kilometres, fuel litres, station names or odometer readings. Unknown trip distance is canonical `km: null` with `km_source: "unknown"`; never persist unknown as numeric zero.

## Privacy and ledger contract

- Never persist or send passenger names, phone numbers, pickup/drop-off addresses, coordinates, or raw OCR rows.
- The accepted trip detail fields are `service_type`, `duration_seconds`, `fare_breakdown` (distance, time, wait, dynamic base, differential price, tariff reimbursement), `fare_total_ars`, `adjusted_from_ars`, `earnings_adjusted` and `detail_verified`.
- Fare component keys are a strict whitelist. Unknown nested fields must be discarded.
- Existing fare values must not be overwritten by conflicting detail. Classify conflicts as ambiguous.
- A fuel record may remain undated only when it has an explicit stable ID. Never assign a date by inference. Keep the existing three undated ARS 30,000 records undated unless source evidence identifies them. Optional fuel `time` is stored only when observed or explicitly user-reported, in `HH:mm`; never infer it.
- Rewards, fuel, work sessions and wallet withdrawals remain separate ledger collections. Withdrawal principal is a cash transfer, not an expense; only an observed withdrawal fee may reduce recorded cash.
- Trip gaps are not “waiting time” or connected time unless a recorded work session proves the interval.

## API and write path

- Public reads: `GET /api/trips`, `/api/rewards`, `/api/fuel`, `/api/sessions`, `/api/withdrawals`, `/api/export`, `/api/health`.
- The only write path is authenticated `POST /api/ingest` with `Authorization: Bearer INGEST_TOKEN`.
- Use the deployed `?dry=1` preview first. It must normalize and classify exactly as commit does and must not write KV.
- Commit only after reviewing the preview counts, by-day classifications and ambiguities.
- The import dialog accepts a structured JSON file, applies its field whitelist, and sends only the sanitized payload to the same-origin `/api/ingest` endpoint.
- The user enters `INGEST_TOKEN` into a password input. Keep it only in dialog/session memory; clear it when the dialog closes or import finishes. Never put it in localStorage, HTML source, import JSON, logs, screenshots, chat or committed files.
- Preview must call authenticated `POST /api/ingest?dry=1`; commit must call the same endpoint without `dry=1`, only after explicit user confirmation. No local helper process is part of v1.

## Phone extraction (A22)

- The only operational extraction path is TIRÓN in `scripts/tiron/`; the full procedure and its validation gates are in `docs/EXTRACCION-A22.md`. There is no structured exportable source on the current install (verified 2026-11-15: release build blocks `run-as`, `allowBackup=false`, data providers are not exported). Do not re-probe those paths.
- History-list captures enter as `source: didi_history` (date, start, amount, platform). The per-trip detail screen is the only source for kilometres, duration, service type and fare breakdown (`didi_history_detail`).
- Detail screens show pickup/drop-off addresses: crop captures to the numeric zone or discard them immediately after transcription. Never persist frames that contain addresses.
- Raw screenshots and unrestricted OCR are processed in memory only. Before an input frame is OCR-processed, its on-disk copy is replaced with a solid privacy mask; only then is the in-memory source OCR-processed and a selectively restored, masked frame written.
- Persist only allowlisted OCR boxes (date, time, modality, amount, numeric km/min) and normalized trip fields. Raw OCR text and unknown rows must never enter OCR JSON, ledger.csv, candidatos.csv or filas_sin_parsear.csv. Existing OCR JSON is always regenerated, never trusted as a cache.
- TIRÓN sessions (frames/ocr/out directories) are transient evidence and are never committed to the repository.

## Development and release

- Preserve all pre-existing worktree changes. Never run `git reset --hard`, `git clean`, or destructive checkout commands on the active worktree.
- Run `npm test`, syntax checks for modified modules, and `git diff --check` before claiming completion.
- Do not weaken tests to make the suite green.
- Deployment, merge, repository writes and production ledger writes require explicit user authorization. The 2026-11-15 deployment and 2026-11-14 ledger import were explicitly authorized in this conversation.
- For each new ingestion source, keep a sanitized evidence summary and update `docs/DATA-STATUS.md`.
- After every authorized production ingest session, run `npm run backup` and keep the timestamped export outside the repository; the recovery procedure is `docs/BACKUP-RESTORE.md`.


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

- Withdrawal principal is a transfer, not an expense. `fee_ars: null` or `reconciled: false` means fee evidence is unknown. Only a numeric `fee_ars` with `reconciled: true` contributes to observed fee spend; an explicit reconciled zero is distinct from missing evidence. If any selected withdrawal is unreconciled, the full-period fee total remains unknown.
- Operational time-band rate uses trip start hour and the same duration-known trips for both numerator and denominator: sum of their driver amounts / sum of their reported duration. Publish coverage (`duration-known trips / all trips in band`) and sample counts. Require at least 5 trips, 2 dates and 90% duration coverage to rank a band; otherwise display it as not ranked. A high rate with low coverage stays visible but is never ranked.
- A $/reported-passenger-hour metric is not $/connected-hour. With zero synchronized work sessions, connected hours remain unknown. Inter-trip gaps are unclassified; they are not wait, rest or online time.
- Service type or modality values are never inferred from fare or route data. Unclassified records remain in the denominator and have an explicit coverage count.
