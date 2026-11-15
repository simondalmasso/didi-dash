# Didi Dash Import & Audit Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, repeatable import path for structured trip JSON, a non-writing server preview, idempotent work-session synchronization, and honest per-day ledger coverage states.

**Architecture:** The Worker remains the authority for normalization, deduplication, preview, and commit. A small Node companion bound only to `127.0.0.1` retrieves an INGEST_TOKEN protected for the current Windows user with DPAPI, and exposes only health, preview, and commit operations to the exact production dashboard origin. The public dashboard initiates loopback access only after an explicit user click, using Chrome Local Network Access and standard CORS; the browser never receives the Bearer token.

**Tech Stack:** Cloudflare Worker + KV, vanilla HTML/JavaScript, Node.js 24 built-ins, PowerShell DPAPI, Node `node:test`, Chrome Local Network Access.

## Global Constraints

- Public GET routes and the public JSON export remain publicly readable. No login or read authentication is introduced.
- `POST /api/ingest` remains the only write route and always requires `Authorization: Bearer <INGEST_TOKEN>`.
- The dashboard never stores, requests, receives, or transmits the Bearer token. The Windows companion alone holds it in process memory and loads it from a DPAPI-protected per-user credential file.
- The local companion listens exclusively on IPv4 loopback, validates the exact production Origin and Host, allows only fixed routes, rejects non-loopback clients, and never accepts a client-supplied destination URL or shell command.
- The browser initiates its first loopback request only from a user gesture. It declares `targetAddressSpace: "loopback"`, handles denied/unsupported permissions explicitly, and uses ordinary CORS. Do not add deprecated PNA preflight headers.
- Preview and commit are separate requests. `?dry=1` must authenticate, normalize and classify exactly as commit does, and must not write KV.
- A session's natural idempotency key is `date + platform + connected_start + connected_end`; odometer readings are enrichment, not identity. Matching sessions keep their original ID. Missing odometer data may be enriched; conflicting non-null readings are ambiguous and never overwritten.
- Local browser sessions are a separate, optional category in the preview and are excluded unless the user selects them.
- The preview displays counts only, never raw passenger or location fields. The browser sends collection-specific whitelists; the Worker retains its own independent normalizers and whitelists.
- Preserve Node's built-in test runner and the frozen stack. Add no frontend framework and no runtime npm dependency.
- Raw DiDi source parsing remains separate from the dashboard importer. The 2026-11-14 A22 history was acquired through ADB and local RapidOCR with per-trip detail inspection; the TIRON v2 ZIP link still returned the older v1 package and is not represented as integrated. The importer consumes the documented structured JSON contract and does not claim to parse an unknown raw DiDi export.
- Deployment, repository publication and production KV writes require explicit user authorization. The user explicitly authorized repository update, production deployment and the 2026-11-14 ledger import on 2026-11-15. No secret rotation was performed.

---

### Task 1: Worker dry-run contract and idempotent session merge

**Files:**
- Modify: `src/index.js`
- Modify: `src/domain.mjs`
- Test: `test/worker.test.mjs`
- Test: `test/domain.test.mjs`

**Interfaces:**
- Consumes: authenticated `POST /api/ingest` with `trips`, `rewards`, `fuel`, and `sessions` arrays.
- Produces: `POST /api/ingest?dry=1` returning HTTP 200 with `dry_run: true`, per-collection counts, and per-day counts; ordinary commit continues returning HTTP 201.
- Produces: session counts `received`, `inserted`, `updated`, `duplicates`, `ambiguous`, using natural identity independent of odometer values.

- [ ] **Step 1: Add focused failing tests**

Add tests asserting:
1. An authenticated `?dry=1` preview returns HTTP 200 and `dry_run: true`, classifies a new trip, duplicate, detail enrichment, and ambiguous match, and leaves KV byte-for-byte unchanged with zero `put` calls.
2. A dry-run without a token returns HTTP 401 and does not write.
3. The same payload sent without `dry=1` commits with HTTP 201 and the same classification counts observed in preview, subject to a fresh ledger read.
4. A session with the same date/platform/start/end but a different supplied ID is not inserted twice.
5. A session without odometer data is enriched by a later matching session with both odometer readings; its existing ID is retained.
6. Matching sessions with conflicting non-null odometer readings are classified ambiguous and not overwritten.
7. Preview includes daily counts for trips and sessions and does not return raw records or arbitrary input fields.

