# Estado de datos — Didi Dash

## Snapshot vigente — producción verificada el 2026-11-24

**Fuente canónica:** `GET /api/health` y `GET /api/export` del Worker de producción, después de Confirm. Export: `2026-11-24T04:50:52.396Z`, schema 3. Health: `ok=true`, `storage=kv`. Las cinco colecciones informan `truncated=false`.

| Colección / métrica | Antes (PRE) | Después (POST) | Delta |
|---|---:|---:|---:|
| Viajes | 342 | **356** | +14 |
| Bruto de viajes | ARS 1.308.566 | **ARS 1.351.666** | +ARS 43.100 |
| Recompensas | 7 / ARS 109.300 | 7 / ARS 109.300 | 0 |
| Combustibles | 11 / ARS 340.000 | **12 / ARS 380.000** | +1 / +ARS 40.000 |
| Sesiones sincronizadas | 0 | 0 | 0 |
| Retiros | 0 | 0 | 0 |

La caja tras combustible registrado es ARS 1.080.966 (viajes + recompensas − compras de combustible registradas). **No es utilidad ni beneficio neto.** No se crearon sesiones, recompensas ni retiros.

### Extracción A22 — TIRÓN (2026-11-24)

**Fuente:** Samsung Galaxy A22 SM-A225M, DiDi Conductor; ADB + TIRÓN/RapidOCR/ONNX local. Muestra previa de 8 frames: 18 tarjetas reconocidas y validación del layout. Captura completa: **54 frames**; TIRÓN detectó tres frames consecutivos sin cambios y terminó al final del historial. Los frames persistidos fueron redactados; no se conservaron capturas originales ni OCR libre.

| Resultado del cruce UI vs export PRE | Cantidad |
|---|---:|
| Tarjetas reconstruidas por TIRÓN | 104 |
| Duplicadas contra producción | 90 |
| Nuevas clasificadas `nuevo` | **14** |
| Discrepancias | 0 |
| Ambiguas | 0 |
| Fragmentos sin parsear, excluidos | 49 |

Distribución de las 104 tarjetas reconstruidas: 23/11: 14; 22/11: 1; 21/11: 25; 20/11: 19; 19/11: 32; 18/11: 13. El delta de producción mostró 252 viajes no visibles en la captura; no son faltantes confirmados porque el historial visible no cubre todas las fechas del ledger. Los 49 fragmentos sin parsear no se reconstruyeron ni se importaron.

Los 14 viajes nuevos tienen fecha confiable, hora válida, modalidad observada **Express** y confianza OCR entre 0,999 y 1,000. Todos carecen de kilometraje y duración observados: se almacenan con `km=null`, `km_source=unknown` y `min=0` únicamente porque el validador actual del Worker exige el campo `min`; ese cero **no es una duración medida**. No se asignaron kilómetros, minutos ni desglose de tarifa por inferencia.

| Fecha | Hora | Tipo observado | Importe |
|---|---:|---|---:|
| 2026-11-23 | 20:30 | Express | ARS 4.000 |
| 2026-11-23 | 20:17 | Express | ARS 2.600 |
| 2026-11-23 | 20:05 | Express | ARS 3.300 |
| 2026-11-23 | 19:49 | Express | ARS 3.500 |
| 2026-11-23 | 19:36 | Express | ARS 2.700 |
| 2026-11-23 | 19:23 | Express | ARS 3.600 |
| 2026-11-23 | 19:06 | Express | ARS 4.700 |
| 2026-11-23 | 18:58 | Express | ARS 2.600 |
| 2026-11-23 | 18:51 | Express | ARS 2.200 |
| 2026-11-23 | 18:39 | Express | ARS 2.300 |
| 2026-11-23 | 18:26 | Express | ARS 2.800 |
| 2026-11-23 | 18:11 | Express | ARS 3.600 |
| 2026-11-23 | 18:02 | Express | ARS 3.000 |
| 2026-11-23 | 17:52 | Express | ARS 2.200 |
| **Total** | **14 viajes** | | **ARS 43.100** |

### Compra YPF informada por el usuario

