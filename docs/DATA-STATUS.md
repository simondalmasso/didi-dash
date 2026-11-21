# Estado de datos — actualización A22 2026-11-21

**Producción verificada:** `GET /api/export`, `2026-11-21T03:46:38.430Z`; 209 viajes (ARS 800.900), 7 recompensas, 7 combustibles, 0 sesiones y 0 retiros. Las cinco colecciones devuelven `truncated=false`. `GET /api/health` confirma `storage=kv`.

## Captura A22 2026-11-21 — pendiente de ingestión

**Fuente:** Samsung Galaxy A22 SM-A225M, DiDi Conductor; ADB + TIRÓN/RapidOCR local. 54 frames procesados; solo tokens OCR de campos permitidos persistidos; no se conservaron screenshots originales ni OCR libre. El rango visible fue 15/11–21/11 y se capturaron viajes de 16–20/11. Se añadieron al envelope dos viajes del 11/11 y 13/11 que ya estaban en el envelope local anterior, aún sin importar.

| Fecha | Viajes | Bruto |
|---|---:|---:|
| 2026-11-11 | 1 | ARS 900 |
| 2026-11-13 | 1 | ARS 1.100 |
| 2026-11-16 | 21 | ARS 62.266 |
| 2026-11-17 | 19 | ARS 71.200 |
| 2026-11-18 | 13 | ARS 41.300 |
| 2026-11-19 | 32 | ARS 101.200 |
| 2026-11-20 | 20 | ARS 115.600 |
| **Total** | **107** | **ARS 393.566** |

Los 107 registros tienen firmas únicas. No coinciden en fecha/hora con los 209 viajes del snapshot de producción. Hay 6 viajes con kilometraje real (73,68 km combinados) y 101 sin kilometraje real. No se capturaron duraciones; por tanto `min=0` en estos registros representa el placeholder histórico de adquisición, no una duración observada. Solo 1 modalidad se pudo confirmar: DiDi Express.

Detalle selectivo observado: viaje del 20/11 a las 17:29, ARS 38.300 finales, DiDi Express, 54,5 km. La pantalla indica ajuste desde ARS 34.600. Una línea adicional de ARS 2.400 no quedó etiquetada con certeza y no se asigna a ningún concepto de Data Fina; el desglose permanece sin verificar (`detail_verified=false`).

**Envelope de Preview:** `C:\Temp\didi-dash-evidence\a22-2026-11-21-import-107-ypf-confirmed-2.json`. SHA-256 `c5ea6f5bfe6da5845a1c11cd28dab1c16e4fa5ca5e16b87211c739e964e69f50` (UTF-8, 31.543 bytes). Incluye 107 viajes con 107 IDs deterministas únicos (ARS 393.566), 101 km explícitamente `null` + `km_source=unknown`, 6 km reales, 0 estimados; dos compras YPF (ARS 70.000); 0 recompensas, 0 sesiones y 0 retiros. No se guardan capturas ni OCR libre en el repositorio.

## Compras YPF informadas por el usuario — pendientes de Preview

| Fecha | Hora | Importe | Estado |
|---|---|---:|---|
| 2026-11-20 | 17:48 | ARS 40.000 | Preparada para importar; YPF Súper |
| 2026-11-19 | 20:49 | ARS 30.000 | Preparada para importar; YPF Súper |
| 2026-11-17 | 22:34 | **INDET** | No importada: el importe fue escrito `$30.0000`; requiere confirmar ARS 30.000 o ARS 300.000 |

No se asignan litros, odómetro ni tanque lleno porque no se aportaron esos datos. Los tres registros antiguos sin fecha (ARS 90.000) permanecen intactos y sin reasignar.

**Recompensas:** la pasada A22 no produjo ninguna fila tipada como recompensa; los 105 registros de la captura del 21/11 quedaron `desconocido` y suman ARS 391.566. No hay evidencia admisible para pasar de 7 a 8. Se mantiene delta 0 hasta evidencia específica.

**Estado operativo al redactar:** todavía no se ejecutó `POST /api/ingest`; el KV de producción permanece sin cambios. Se requiere Preview autenticado (`?dry=1`) desde el diálogo del dashboard y revisión de conteos/ambigüedades antes del commit. Después del commit: export fresco, verificación de delta y `npm run backup` fuera del repositorio.

---
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


## Live production snapshot — 2026-11-15 23:42:53 UTC

**Source:** fresh `GET /api/export` via the public production Worker. **Schema:** 3. **Truncation:** all exported collections reported `false`. This snapshot supersedes older count tables above; prior per-trip evidence remains historical evidence for the 14-Nov detail reconciliation.

| Collection / metric | Live value |
|---|---:|
| Trips | 209 |
| Rewards | 7 / ARS 109,300 |
| Fuel purchases | 7 / ARS 200,000 |
| Withdrawals | 0 records observed |
| Synchronized sessions | 0 records observed |
| Trip gross | ARS 800,900 |
| Cash after recorded fuel purchases (rewards included) | ARS 710,200 |
| Actual passenger kilometres | 668.2 km |
| Trips with actual km and positive duration | 182 / 209 |
| Reported passenger-trip time | 109,811 seconds (30h30m11s) |
| Active dates | 10 |

