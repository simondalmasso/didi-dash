# Etios Earnings · Didi Dash

Mobile-first, public read-only dashboard for DiDi/Uber driving, ride earnings, rewards and vehicle operating costs.

## Access and data model

- Dashboard and JSON read APIs are public. Anyone with the URL can view and export the ledger, as explicitly requested by the owner.
- Browser writes are rejected. The only write endpoint is `POST /api/ingest`, protected by a private `INGEST_TOKEN` bearer secret.
- Passenger names, phone numbers, pickup/drop-off addresses and location fields are discarded by the record normalizers and are never persisted.
- Cloudflare Workers KV stores the ledger under a single `ledger:v1` key. This avoids occupying another D1 database in the account.
- Records are deduplicated by stable IDs.

The public URL exposes financial activity. Do not store passenger-identifying information in the ledger.

## Dashboard contents

- Ride KPIs and history: date, time, platform, amount, passenger kilometres and minutes.
- Rewards and incentives are stored and displayed separately from rides. They contribute to gross earnings but not to ride count, ride kilometres or passenger minutes.
- Fuel tickets and work sessions are separate collections.
- JSON backup and CSV trip export are public.

Gross earnings = ride amounts + reward amounts. Fuel margin is an estimate, not net profit. It excludes platform commissions, insurance, maintenance, tyres, depreciation and other operating costs.

## Runtime

- Cloudflare Worker: `didi-dash`
- Static assets: `public/`
- KV binding: `DATA` → `didi-dash-data`
- KV key: `ledger:v1`
- Only Worker secret: `INGEST_TOKEN`

## Deploy

Use the authenticated Wrangler profile on the authorized Windows host:

```powershell
npm ci
$env:INGEST_TOKEN = Get-Content "$env:LOCALAPPDATA\EtiosEarnings\ingest-token.txt" -Raw
npm run deploy
Remove-Item Env:INGEST_TOKEN
```

Wrangler needs permission to write Workers scripts and the KV namespace. The repository workflow runs tests on pushes and pull requests; production deployment is performed from the authorized Wrangler session because the prior GitHub Actions API token returned HTTP 401.

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
      "min": 9.9,
      "platform": "didi",
      "source": "sentinelx_ocr"
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

The API accepts the legacy bare trips array too. Repeated IDs are ignored. Passenger and location fields are excluded before storage.

## Public read APIs

- `GET /api/health`
- `GET /api/trips?limit=5000&from=YYYY-MM-DD&to=YYYY-MM-DD&platform=didi`
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