Se incorporó una compra por **ARS 40.000**, el **23/11/2026 a las 17:50**, estación **YPF**. El usuario indicó nafta Súper y pago en tienda física. El esquema del ledger solo tiene un campo de estación; no dispone de campos separados para grado de combustible ni medio de pago. Por ello el registro conserva `station=YPF`; el grado Súper y la modalidad de pago quedan como procedencia declarada en este documento, no como campos estructurados. Litros y odómetro permanecen `null`; tanque lleno no se marcó.

### Preview, Confirm y respaldo

- Preview autenticado: HTTP 200, `dry_run=true`; 14 viajes + 1 combustible insertables; 0 updates, duplicados o ambiguos.
- Confirm autenticado: HTTP 201; 14 viajes + 1 combustible insertados; 0 updates, duplicados o ambiguos.
- Se usó el mismo payload en Preview y Confirm: SHA-256 `effa426c700d887db7670a70100b3e34a63ddece35171de85376648a45361843`.
- Antes de Confirm se compararon las cinco colecciones del export PRE contra el backup: contenido idéntico, Health/KV correcto y todas las banderas de truncamiento en false.
- Export POST reconciliado: SHA-256 `f3ffcee89aa1fc4f07cb81f8df287bd592e44d103e02c6bdefb755a931623d1f`.
- Backup PRE externo: `ledger-20261124-044733.json`; SHA-256 `36aba9b9175ad012505364cdc6d2a80ef1433eb0e658413dcc6910e7bf040d53`.
- Backup POST externo: `ledger-20261124-045107.json`; SHA-256 `2e912758d96fc9521671771c46a9a345fff8de981784f6fe1c747ac5f468e8d7`.
- Los 342 viajes preexistentes y las colecciones de recompensas, combustible, sesiones y retiros previas permanecieron sin modificaciones o pérdidas. Solo se insertaron los 15 registros previstos.

**Watermark:** avanzado después de Confirm y export reconciliado al último viaje incorporado, 2026-11-23 20:30, ARS 4.000. Se conserva una ventana de lookback para eventos tardíos.

**Privacidad y alcance:** payload, export PRE/POST, recibos y evidencia TIRÓN se guardan fuera del repositorio. No se guardaron nombres, teléfonos, direcciones, coordenadas ni OCR libre. No se modificó directamente KV, no se rotó ni imprimió `INGEST_TOKEN`, y la escritura se hizo exclusivamente por el endpoint autenticado `POST /api/ingest`. La ingesta de datos no cambió el código del Worker.

---

## Histórico — snapshot A22 del 2026-11-21

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


## A22 — importe YPF confirmado y envelope final (2026-11-21)

El usuario confirmó que la compra del 2026-11-17 a las 22:34 fue ARS 30.000. El envelope final conserva los 107 viajes (ARS 393.566), 101 km desconocidos y 6 km reales; agrega tres cargas YPF por ARS 100.000 (20/11 17:48 ARS 40.000; 19/11 20:49 ARS 30.000; 17/11 22:34 ARS 30.000). Recompensas, sesiones y retiros nuevos: 0.

Archivo final: `C:\Temp\didi-dash-evidence\a22-2026-11-21-import-107-ypf-confirmed-2.json`.
SHA-256 UTF-8: `386ddef68af23d9a0e3d8039125d78a29fc65cb8c00c8b5b8df9124f9c2b263d` (31.776 bytes).
Validación local: parser/whitelist y normalización pasaron para 107 viajes y 3 combustibles; 107 IDs de viaje únicos. Export fresco de producción HTTP 200: 209 viajes, 7 recompensas, 7 combustibles; todas las colecciones `truncated=false`. Colisiones contra producción: 0 IDs de viaje, 0 firmas fecha/hora/importe y 0 compras de combustible por fecha/hora/importe.

**Estado:** envelope listo; aún no se ejecutó Preview ni POST de commit. No se modificó KV. Próximo paso obligatorio: importar este JSON en el dashboard, ingresar `INGEST_TOKEN` en el campo protegido y revisar `POST /api/ingest?dry=1`. Solo confirmar si el Preview clasifica exactamente 107 viajes nuevos + 3 combustibles nuevos, 0 duplicados y 0 ambiguos. Luego export fresco, conciliación y backup externo.


## Producción vigente — corrida incremental A22 y Confirm (2026-11-22)

**Este corte supersede los estados operativos anteriores de este documento, incluido el bloque del 2026-11-21 que describía el envelope de 107 viajes como pendiente.** Las secciones anteriores se conservan como historial; no describen el estado vigente.

