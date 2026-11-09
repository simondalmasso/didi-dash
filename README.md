# Didi Dash

Private trip ledger and operating dashboard for DiDi/Uber driving in Santa Fe.

## Architecture

- Cloudflare Worker serves the static dashboard and the /api/* routes.
- D1 stores trips, work sessions and fuel tickets.
- The dashboard uses a signed, HttpOnly, Secure, SameSite=Strict session cookie.
- SentinelX sends validated trips to POST /api/ingest with a dedicated bearer token.
- Trip IDs are supplied by the extractor when available; otherwise the API generates a deterministic SHA-256 ID and ignores duplicates.
- Passenger names, phone numbers and exact home/work addresses are not part of the schema. Optional location fields accept coarse zone labels only.

The public dashboard shell contains no trip data. All financial and trip APIs require a session. The ingestion endpoint has a separate token and is not exposed in browser code. CORS is not enabled.

## GitHub Actions secrets

Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare account identifier |
| CLOUDFLARE_API_TOKEN | Cloudflare token with D1 Read, D1 Write and Workers Scripts Write permissions |
| DASHBOARD_PASSWORD | Unique dashboard password, at least 18 characters |
| INGEST_TOKEN | Random ingestion bearer token, at least 32 characters |
| SESSION_SECRET | Random HMAC key, at least 32 characters |

Do not put any of these values in source code, the HTML, a commit, or a chat message. The Cloudflare API token is only used by the GitHub Actions deployment process. The dashboard password, ingestion token and session key are uploaded to the Worker as encrypted secrets.

On merge/push to main, GitHub Actions:

1. Installs the pinned Wrangler version and runs tests.
2. Finds the D1 database named didi-dash, creating it if absent.
3. Applies the checked-in SQL migrations.
4. Deploys the Worker, static dashboard and encrypted Worker secrets.

The generated Wrangler config and temporary secrets file are removed after deployment. The workflow does not print secret values.

## API

### Health

GET /api/health is public and returns only service status. It does not expose metrics or records.

### Dashboard login

POST /api/session

    { "password": "your-dashboard-password" }

Successful login sets a 12-hour HttpOnly session cookie. POST /api/logout clears it.

### SentinelX ingestion

POST /api/ingest

Headers:

    Authorization: Bearer <INGEST_TOKEN>
    Content-Type: application/json

Body:

    {
      "trips": [
        {
          "date": "2026-11-03",
          "start": "17:35",
          "amount": 2300,
          "km": 2.7,
          "min": 9.9,
          "platform": "didi",
          "source": "sentinelx_ocr",
          "origin_zone": "Centro",
          "destination_zone": "Candioti"
        }
      ]
    }

The endpoint accepts 1–500 trips per request. id is optional. If omitted, the API derives a stable SHA-256 ID from date, time, amount, distance, duration, platform and coarse zones. Repeated IDs are ignored with INSERT OR IGNORE.

Response:

    { "ok": true, "received": 1, "inserted": 1, "duplicates": 0 }

### Authenticated dashboard APIs

- GET /api/trips?limit=2000&from=YYYY-MM-DD&to=YYYY-MM-DD&platform=didi
- POST /api/trips — manual JSON import (session required)
- GET /api/fuel / POST /api/fuel
- GET /api/sessions / POST /api/sessions

Fuel log example:

    {
      "date": "2026-11-09",
      "odometer_km": 82500,
      "liters": 32.4,
      "total_ars": 69228,
      "station": "YPF",
      "full_tank": true
    }

Work session example:

    {
      "date": "2026-11-09",
      "platform": "didi",
      "connected_start": "09:00",
      "connected_end": "15:00",
      "odometer_start": 82500,
      "odometer_end": 82572.4
    }

## Local checks

Requires Node.js 22 or newer:

    npm install
    npm test

Deployment is done by GitHub Actions. Do not run a production deployment until the repository secrets are configured and the pull request has been reviewed/merged.

## Metric definitions

- Gross revenue: sum of trip amounts; incentives must be recorded separately if they are not represented as trips.
- Passenger kilometres and passenger minutes: sum of trip detail values.
- Connected hours: sum of explicitly recorded app connection sessions, not inferred gaps between trips.
- Fuel margin: gross revenue minus estimated fuel consumed. This is not net profit and excludes platform commission, insurance, maintenance, tyres, depreciation and other expenses.
- Fuel cost estimation uses odometer distance when work sessions contain paired odometer readings; otherwise it estimates total distance from passenger km plus a configurable empty-km allowance.
- Actual km/L requires at least two full-tank records. Until then, the dashboard labels consumption as an assumption.
