# Data status — 2026-11-14 DiDi journey enrichment

**Production snapshot verified:** 2026-11-15 04:11:08 UTC
**Worker version deployed at this snapshot:** `1043c288-d1c9-4704-aa6d-fa516f54beda`
**Source device:** Samsung Galaxy A22 SM-A225M, DiDi Conductor, trip history filtered to 14/11/2026
**Evidence method:** ADB screen capture + local RapidOCR 3.10, then per-trip detail inspection. Only sanitized operational fields were persisted.

## Production ledger after the authorized import

Fresh `GET /api/export` returned:

| Collection / metric | Production value |
|---|---:|
| Trips, all dates | 209 |
| Trips dated 2026-11-14 | 18 |
| Gross trip earnings, 2026-11-14 | ARS 106,400 |
| Actual passenger kilometres, 2026-11-14 | 96.0 km |
| Reported trip duration, 2026-11-14 | 14,135 s (235m35s) |
| Fare breakdown reconciled | 17 / 18 |
| Fuel records, all dates | 7 |
| Fuel dated 2026-11-14 | ARS 30,000 |
| Fuel records still undated | 3 / ARS 90,000 |
| Synced work sessions | 0 |
| Truncated collections | None |

The import receipt reported **18 trips inserted + 1 fuel record inserted**, zero updates, duplicates or ambiguities. A fresh export confirms that all 18 trips and the dated fuel purchase persisted.

The fuel entry is exactly what was authorized: date 2026-11-14, total ARS 30,000. Station, litres and odometer remain unknown/null; none were inferred. The three pre-existing undated ARS 30,000 entries were not reassigned or modified.

## Sanitized trip evidence

Every trip in this table was opened in DiDi detail. All 18 list amounts were reconciled with the final detail amount. Durations are exact seconds and kilometres are actual values shown by DiDi.

| Start | Driver amount | Actual km | Duration | Fare detail |
|---|---:|---:|---:|---|
| 17:44 | ARS 6,000 | 6.7 | 14m52s | Reconciled |
| 18:02 | ARS 6,400 | 7.0 | 18m37s | Reconciled; final amount adjusted from ARS 6,600 |
| 18:27 | ARS 9,500 | 13.2 | 20m48s | Reconciled |
| 18:58 | ARS 11,300 | 12.1 | 19m25s | Reconciled |
| 19:19 | ARS 6,900 | 8.3 | 19m40s | Reconciled |
| 19:44 | ARS 3,500 | 3.3 | 9m43s | Reconciled |
| 19:56 | ARS 7,600 | 7.6 | 22m32s | Reconciled; includes ARS 200 wait fare |
| 20:33 | ARS 5,300 | 4.8 | 12m30s | Reconciled |
| 20:37 | ARS 3,500 | 2.5 | 8m25s | Reconciled |
| 20:54 | ARS 3,900 | 1.2 | 6m57s | Reconciled; adjusted from ARS 3,600 |
| 21:05 | ARS 8,500 | 5.8 | 18m04s | Reconciled |
| 21:26 | ARS 6,600 | 3.2 | 8m23s | Reconciled; adjusted from ARS 8,500 |
| 21:43 | ARS 4,400 | 2.9 | 7m24s | Reconciled; includes wait fare and tariff reimbursement |
| 21:53 | ARS 5,800 | 4.3 | 13m15s | Reconciled |
| 22:15 | ARS 3,900 | 2.9 | 6m55s | Reconciled |
| 22:25 | ARS 6,400 | 4.8 | 11m55s | **Partial**: visible components total ARS 5,500; ARS 900 remains unexplained |
| 22:52 | ARS 2,100 | 1.4 | 4m31s | Reconciled |
| 23:00 | ARS 4,800 | 4.0 | 11m39s | Reconciled; includes ARS 100 wait fare |

All 18 service types were DiDi Express. The 22:25 trip is stored with `detail_verified=false`, its visible components and the final fare total; the missing ARS 900 is not assigned to a fabricated component.

### Derived operational rates

- Average gross per trip: ARS 5,911.11.
- Gross per actual passenger kilometre: ARS 1,108.33/km.
- Gross per reported trip-time hour: approximately ARS 27,099/hour.

The hourly figure is **per time spent inside reported trips**, not per connected hour. It must not be presented as connected-shift productivity because the production ledger contains zero synced work sessions.

## Timeline interpretation

The dashboard timeline derives approximate trip end times from exact reported durations. It shows the fare components and a reconciliation state per trip. Gaps between trip events remain **unclassified**; they are not labelled as waiting, break time or online/connected time without a recorded session.

No passenger names, phone numbers, addresses, coordinates or raw OCR text were stored in the ledger or this snapshot.

## Known acquisition limitation

The remote ZIP link supplied for TIRÓN still returned the older v1 package during this run, not the claimed v2. The 14/11 capture was therefore completed with the local ADB/RapidOCR path and a sanitized per-trip result. The TIRÓN v2 changes are **not yet verified or integrated into this repository**. Do not treat a synthetic 46/46 OCR test as production evidence for another screen layout.


## Current live ledger snapshot — 2026-11-15

**Export timestamp:** 2026-11-15T04:31:46.695Z (UTC)
**Worker version at snapshot:** 29beb7cb-8d42-4c34-b44c-5e65d0fe4943
**Truncation:** no collection was truncated.

| Metric | Live value |
|---|---:|
| Trips | 209 |
| Trip gross | ARS 800,900 |
| Rewards | ARS 109,300 |
| Fuel purchases recorded | ARS 200,000 |
| Cash after recorded fuel purchases | ARS 710,200 |
| Actual passenger km | 668.2 km |
| Reported trip time | 109,811 seconds (30h30m11s) |
| Gross per reported passenger-travel hour | ARS 26,256/hour |
| Gross per actual passenger km | ARS 1,199/km |
| Trips in prime reference bands (07–09, 17–22) | ARS 695,700 (86.9% of trip gross) |
| Best start hour | 18:00 (ARS 159,800) |
| Active dates with trips | 10 |
| Active dates reaching ARS 80,000 gross | 5 / 10 |
| Synchronized work sessions | 0 |

Cash net is trips + rewards - recorded fuel purchases. The fuel total includes ARS 90,000 from three undated records; those remain unassigned to any day/month. The hourly value divides trip gross by time spent inside reported trips, not connected-shift hours. The prime bands are a display convention, not evidence of an online shift.

### Actual fare allocation observed in the ledger

Only the 17 reconciled detail screens from 2026-11-14 contribute to component totals. Together they sum to ARS 100,000. One further trip (22:25, ARS 6,400) has a visible subtotal of ARS 5,500; ARS 900 remain unexplained and are unallocated. The other 191 trips have no real component breakdown in the ledger.

| Component | Reconciled total | Trips where present |
|---|---:|---:|
| Distance | ARS 39,300 | 17 |
| Time | ARS 28,400 | 17 |
| Dynamic base | ARS 19,200 | 17 |
| Differential price | ARS 12,100 | 10 |
| Waiting | ARS 500 | 4 |
| Tariff reimbursement | ARS 500 | 3 |

Total verified component allocation: **ARS 100,000**. Total gross not assigned to a verified component: **ARS 700,900** (one partial ride at ARS 6,400 plus 191 trips without real component detail). No component amounts were generated for those trips.

The data-fina page calculates these numbers from the live export through public/data-fina.mjs; it does not load the old GLM static prototype's illustrative breakdowns. The GLM prototype's earlier snapshot (191 trips / ARS 694,500 / six pending 14/11 candidates) is obsolete and must not be used as a current data source.