- [ ] **Step 2: Verify the expected failures**

Run: `node --test test/worker.test.mjs test/domain.test.mjs`

Expected: new assertions fail because `dry=1` currently writes, sessions are deduplicated only by supplied ID, and no per-day preview is returned. Existing tests should remain otherwise green.

- [ ] **Step 3: Implement minimum behavior**

Refactor ingest into one shared preparation path that reads the ledger, normalizes and classifies all four collections, and returns a candidate ledger plus a count-only receipt. The dry-run path returns that receipt without calling `writeLedger`; the commit path writes the candidate ledger and returns HTTP 201. Add day buckets without exposing normalized row payloads. Add `sameWorkSessionIdentity` and a merge routine that only fills absent odometer fields; never overwrite conflicting recorded readings. Make generated session IDs independent of odometer readings.

- [ ] **Step 4: Verify focused pass**

Run: `node --test test/worker.test.mjs test/domain.test.mjs`

Expected: every new dry-run, no-write, session-idempotency, enrichment, conflict, and per-day assertion passes.

- [ ] **Step 5: Run integration tests**

Run: `npm test`

Expected: all existing dashboard, domain, finance, and Worker tests pass without weakening prior assertions.

- [ ] **Step 6: Commit**

```bash
git add src/index.js src/domain.mjs test/worker.test.mjs test/domain.test.mjs
git commit -m "feat: add safe ingest preview and session idempotency"
```

---

### Task 2: Windows loopback companion with protected credential

**Files:**
- Create: `companion/server.mjs`
- Create: `scripts/setup-companion-credential.ps1`
- Modify: `package.json`
- Test: `test/companion.test.mjs`

**Interfaces:**
- Consumes: fixed local routes `GET /health`, `POST /preview`, and `POST /commit`, only from the exact production dashboard Origin and expected loopback Host.
- Produces: fixed HTTPS requests to `https://didi-dash.simondalmasso44.workers.dev/api/ingest?dry=1` or `/api/ingest`; the Bearer token is injected by the companion and never returned.
- Produces: one short-lived in-memory pairing nonce per companion process; preview and commit require it.
- Produces: `npm run companion:setup` to store the token once with Windows DPAPI CurrentUser protection, and `npm run companion:start` to start the loopback process.

- [ ] **Step 1: Add focused failing tests**

Use an ephemeral loopback port and an injected fake Worker fetch. Assert:
1. Allowed Origin + expected Host can retrieve health and a pairing nonce, but no token.
2. Wrong Origin, wrong Host, a non-loopback request, invalid nonce, and unknown route are rejected.
3. `OPTIONS` allows only the exact dashboard origin, the required methods, and the required headers.
4. Preview always calls the fixed Worker URL with `?dry=1`; commit always calls the fixed Worker URL without it.
5. The Bearer header is added only inside the companion-to-Worker request and never appears in any local response or log.
6. Oversized and malformed JSON requests are rejected before contacting the Worker.
7. No request field can choose a URL, route, host, port, or command.

- [ ] **Step 2: Verify the expected failures**

Run: `node --test test/companion.test.mjs`

Expected: the test file fails because the companion module and its route contract do not yet exist.

- [ ] **Step 3: Implement minimum behavior**