**Fuente canónica:** export fresco del Worker de producción, obtenido después del Confirm el 2026-11-22. HTTP 200; las cinco colecciones devolvieron `truncated=false`. Health HTTP 200, `ok=true`, storage `kv`.

| Colección / métrica | Producción vigente |
|---|---:|
| Viajes | 342 |
| Recompensas | 7 / ARS 109.300 |
| Combustibles | 11 / ARS 340.000 |
| Sesiones sincronizadas | 0 |
| Retiros registrados | 0 |
| Bruto de viajes | ARS 1.308.566 |
| Viajes + recompensas | ARS 1.417.866 |
| Caja tras combustible registrado | ARS 1.077.866 |

La caja tras combustible es viajes + recompensas − compras de combustible registradas. No representa utilidad operativa. Las tres compras sin fecha por ARS 90.000 continúan sin asignación temporal.

### Corrida incremental A22

**Dispositivo:** Samsung Galaxy A22 SM-A225M, ADB serial `R58R84BRDXP`, DiDi Conductor, pantalla Historial de viajes, filtro 16/11–22/11/2026.
**Adquisición:** TIRÓN + RapidOCR/ONNX local. Se capturaron 67 frames; la política de persistencia fue `opaque_mask_allowlisted_fields_only`; no se persistieron capturas originales ni OCR libre. El proceso se detuvo al detectar tres frames consecutivos sin cambios.

| Resultado del cruce UI vs export | Cantidad |
|---|---:|
| Tarjetas reconocidas | 131 |
| Duplicadas contra producción | 105 |
| Nuevas confirmadas por Preview | 26 |
| Discrepancias | 0 |
| Ambiguas | 0 |
| Filas parciales sin hora, excluidas | 10 |

Los 26 viajes nuevos suman **ARS 114.100**: 25 del 2026-11-21 por ARS 111.100 y 1 del 2026-11-22 por ARS 3.000. Todos tienen fecha confiable, hora válida y confianza OCR registrada de al menos 0,95. En 19 se reconoció modalidad Express; en 7 la modalidad quedó desconocida y no se infirió. Ninguno tiene kilometraje o duración de viaje medidos en esta captura: kilometraje se conserva como `null` con `km_source=unknown`. Las diez filas parciales sin hora no se incorporaron.

El delta mostró 211 registros del export no visibles en la UI; corresponden a fechas anteriores al filtro 16/11–22/11 y no se clasificaron como pérdidas.

### Confirm y comprobación posterior

El Preview autenticado devolvió HTTP 200 y exactamente 27 registros insertables: 26 viajes + 1 combustible; 0 actualizaciones, duplicados o ambigüedades. El export posterior al Preview conservó el baseline 316/7/10/0/0 y ARS 300.000, demostrando que Preview no mutó el ledger.

El Confirm autenticado devolvió **HTTP 201**, con 26 viajes insertados y 1 combustible insertado, 0 actualizaciones, 0 duplicados y 0 ambiguos. Un export fresco posterior verificó exactamente 342/7/11/0/0, combustible ARS 340.000, colecciones completas y health/KV operativo.

La compra de combustible agregada es YPF, 2026-11-21, ARS 40.000, hora `null`; litros y odómetro también permanecen desconocidos. ID canónico: `fuel-ypf-20261121-40000-time-unknown`.

### Evidencia, payload y recuperación

