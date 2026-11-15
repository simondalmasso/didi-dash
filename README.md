# Etios Earnings · Didi Dash

Mobile-first, public read-only dashboard for DiDi/Uber driving, ride earnings, rewards and vehicle operating costs.

## Access, privacy and data model

- Dashboard and JSON read APIs are public. Anyone with the URL can view and export the ledger.
- Browser writes are rejected. The only write endpoint is `POST /api/ingest`, protected by a private `INGEST_TOKEN` bearer secret.
- Passenger names, phone numbers, pickup/drop-off addresses and location fields are discarded by the record normalizers and are never persisted.
- Cloudflare Workers KV stores the ledger under a single `ledger:v1` key.
- Exact record IDs are deduplicated. Trip re-ingestion can enrich one incomplete record when date, start time and platform identify exactly one existing trip. A confirmed DiDi detail is authoritative for the final driver amount; if its amount differs from the history-list amount, the existing row is corrected while preserving its ID. It preserves the original ID and fills missing kilometres and/or duration. If more than one trip matches that identity, the record is not inserted or merged; the response increments `ambiguous` so the collision can be reviewed.
- Rewards and incentives are stored separately from rides.

The public URL exposes financial activity. Do not store passenger-identifying information in the ledger. Route addresses may be used transiently by an importer to estimate a route, but must not be sent to this API or persisted.

## Kilometres and trip data

Each trip has a `km_source`:

- `actual`: kilometres read from the DiDi trip detail screen.
- `estimated`: route-distance estimate computed from pickup to drop-off. Always send this value explicitly; the API must not infer it.
- `unknown`: no distance is available. This is applied when `km` is zero.

For backwards compatibility, a positive `km` without `km_source` defaults to `actual`. New importers should always send `km_source` explicitly.

Trip-level kilometres measure only the passenger ride. They are not the vehicle's total kilometres and must not be used to calculate total fuel consumption.

## Gross earnings, net operating result and fuel