Create a Node HTTP server bound to `127.0.0.1` only, using a fixed port. Validate remote address, exact Host, exact Origin, route, method, content type, body size, and a timing-safe nonce before forwarding. Implement only health/preview/commit. Read the DPAPI-protected token at startup by invoking Windows PowerShell with a fixed script and the credential-file path passed as an environment value; never log stdout, token material, request bodies, or authorization headers. The setup script accepts the token as a hidden SecureString prompt and writes only `ConvertFrom-SecureString` output under `%LOCALAPPDATA%\DidiDash\`. Fail closed if the credential is missing or cannot be decrypted.

- [ ] **Step 4: Verify focused pass**

Run: `node --test test/companion.test.mjs`

Expected: all origin, host, nonce, route, fixed-destination, no-secret-response, and request-size tests pass.

- [ ] **Step 5: Run integration tests and syntax checks**

Run: `node --check companion/server.mjs && npm test`

Expected: the companion parses and all project tests pass.

- [ ] **Step 6: Commit**

```bash
git add companion/server.mjs scripts/setup-companion-credential.ps1 package.json test/companion.test.mjs
git commit -m "feat: add protected Windows ingest companion"
```

---

### Task 3: Dashboard import flow and separately optional local sessions

**Files:**
- Create: `public/importer.mjs`
- Modify: `public/index.html`
- Create: `test/importer.test.mjs`
- Modify: `test/dashboard-entry-controls.test.mjs`

**Interfaces:**
- Consumes: a selected JSON file with optional arrays `trips`, `rewards`, `fuel`, and `sessions`; optional `truncated` flags; and the current browser's `localSettings.vehicleSessions`.
- Produces: whitelisted JSON sent to the companion; count-only preview by collection/day; explicit commit button; post-commit receipt and ledger refresh.
- Produces: local-session checkbox unchecked by default and labelled separately from trips.

- [ ] **Step 1: Add focused failing tests**

Assert that:
1. The importer accepts the documented object/array contract and rejects malformed JSON, non-object input, non-array collections, and any backup with a true truncation flag.
2. Trip, reward, fuel, and session records are reduced to their explicit allowlists; passenger names, addresses, phone numbers, and unknown properties are not sent.
3. Local sessions are omitted by default and included only when the separate checkbox is enabled.
4. The UI exposes file selection, companion connection, preview, local-session opt-in, separate confirmation, and a visible receipt; it never includes an INGEST_TOKEN input or writes one to localStorage.
5. The UI does not render raw records or raw error bodies in the preview.

- [ ] **Step 2: Verify the expected failures**

Run: `node --test test/importer.test.mjs test/dashboard-entry-controls.test.mjs`

Expected: new importer-contract and UI assertions fail because no import UI or importer module exists.

- [ ] **Step 3: Implement minimum behavior**

Add a home-only import panel and modal. Connect to the companion only after a user click, using `targetAddressSpace: "loopback"`; check `loopback-network` permission where supported and handle unsupported, prompt, and denied states without page-load probes. Add the exact loopback URL to the page CSP `connect-src`. Pair in memory, send file JSON and optionally selected local sessions to preview, render only counts, and require a distinct Confirm Import click. Commit reprocesses the same payload against the latest ledger; show the real commit receipt even if counts changed from preview. Clear the file payload and nonce when the modal closes. Keep the dashboard's public GET behavior unchanged.

- [ ] **Step 4: Verify focused pass**

Run: `node --test test/importer.test.mjs test/dashboard-entry-controls.test.mjs`

Expected: importer validation, strict whitelisting, default opt-out, and UI contract tests pass.

- [ ] **Step 5: Run integration tests**

Run: `npm test`

Expected: all project tests pass.

- [ ] **Step 6: Commit**

```bash
git add public/importer.mjs public/index.html test/importer.test.mjs test/dashboard-entry-controls.test.mjs
git commit -m "feat: add dashboard import preview and confirmation"
```

---

### Task 4: Per-day ledger audit and honest status badges

**Files:**
- Create: `public/audit.mjs`
- Modify: `public/index.html`
- Create: `test/audit.test.mjs`

**Interfaces:**
- Consumes: complete `/api/export` arrays and the four `truncated` flags.
- Produces: per-day counts for trips, actual kilometres, positive duration, and source provenance; global ledger truncation and session-sync states.
- Produces: only evidence-supported labels: `Completo en ledger`, `Parcial en ledger`, `Sin turnos sincronizados`, and a comparison state that cannot say `Comparado contra A22` without an actual verified A22 source comparison.

- [ ] **Step 1: Add focused failing tests**

Assert:
1. A day is `Completo en ledger` only when all its stored trips have actual km and positive duration.
2. A day is `Parcial en ledger` when any trip has unknown/estimated km or missing/non-positive duration.
3. Any true export truncation flag prevents a complete-ledger claim.
4. Zero Worker sessions produces `Sin turnos sincronizados`, never a statement that zero shifts were worked.
5. The audit reports provenance counts and does not infer missing trips, zones, passenger data, or A22 completeness.

- [ ] **Step 2: Verify the expected failures**

Run: `node --test test/audit.test.mjs`

Expected: test fails because the audit module and visible coverage section do not exist.

- [ ] **Step 3: Implement minimum behavior**

Build a pure audit module and a dashboard coverage section populated from a complete public export. If export is truncated, display the audit as incomplete and suppress complete-day labels. Show session synchronization independently. Reserve `Comparado contra A22` for a later source reconciliation; current state stays not compared. Do not persist or infer location data. Include an explicit future checklist item to verify whether the A22 source export contains origin/destination zones before any privacy-reviewed schema extension.

- [ ] **Step 4: Verify focused pass**

Run: `node --test test/audit.test.mjs`

Expected: all coverage, truncation, provenance, and session-state assertions pass.

- [ ] **Step 5: Run integration tests**

Run: `npm test`

Expected: all project tests pass.

- [ ] **Step 6: Commit**

```bash
git add public/audit.mjs public/index.html test/audit.test.mjs
git commit -m "feat: show per-day ledger coverage status"
```

---

### Task 5: Agent contract, data snapshot, and operator instructions

**Files:**
- Create: `AGENTS.md instructs agents to read docs/DATA-STATUS.md, preserves public-read/private-write behavior, lists exact routes, warns that absence is not zero, protects passenger/location fields, and mandates tests before claims. docs/DATA-STATUS.md records the fresh 2026-11-15 export after importing the 2026-11-14 A22 source: 18 trips, ARS 106,400, 96.0 actual km, 14,135 exact trip seconds, 17/18 reconciled fare breakdowns, one partial fare detail at 22:25 with ARS 900 unexplained, one dated ARS 30,000 fuel purchase, three older undated ARS 30,000 purchases preserved, zero synced sessions and no truncation. The README documents the extended trip-detail schema, timeline rules and Companion workflow.