- Sesión TIRÓN: `C:\Temp\didi-dash-evidence\a22-incremental-20261122\`.
- Manifiesto saneado por registro: `evidence-manifest.json`; SHA-256 `9afd8aedced7eae4f1f3e2394c976b76e87dd574e2589c65b7e9007d8240d1c1`.
- Payload confirmado: `payload-26-trips-plus-ypf.json`; SHA-256 `878c2e085e01a1f2bf18200931cf3f01969bababa70aea8c9e3a69d31604fafd`.
- Backup PRE: `ledger-pre-confirm-20261122.json`; SHA-256 `ad4732410560794096ff6040893501193c964279d88c0a4b18c517b2d5be2d71`.
- Backup POST: `ledger-post-confirm-20261122.json`; SHA-256 `f184d722f7b8cb2a765b28a11e95941ecff910ab8001fecdcd8fe2f292abb0a9`.
- Recibo: `commit-receipt.json`; SHA-256 `7acc13f998b721037fdc9563ab548004f697a459b554b422617ef59ea2abd207`.

Los backups PRE/POST y el payload se verificaron por hash. El token se leyó de Windows Credential Manager en memoria durante Preview y Confirm; nunca fue impreso, persistido en archivos ni rotado.

### Cobertura de kilometraje y pendientes

El export vigente contiene 188 viajes con `km_source=actual` y 154 sin kilometraje real: 127 `km=null` y 27 registros antiguos con `km=0` y `km_source=unknown`. Los 26 viajes recién insertados forman parte de los 127 nulos. Los 27 ceros antiguos siguen siendo desconocidos; no se reinterpretan como distancia real.

**Backfill pendiente:** priorizar los 101 viajes nulos del envelope de 16–20/11; los otros nulos y los 27 antiguos se mantienen separados para investigación. Actualizar únicamente desde pantallas de detalle con evidencia saneada y hash, Preview, backup y reconciliación posterior. No estimar kilómetros ni duración.

**Estado operativo:** la extracción y la ingesta del 2026-11-22 están completas. La automatización diaria `Didi Daily Ingest` está creada y habilitada para las 08:00 locales con recurrencia diaria, pero el entorno figura como heredado/no asignado a la PC y aún no hay una primera corrida autónoma verificada. Por lo tanto, no afirmar que GPT ya ejecuta el flujo solo. El watermark de adquisición pasa a **2026-11-22 00:14**; la próxima inspección debe empezar desde ese viaje e incluir llegadas tardías posteriores.

**Sin cambios:** lógica del Worker, dependencias, deploy, CLEAN1, PR #31/Helio y backlog Horas permanecen fuera de esta corrida.


## sxc_DAILY4 — cierre auditado y formalización operativa (2026-11-22)

Este addendum mantiene el historial anterior. El estado productivo vigente sigue siendo el corte de 342/7/11/0/0 verificado en el apartado anterior.

### Watermark persistido

El watermark de adquisición está escrito fuera del repositorio en `C:\Temp\didi-dash-evidence\state\watermark.json`. Apunta al último viaje de la corrida confirmada: **2026-11-22 00:14**, importe ARS 3.000, ID `17e150e0b9c6584b0ade6d5a913b29e79f7f0a1b1c007d047e3da758e5e6878f`. La corrida futura debe incluir una ventana de lookback para llegadas tardías y solo avanzar este watermark después de un Confirm más export reconciliado.

### Digesto número 2 — control sin cambios

**Fecha local:** 2026-11-22 01:21. Este es un control read-only posterior a la corrida 1; no se ejecutó una segunda captura ADB ni una segunda ingesta.

| Métrica | Antes (corrida 1) | Después (digest 2) |
|---|---:|---:|
| Viajes | 342 | 342 |
| Recompensas | 7 | 7 |
| Combustibles | 11 | 11 |
| Sesiones | 0 | 0 |
| Retiros | 0 | 0 |
| Bruto viajes | ARS 1.308.566 | ARS 1.308.566 |
| Recompensas ARS | ARS 109.300 | ARS 109.300 |
| Combustible ARS | ARS 340.000 | ARS 340.000 |

Las cinco colecciones se compararon registro por registro con el backup POST de la corrida 1: **sin cambios**. Export HTTP 200, todas las colecciones `truncated=false`; Health HTTP 200, KV activo. Nuevos viajes, recompensas, combustible, sesiones y retiros desde corrida 1: **0**. No se generó backup nuevo porque no hubo mutación; se conserva el backup POST SHA-256 `f184d722f7b8cb2a765b28a11e95941ecff910ab8001fecdcd8fe2f292abb0a9`.

Archivo del digest: `C:\Temp\didi-dash-evidence\a22-incremental-20261122\daily-digest-02.json`. SHA-256 `d60bc9168d862ed6cd1457f0958ed6905b2c73c48654d84ff08e516de0be2e16`.

### Triaje de los 10 fragmentos excluidos

Los diez fragmentos están clasificados por TIRÓN como `sin_hora`. La inspección de las cajas allowlisted de cada frame muestra que el primer renglón visible contiene modalidad/importe, pero no la cabecera de fecha/hora asociada: es la continuación superior de una tarjeta cuyo timestamp quedó fuera del viewport al costurar el scroll. No hay dato suficiente para reconstruir su hora. Ninguno entra en el payload.

| Frame | Y | Causa observada | Resolución |
|---|---:|---|---|
| frame_0003.png | 322 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0015.png | 352 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0016.png | 296 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0033.png | 358 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0034.png | 301 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0046.png | 356 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0047.png | 299 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0056.png | 352 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0057.png | 301 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |
| frame_0063.png | 348 | Renglón modalidad/importe visible; timestamp no capturado | Excluido |

Fuente de clasificación: `out/filas_sin_parsear.csv` y sondeo `tiron.py rows` sobre los diez frames. Los PNG son saneados; no se conserva OCR libre.

### Split exacto de kilometraje del export

Export fresco posterior a la corrida 1:

| Estado de km | Viajes |
|---|---:|
| Reales (`km_source=actual`, km positivo) | 188 |
| Nulos (`km=null`, `km_source=unknown`) | 127 |
| — prioritarios del envelope 16–20/11 | 101 |
| — recién incorporados 21–22/11 | 26 |
| Ceros antiguos (`km=0`, `km_source=unknown`) | 27 |

Los 101 del 16–20/11 siguen siendo el objetivo prioritario del backfill. Los 26 nuevos quedan en una cola posterior. Los 27 ceros antiguos del 03/11 son una población separada y no se alteran. `null` no equivale a cero.

### Credencial y custodia

El 2026-11-22 se releyó el tamaño de `didi-dash/INGEST_TOKEN` desde Windows Credential Manager y se obtuvo **43 caracteres**. Solo se emitió el número; el valor del secreto no fue mostrado ni escrito en archivos, logs o mensajes. No hubo rotación.

### Horario y automatización

Hora operativa elegida: **08:00, America/Argentina/Cordoba**, desde el 2026-11-23. La automatización de ChatGPT solo admite recurrencia flexible: 08:00 es el objetivo de ejecución, no una garantía de minuto exacto. En el registro visible, `Didi Daily Ingest` figura habilitada pero con entorno `inherited` y sin equipo explícitamente asignado; el primer run autónomo no está probado. La actualización de esa tarea respondió literalmente `This task is no longer available.`; no se creó una segunda tarea para evitar duplicados. Por eso la programación no se declara todavía como reloj autónomo fiable.

### Confirm directo y control de herramientas

El endpoint canónico `POST /api/ingest` fue ejecutado directamente por proceso autenticado, sin interfaz del dashboard ni click de Confirm dentro de la aplicación. Sin embargo, el lanzamiento del proceso fue detenido por el control de herramientas de OpenAI con el mensaje exacto: `Los controles de seguridad de OpenAI bloquearon esta llamada a la herramienta. Verifica nuevamente lo que estás intentando enviar.` La llamada se aprobó mediante el panel de revisión de Desktop Commander y luego completó HTTP 201. Por lo tanto, el endpoint no necesitó un click del dashboard, pero la ausencia de intervención humana ante una revisión de seguridad **no está demostrada** para futuras corridas.

### Frontera Git / SentinelX

Regla permanente: las operaciones Git se realizan únicamente desde la sesión Desktop Commander del usuario propietario del checkout, verificada como `DESKTOP-DPH3941\Simon`. SentinelX ejecuta como `NT AUTHORITY\SYSTEM`: puede apoyar ADB/OCR/observación, pero no operar Git sobre este checkout. No configurar `safe.directory` para SYSTEM ni cambiar propiedad del repositorio para habilitarlo.


### Alta de la automatización sxc_DAILY4

El 2026-11-22 se creó una tarea diaria nueva en este hilo: **Didi Daily Ingest — sxc_DAILY4**, con primer objetivo 2026-11-23 a las 08:00 (America/Argentina/Cordoba), recurrencia flexible. La tarea contiene el watermark persistente, el baseline post-Confirm 342/7/11/0/0, los gates de Preview/Confirm, el split de kilometraje y la regla de detenerse si la PC/A22 o el entorno remoto no están accesibles. El entorno se conserva como heredado y no tiene un vínculo explícito al equipo; por ello la primera corrida debe demostrar acceso real antes de que la rutina se considere autónoma. El horario es objetivo flexible, no garantía de minuto exacto.
