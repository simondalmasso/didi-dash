# Inventario de mejoras a corregir — v1 (2026-11-24)

Primer inventario consolidado del auditor. Cada ítem cita su evidencia y su estado; los ítems con especificación enlazan a su CORR. Severidades: **alta** (bloquea una decisión o funcionalidad), **media** (limita evidencia o proceso), **baja** (higiene).

**Cifras de producción citadas:** export fresco 2026-11-24T06:58:18Z (post-despliegue de Helio) — 356 viajes, ARS 1.351.666 bruto, 182/356 con duración (51,1%), 195/356 con km reales (54,8%; 760,7 km), 100% DiDi.

| ID | Ítem | Tipo | Severidad | Estado | Vínculo |
|---|---|---|---|---|---|
| INV-01 | `commission_pct` no existe en el esquema | esquema | alta (solo v2) | decisión de Simón | CORR-002 |
| INV-02 | Cobertura de duración 51,1% (182/356) | evidencia | alta (para ranking) | abierto | backfill de detalle |
| INV-03 | Cobertura de km reales 54,8% (195/356) | evidencia | media-alta | abierto | backfill priorizado |
| INV-04 | Combustible no asignable por día (3 sin fecha; total ARS 380.000 en 12) | datos | media | abierto | diseño futuro |
| INV-05 | Sesiones sincronizadas = 0 → horas conectadas desconocidas | evidencia | media | abierto | captura futura |
| INV-06 | Test duplicado «withdrawal dashboard distinguishes…» | código | baja | propuesto | CORR-001 |
| INV-07 | QA visual de Helio reportado por el ejecutor; falta inspección ocular | proceso | media | **pendiente de Simón** | PLAN-001 |
| INV-08 | Endurecimiento `HH:mm` excluye horas sin minutos (0 afectados hoy) | código | baja | observación | documentado |
| INV-09 | Viaje 22:25 del 14/11 con ARS 900 sin explicar (`detail_verified=false`) | datos | baja | documentado | sin acción |
| INV-10 | Compra YPF del 17/11 «INDET» ($30.0000): confirmar ARS 30.000 o 300.000 | datos | baja | decisión de Simón | confirmar |
| INV-11 | 27 viajes antiguos con `km=0` (legado; canónico sería `null`) | datos | baja | abierto | normalización opcional |
| INV-12 | sxc_DAILY4 sin primera corrida autónoma demostrada | proceso | media | abierto | demostrar primer run |
| INV-13 | Originales de análisis externos no archivados (caso Sakana) | proceso | media | corregido hoy | CORR-003 |

## Detalle y evidencia

**INV-01.** El campo no existe en `migrations/0001_initial_schema.sql`, ni en la whitelist de ingesta, ni en `AGENTS.md`. El plan del motor (PR #36) declara la comparación DiDi vs Uber (v2) bloqueada por esta decisión de esquema previa. No bloquea v1. Opciones en CORR-002.

**INV-02.** 182/356 = 51,1% con duración observada (109.811 s = 30,5 h). El 15/11 la cobertura era 182/209 = 86,9%; los ingests posteriores de tarjetas de historial (sin pantallas de detalle) la diluyeron. Con los umbrales vigentes (≥5 viajes, ≥2 fechas, ≥90% cobertura), la mayoría de franjas y días queda descriptiva, no rankeada — correcto y honesto, pero mejorable abriendo pantallas de detalle del backlog.

**INV-03.** 195/356 = 54,8% con km reales (760,7 km). Backlog documentado en DATA-STATUS (sección del 21/11): 101 viajes del 16–20/11 prioritarios y 26 recientes en cola posterior; los 14 incorporados el 24/11 tampoco tienen km (tarjetas de historial). Los 27 km=0 del 03/11 son población separada (INV-11).

**INV-04.** 12 combustibles / ARS 380.000; 3 registros sin fecha (ARS 30.000 c/u) permanecen sin reasignar por regla del contrato (nunca inferir fecha). Sin litros ni odómetro en la mayoría. El neto diario no es afirmable; el panel Helio ya lo declara explícitamente. Diseño futuro opcional: asignación por período con regla escrita, nunca por día inferido.

**INV-05.** Sesiones = 0 en todas las snapshots documentadas (14/11, 21/11, 24/11). El $/h es por hora con pasajero, no conectada. La señal de fatiga del futuro motor v1 queda limitada a días «Completo en ledger». La captura de sesiones requiere decisión de producto y evidencia nueva.

**INV-06.** El test «withdrawal dashboard distinguishes missing evidence from a zero fee» aparece dos veces en `test/dashboard-entry-controls.test.mjs` (líneas 7–8 en main; verificado con `git grep`). Reportado como no bloqueante en ambos dictámenes del PR #31 (#7123586766 y #7124201850). Infla el conteo: las 185 incluyen ambas copias → 184 pruebas distintas. CORR-001 lista los pasos exactos.

**INV-07.** El QA headless (375×812 / 1280×900, cero overflow, consola limpia) fue reportado por la ronda ejecutora y corroborado a nivel código por el auditor; la referencia visual Scrolltide fue verificada por el auditor. Falta la inspección ocular de Simón sobre producción, recomendada por el dictamen #7124201850. Con el merge y deploy ya hechos (2026-11-24 06:46/06:47 UTC), es el único cierre pendiente de PLAN-001.

**INV-08.** La validación estricta `HH:mm` excluye de los buckets horarios las horas sin minutos; 0 viajes afectados en el ledger vivo; documentado en DATA-FINA-SCHEMA. Observación, no defecto.

**INV-09.** Viaje del 14/11 22:25: componentes visibles ARS 5.500 contra total ARS 6.400; los ARS 900 sin explicar quedaron sin categoría fabricada y el viaje con `detail_verified=false`. La ambigüedad es visible por diseño; sin acción.

**INV-10.** Compra YPF del 17/11 22:34 con importe escrito `$30.0000`: ambigüedad ARS 30.000 vs ARS 300.000. No importada. Solo Simón puede confirmar el importe real; después iría por Preview/Confirm normal.

**INV-11.** 27 viajes del 03/11 con `km=0` y `km_source=unknown` (legado previo a la canónica `km: null` del PR #33). Normalizarlos a `null` tocaría el ledger: requiere autorización explícita y ronda ejecutora; beneficio: consistencia con la canónica vigente.

**INV-12.** sxc_DAILY4 creada el 22/11 (objetivo 08:00, America/Argentina/Cordoba). El primer run autónomo no está probado (entorno `inherited`, sin equipo asignado; la actualización de la tarea respondió «This task is no longer available»). Hasta registrar un run real, la rutina no se declara reloj confiable.

**INV-13.** El original del análisis de Sakana se perdió (solo existía en el chat). La CORR-003 queda vigente desde hoy: los análisis externos se archivan íntegros en `docs/auditoria/traducciones/`.

## Mantenimiento de este inventario

Se re-versión tras cada merge o ingest significativa. Los ítems cerrados se marcan (con fecha y evidencia de cierre); no se borran. Cada re-versión declara su anclaje.

**Anclaje:** `main@1e9c8a70` (2026-11-24, post-merge Helio; árbol idéntico al auditado `50d99c9`). Caduca si cambia el esquema, el código de `public/` o las cifras del ledger citadas.
