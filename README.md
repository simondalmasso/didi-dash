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
- **Net operating estimate** = gross earnings - estimated fuel cost - prorated monthly fixed costs - one-off operating expenses. It is an estimate, not accounting profit.
- Monthly fixed-cost fields include insurance, maintenance reserve, tyres, vehicle tax/registration and other fixed costs. One-off entries include repairs, service, washing, tolls, parking and other expenses.
- Cost settings, one-off expenses, odometer work sessions and fuel receipts entered in the dashboard are stored in that browser's local storage, not in the public KV ledger. They are included in the JSON backup downloaded from the dashboard and do not automatically sync between PC and phone. Blank monthly costs are treated as unknown; a user must enter a value or explicitly enter zero before the dashboard can report a complete net operating estimate.
- Fuel consumption uses **8.8 L/100 km** as the working urban reference from an Argentine road test of the Etios Hatchback 1.5 manual six-speed ([MotorMagazine test](https://motormagazine.com.ar/prueba-toyota-etios-2016-hatchback-1-5-xls-manual/)). Toyota's controlled urban-cycle homologation is **7.4 L/100 km** ([Toyota Argentina energy-efficiency label](https://media.toyota.com.ar/db0d73f4-69fe-4d99-af5d-d47c7204e400.pdf)). The 8.8 figure is a measured test reference, not the guaranteed consumption of this particular car.
- The initial YPF Súper price snapshot is **ARS 2,167/L**, effective **2026-11-02**, from YPF San Carlos Centro, Santa Fe ([station record based on Secretary of Energy pump-price data](https://energyia.ar/energydata/estaciones/ypf-san-carlos-centro)). This is a nearby regional reference, not a guarantee of the exact price at a station in Santa Fe capital. The station-price page warns that declarations can be stale because reporting each price change stopped being mandatory in June 2025. Treat ARS 2,167/L as a dated regional snapshot, not today's guaranteed pump price; confirm at the actual station or on the receipt and add a new effective-date snapshot whenever the price changes. There is no need to poll it every day while the pump price is unchanged. The calculator applies the most recent saved price snapshot effective on each trip/session date and never applies a future price retroactively.
- Fuel formula: `litres = vehicle_km × consumption_L_per_100km / 100`; `fuel_cost = litres × YPF_Super_price_for_that_date`.
- Fuel distance is taken from work-session odometer differences, never estimated route kilometres. If odometer readings are missing, the dashboard shows only a **partial minimum** based on real passenger-ride kilometres; it does not treat that as the car's total fuel cost or complete net profit. Estimated pickup-to-dropoff route kilometres are excluded from fuel calculations.
- When two or more consecutive full-tank fuel records contain odometer readings, the calculator derives a tank-to-tank consumption figure from litres added and odometer distance, replacing the 8.8 reference for the estimate. Until then, it uses the test reference.
- Complete net operating status requires odometer readings for every selected work session, a dated YPF price for the dates being evaluated, and a confirmed value (including zero) for every fixed-cost category. Otherwise the dashboard labels the result **partial/incomplete**.
- Rewards count toward gross earnings but not ride count, passenger kilometres, passenger minutes or trip-only activity charts.
## Dashboard contents

- Ride KPIs and history: date, time, platform, amount, actual passenger kilometres, estimated route kilometres and duration.
- Vehicle kilometres, YPF Super price history, fuel estimate and net operating result with completeness indicators.
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
