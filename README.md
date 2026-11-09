# Etios Earnings · Didi Dash

Mobile-first, public read-only dashboard for DiDi/Uber driving, ride earnings, rewards and vehicle operating costs.

## Access, privacy and data model

- Dashboard and JSON read APIs are public. Anyone with the URL can view and export the ledger.
- Browser writes are rejected. The only write endpoint is `POST /api/ingest`, protected by a private `INGEST_TOKEN` bearer secret.
- Passenger names, phone numbers, pickup/drop-off addresses and location fields are discarded by the record normalizers and are never persisted.
- Cloudflare Workers KV stores the ledger under a single `ledger:v1` key.
- Exact record IDs are deduplicated. Trip re-ingestion can enrich one incomplete record when date, start time, amount and platform identify exactly one existing trip. It preserves the original ID and fills missing kilometres and/or duration. If more than one trip matches that identity, the record is not inserted or merged; the response increments `ambiguous` so the collision can be reviewed.
- Rewards and incentives are stored separately from rides.

The public URL exposes financial activity. Do not store passenger-identifying information in the ledger. Route addresses may be used transiently by an importer to estimate a route, but must not be sent to this API or persisted.

## Kilometres and trip data

Each trip has a `km_source`:

- `actual`: kilometres read from the DiDi trip detail screen.
- `estimated`: route-distance estimate computed from pickup to drop-off. Always send this value explicitly; the API must not infer it.
- `unknown`: no distance is available. This is applied when `km` is zero.

For backwards compatibility, a positive `km` without `km_source` defaults to `actual`. New importers should always send `km_source` explicitly.

Trip-level kilometres measure only the passenger ride. They are not the vehicle's total kilometres and must not be used to calculate total fuel consumption.

## Fuel and vehicle operating costs

- Fuel cost estimation uses vehicle kilometres derived from work-session odometer readings (`odometer_end - odometer_start`), not passenger kilometres.
- The working baseline is **8.8 L/100 km**, taken from an Argentine road test of the Etios Hatchback 1.5 manual six-speed. A later Etios manual test reported 8.5 L/100 km in city use. These are observed test figures, not guarantees for this specific vehicle.
- Toyota Argentina's controlled urban-cycle homologation for the Etios 1.5 M/T 6 is **7.4 L/100 km** ([official energy-efficiency label](https://media.toyota.com.ar/db0d73f4-69fe-4d99-af5d-d47c7204e400.pdf)). This is a laboratory reference, not a real DiDi-use estimate.
- Actual consumption depends on traffic, idle time, air conditioning, loading, driving style and maintenance. Calibrate with consecutive full-tank fuel entries and odometer readings before treating it as measured consumption.
- Fuel price is the weighted price per litre from real fuel tickets (`sum(total_ars) / sum(liters)`). No daily YPF pump-price feed is used as a substitute for the price actually paid.
- The dashboard's "Ingreso tras combustible" is gross earnings less estimated fuel cost only. It is not final profit and excludes platform commissions, insurance, maintenance, tyres, depreciation and other operating costs.

Rewards contribute to total gross income but not ride count, ride kilometres, passenger minutes or trip-only activity charts. The top sparkline also shows ride income only, not rewards.

## Dashboard contents

- Ride KPIs and history: date, time, platform, amount, actual passenger kilometres, estimated route kilometres and duration.
- Vehicle kilometres and estimated fuel cost based on odometer sessions and real fuel tickets.
- Daily/monthly totals for earnings and recorded kilometres, with actual and estimated passenger distance kept separate.
- Rewards, fuel tickets and work sessions remain separate collections.
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