- [ ] **Step 4: Verify documentation**

Run: `node --test test/documentation-contract.test.mjs`

Expected: every required invariant and dated data point is found in the docs.

- [ ] **Step 5: Run final verification**

Run: `npm test && git diff --check && node --check src/index.js && node --check src/domain.mjs && node --check companion/server.mjs && node --check public/importer.mjs && node --check public/audit.mjs`

Expected: all tests pass, no whitespace errors, and every modified JavaScript entry point parses.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md docs/DATA-STATUS.md README.md test/documentation-contract.test.mjs
git commit -m "docs: define import contract and ledger data status"
```

## Unresolved external decisions

- **Raw DiDi JSON production:** v1 consumes the documented structured JSON contract. The creation/conversion of that file from any raw DiDi source remains manual and is not represented as automated.
- **A22 comparison and location fields:** do not mark any date `Comparado contra A22` or persist zones until a complete A22 extraction is available and its origin/destination fields are verified and reviewed under an explicit privacy rule.
- **Production release:** deployed 2026-11-15 as Worker version 1043c288-d1c9-4704-aa6d-fa516f54beda; the authorized ingest receipt added 18 rides and one dated fuel record. Repository commit/push is tracked separately from this plan.


## Data Fina implementation closure ? 2026-11-15

- [x] Added canonical six-component fare breakdown with the explicit wait component.
- [x] Preserved legacy flat fare breakdown reads without a KV rewrite.
- [x] Added amount reconciliation tolerance (ARS 2), review state for partial sums, unknown-code grouping, and non-null component semantics.
- [x] Added actual-only allocation, unallocated gross, per-day/per-hour activity, a locally editable daily goal, and the responsive dashboard section.
- [x] Added canonical import whitelist, trip-enrichment merge and conflict protection.
- [x] Recorded the current live snapshot and the older prototype's obsolete/synthetic-data warning in docs.
- [x] Full verification: 131/131 tests, module syntax checks, inline dashboard syntax and git diff --check.
- [x] Authenticated Wrangler dry-run and production deploy completed; Worker version: 29beb7cb-8d42-4c34-b44c-5e65d0fe4943.
- [x] Post-deploy checks: dashboard HTML, data-fina module, timeline module and fresh public export returned successfully; export remains 209 trips and no truncation.
- [ ] Publish the implementation branch to GitHub and verify the remote commit.

The data-fina component allocation is evidence-only: verified ARS 100,000 from 17 actual 14/11 breakdowns, one partial ride with ARS 900 unexplained, and 191 trips without component breakdown. Null values remain absent, not zero.