- **Gross earnings** = driver earnings from trips + recorded rewards/bonuses. Rewards are shown separately but included in gross.
- **Net operating estimate** = gross earnings - estimated fuel cost based on vehicle kilometres - prorated monthly fixed costs - one-off operating expenses. It is an estimate, not accounting profit. **Cash after fuel purchases** is reported separately as gross earnings - recorded fuel payments - known other costs; it measures cash outlay, not fuel consumed, and is never combined with the estimated fuel cost in the same result.
- Monthly fixed-cost fields include insurance, maintenance reserve, tyres, vehicle tax/registration and other fixed costs. One-off entries include repairs, service, washing, tolls, parking and other expenses.
- Cost settings, one-off expenses and odometer work sessions entered in the dashboard are stored in that browser's local storage, not in the public KV ledger. They are included in the JSON backup downloaded from the dashboard and do not automatically sync between PC and phone. Fuel purchases can also be privately ingested into the KV ledger. Both ingestion and browser entry accept a paid total before date, litres or odometer are known; missing fields remain null instead of being guessed. Undated fuel purchases are included in cash after fuel purchases for every selected date range, but are not assigned to a day/month or used to measure consumption. Incomplete fuel records are never used for tank-to-tank measurement until the required fields are supplied. Blank monthly costs are treated as unknown; a user must enter a value or explicitly enter zero before the dashboard can report a complete net operating estimate.
- Fuel consumption uses **8.8 L/100 km** as the working urban reference from an Argentine road test of the Etios Hatchback 1.5 manual six-speed ([MotorMagazine test](https://motormagazine.com.ar/prueba-toyota-etios-2016-hatchback-1-5-xls-manual/)). Toyota's controlled urban-cycle homologation is **7.4 L/100 km** ([Toyota Argentina energy-efficiency label](https://media.toyota.com.ar/db0d73f4-69fe-4d99-af5d-d47c7204e400.pdf)). The 8.8 figure is a measured test reference, not the guaranteed consumption of this particular car.
- The YPF Súper price history starts with a regional reference of **ARS 2,167/L**, effective **2026-11-02**, from YPF San Carlos Centro, Santa Fe ([station record based on Secretary of Energy pump-price data](https://energyia.ar/energydata/estaciones/ypf-san-carlos-centro)). It also includes an observed ticket price of **ARS 2,178.65/L**, effective **2026-11-10**, calculated from the driver's own YPF Súper receipt (**ARS 20,000 / 9.180 L**). The exact station location was not recorded, so this is not a verified Santa Fe citywide or chainwide tariff; prices can vary between stations. The station-price page warns that declarations can be stale because reporting each price change stopped being mandatory in June 2025. Confirm the current price at the actual station and add a new effective-date snapshot whenever it changes. The calculator applies the most recent saved price snapshot effective on each trip/session date and never applies a future price retroactively.
- Fuel formula: `litres = vehicle_km × consumption_L_per_100km / 100`; `fuel_cost = litres × YPF_Super_price_for_that_date`.
- Fuel distance is taken from work-session odometer differences, never estimated route kilometres. If odometer readings are missing, the dashboard shows only a **partial minimum** based on real passenger-ride kilometres; it does not treat that as the car's total fuel cost or complete net profit. Estimated pickup-to-dropoff route kilometres are excluded from fuel calculations.
- When two or more consecutive full-tank fuel records contain odometer readings, the calculator derives a tank-to-tank consumption figure from litres added and odometer distance, replacing the 8.8 reference for the estimate. Until then, it uses the test reference.
- Complete net operating status requires odometer readings for every selected work session, a dated YPF price for the dates being evaluated, and a confirmed value (including zero) for every fixed-cost category. Otherwise the dashboard labels the result **partial/incomplete**.
- Rewards count toward gross earnings but not ride count, passenger kilometres, passenger minutes or trip-only activity charts.
## Dashboard views

- / is the metrics-only home: the primary provisional net is **trip earnings minus recorded fuel purchases**, with rewards excluded from that headline value. It is a cash-after-purchases indicator, not complete operating profit.
- /inputs/ contains local-only fuel tickets, odometer work sessions, fixed-cost settings, one-off expenses and YPF price history.
- /trips/ contains the ride history, rewards, JSON backup and CSV export.
- Navigation uses one shared HTML/JavaScript source. The Worker rewrites /inputs/ and /trips/ paths to index.html, while the browser selects the requested view from the original URL. This keeps one implementation and preserves same-origin local-storage entries.
- Period filters are deep links: Hoy uses range=1, 7 días uses range=7, Todo uses range=all, and 30 días is the default. Refreshing or sharing a filtered URL keeps the same period, and navigation preserves it across views.
- The active navigation link is selected from the current route and exposes `aria-current=page`. The secondary cash KPI is labelled explicitly as including rewards and subtracting recorded fuel purchases and other entered costs.

## Dashboard contents

- Ride KPIs and history: date, time, platform, amount, actual passenger kilometres, estimated route kilometres and duration.
- Vehicle kilometres, a primary fuel-consumption KPI (measured tank-to-tank when complete readings exist; otherwise the 8.8 L/100 km Etios road-test reference), YPF Súper price history, fuel estimate, cash after fuel purchases and net operating result with completeness indicators.
- Daily/monthly totals for earnings and recorded kilometres, with actual and estimated passenger distance kept separate.
- Rewards, fuel tickets and work sessions remain separate collections. Browser-only cost settings and one-off expenses are included in the local JSON backup.
- JSON backup and CSV trip export are public.

## Runtime

- Cloudflare Worker: `didi-dash`
- Static assets: `public/`
- KV binding: `DATA` → `didi-dash-data`
- KV key: `ledger:v1`
- Only Worker secret: `INGEST_TOKEN`

## Deploy

Production deploy is automated by GitHub Actions on successful pushes to `main`. The workflow runs the test suite first and then deploys the Worker using repository secrets. The authorized Windows Wrangler profile remains available for recovery or manual deployment, but it is no longer the normal production path.

## Private ingestion

`POST /api/ingest`

Headers:

```
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

A request accepts up to 500 total records:

```json
{
  "trips": [
    {
      "date": "2026-11-03",
      "start": "17:35",
      "amount": 2300,
      "km": 2.7,
      "km_source": "actual",
      "min": 9.9,
      "platform": "didi",
      "source": "didi_history_detail"
    },
    {
      "date": "2026-11-03",
      "start": "17:50",
      "amount": 1800,
      "km": 4.1,
      "km_source": "estimated",
      "min": 0,
      "platform": "didi",
      "source": "route_estimate"
    }
  ],
  "rewards": [
    {
      "date": "2026-11-06",
      "start": "21:33",
      "amount": 35000,
      "label": "Recompensa",
      "source": "sentinelx_ocr"
    }
  ],
  "fuel": [],
  "sessions": []
}
```

The API accepts the legacy bare trips array too. The response includes `inserted`, `updated`, `duplicates` and `ambiguous` counts for trips. Ambiguous trip identities are left untouched to avoid corrupting or silently duplicating the ledger. Passenger and location fields are excluded before storage.

## Public read APIs

- `GET|HEAD /api/health`
- `GET|HEAD /api/trips?limit=5000&from=YYYY-MM-DD&to=YYYY-MM-DD&platform=didi`
- `GET /api/rewards?limit=5000&from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/fuel?limit=5000`
- `GET /api/sessions?limit=5000`
- `GET /api/export` — JSON backup of all ledger collections.

KV holds the complete ledger in one value (maximum 25 MiB). This project is intended for one rider's low-volume personal ledger, not high-concurrency multi-user writes.

## Local verification

Requires Node.js 22 or newer:

```sh
npm ci
npm test
```


## Detailed DiDi trip analytics

A DiDi detail import may include `service_type`, exact `duration_seconds`, `fare_breakdown`, `fare_total_ars`, `adjusted_from_ars`, `earnings_adjusted` and `detail_verified`. The fare object is independently whitelisted to distance, time, waiting, dynamic base, differential price and tariff reimbursement. Unknown nested fields are discarded. Conflicting non-null fare details are classified ambiguous rather than overwriting existing values.

The ride history includes a daily journey timeline with start time, amount, exact duration, estimated end, actual passenger kilometres and fare-component chips. Inter-trip gaps are shown as unclassified unless a synchronized work session provides evidence; they are not inferred to be waiting or online time. A trip with `detail_verified=false` remains visible with a partial-detail indicator.

See [the current data status](docs/DATA-STATUS.md) for the 2026-11-14 A22 reconciliation and production snapshot.

## Private Windows import Companion

The dashboard import dialog is in `/trips/`. On the Windows PC, configure the credential once with `npm run companion:setup`, then start the loopback process with `npm run companion:start`. The Companion reads the current Windows user's DPAPI-protected credential from `%LOCALAPPDATA%\\DidiDash\\ingest-token.dpapi`; the browser never receives the Bearer token.

In the dashboard, select the structured JSON file, connect the Companion, inspect the count-only dry-run preview, then use the separate confirmation to commit. The local-session checkbox is opt-in and unchecked by default. Preview and commit are separate requests; after an uncertain commit response, inspect a fresh export before retrying.

Deployment uses the DPAPI-protected credential when available. `npm run deploy -- --dry-run` builds an authenticated Wrangler dry run without changing production; `npm run deploy` performs the production deploy after the test suite is green.

The raw DiDi list/detail capture producer remains separate from this import contract. Do not claim the dashboard itself parses a raw DiDi export. Every new acquisition path must be tested on a small real-device sample and must emit only the whitelisted, sanitized fields.


## Data Fina — real fare breakdown and operating picture

The Trips view includes a live data-fina section: registered cash net, a locally editable daily gross target, verified-detail coverage, trip-data coverage, actual component allocation, active-day gross bars, start-hour distribution and Etios reference efficiency. All figures are calculated from the current ledger with public/data-fina.mjs; the reference HTML received from GLM is not bundled and its illustrative component allocations are not used.

Canonical trip detail uses modality and breakdown with source actual and a components list. Six component codes are supported because DiDi's actual detail screen includes a separate waiting-fare line: distancia, tiempo, espera, base_dinamica, diferencial, and reembolso_tarifario. See docs/DATA-FINA-SCHEMA.md.

The component bar includes only actual breakdowns that reconcile to trip amount within ARS 2. Missing or null lines are absent, not zero. A partial trip remains unallocated until reconciled. The current snapshot is documented in docs/DATA-STATUS.md: 209 trips / ARS 800,900 gross, ARS 109,300 rewards, ARS 200,000 recorded fuel purchases and 17 reconciled detail breakdowns from the 14 November source. No synchronized sessions exist, so the hourly KPI is per reported trip-time hour, never connected-hour productivity. Undated fuel purchases affect cash but are never assigned to a day or month.