Daily coverage: 03-Nov 3/30; 05-Nov 16/16; 06-Nov 16/16; 07-Nov 22/22; 08-Nov 17/17; 10-Nov 19/19; 11-Nov 25/25; 12-Nov 23/23; 13-Nov 23/23; 14-Nov 18/18 (km and duration). The 03-Nov day remains partial; do not treat missing distances or durations as zero.

Fuel records: three existing undated ARS 30,000 purchases remain undated (ARS 90,000 total); 11-Nov ARS 30,000 Super; 12-Nov ARS 30,000 nafta super; 14-Nov ARS 30,000 with station, litres and odometer unknown; 10-Nov ARS 20,000 YPF Super (9.18 L). The full fuel total is a cash-purchase amount, not measured fuel consumption.

There are no withdrawal records in this export. This means no withdrawal activity is recorded in the ledger; it does not prove that no withdrawals occurred. Fee total remains unknown until observed and reconciled evidence is stored. Zero synced sessions likewise means connected hours remain unknown, not zero hours worked.

The new operational time-band signal is computed on each dashboard load from the live trip records. Its rate numerator and denominator are both restricted to trips with positive observed duration; coverage is displayed alongside the result. Ranking requires at least 5 trips, 2 active dates and 90% duration coverage. A band below the coverage threshold remains visible but is not ranked.


## A22 — captura y conciliación nueva (2026-11-17, pendiente de ingestión)

**Fuente:** Samsung Galaxy A22 SM-A225M, DiDi Conductor 7.10.70, filtro Historial/TODO.
**Método:** ADB + TIRÓN/RapidOCR local. Captura completa: 54 frames redactados; ningún frame original ni texto OCR libre fue persistido.
**Export de producción usado para el delta:** `GET /api/export`, 2026-11-17T06:51:04.846Z. Este corte devolvió 209 viajes (ARS 800.900), 7 recompensas, 7 registros de combustible, 0 sesiones y 0 retiros; las cinco colecciones informaron `truncated=false`.

### Resultado de adquisición y conciliación

TIRÓN reconoció 115 tarjetas. El cruce inicial clasificó 89 como duplicadas y 26 como nuevas, sin colisiones ambiguas ni discrepancias de OCR reportadas por el clasificador. La revisión adicional de evidencia de detalle dejó **25 viajes confirmados** y aisló **1 movimiento no clasificable**:

| Fecha | Viajes confirmados | Importe |
|---|---:|---:|
| 2026-11-11 | 1 | ARS 900 |
| 2026-11-13 | 1 | ARS 1.100 |
| 2026-11-16 | 21 | ARS 62.266 |
| 2026-11-17 | 2 | ARS 8.200 |
| **Total candidato confirmado** | **25** | **ARS 72.466** |

El archivo A22 preparado anteriormente contenía 22 viajes y ARS 68.466 para el 16–17/11. La captura nueva confirma esos 22 registros y añade el viaje del 16/11 a las 19:34 por ARS 2.000, que no estaba en el archivo anterior.

Se revisaron en la pantalla de detalle cinco viajes sin kilometraje previo: 11/11 16:05 (ARS 900, 2,9 km), 13/11 21:12 (ARS 1.100, 0,94 km), 16/11 18:24 (ARS 966, 6,47 km), 16/11 20:08 (ARS 1.100, 4,86 km) y 16/11 20:13 (ARS 900, 4,01 km). Estos son los únicos kilómetros que se incorporan como `km_source=actual`. Los otros 20 viajes conservan kilometraje desconocido (`km=0`, `km_source=unknown`). No se obtuvieron duraciones ni modalidades confirmadas en detalle para el conjunto; por ello no se asignan minutos ni `service_type`.

El candidato del 12/11 a las 20:10 por ARS 35.000 permanece **sin clasificar**: el detalle volvió a mostrar el importe, pero no aportó fecha/hora legible ni kilometraje/duración que permitan confirmar que sea un viaje. No se incorpora como viaje ni recompensa.

Además, quedaron 24 fragmentos OCR incompletos (13 sin hora y 11 sin importe). Se excluyen del envelope; no se reconstruyen por inferencia. La captura observó actividad en 11, 12, 13, 14, 16 y 17/11, pero no prueba cobertura completa de los días ausentes ni del historial anterior al 11/11.

### Envelope preparado — todavía no enviado

Archivo temporal, fuera del repositorio: `C:\Temp\didi-dash-evidence\a22-2026-11-17-import-25.json`.
SHA-256: `fb017898eb313b5b66641997026cf6d4f1e9aa132af3497fe28c9313059ec64e`.

Validación local con `parseImportJson`, `buildImportPayload` y `normaliseTrip`:
- 25 viajes normalizados; ARS 72.466; 25 IDs deterministas únicos.
- 5 kilómetros reales y 20 kilometrajes desconocidos; 25 duraciones desconocidas.
- 0 `service_type`/modalidades; 0 recompensas, 0 combustible, 0 sesiones y 0 retiros.
- El candidato ARS 35.000 está excluido.

**Estado operativo:** este envelope aún no se envió al Worker. No se ejecutó `POST /api/ingest` ni se modificó KV. El próximo paso es el Preview autenticado desde el diálogo del dashboard, con `INGEST_TOKEN` introducido por el usuario en el campo protegido. Solo podrá confirmarse si el Preview devuelve 25 viajes nuevos y cero duplicados/ambiguos; cualquier otra clasificación requiere detener y reconciliar. Después de una ingestión autorizada se exige export fresco, comparación del delta, `npm run backup` y copia secundaria fuera de este PC.
