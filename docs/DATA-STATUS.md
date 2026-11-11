# DATA-STATUS — estado operativo de datos

> Snapshot de auditoría. Fuente de verdad en tiempo real: ledger KV del Worker.

**Última auditoría registrada:** 2026-11-11.

## Contrato
- Lectura pública: `GET /api/trips`, `/api/rewards`, `/api/fuel`, `/api/sessions`, `/api/export`.
- Ingesta privada: `POST /api/ingest`, protegida por token.
- Sin token, la ingestión debe rechazar la solicitud.
- No exponer el token en HTML, repositorio, logs ni documentación.

## Cobertura conocida

| Campo | Cobertura | Estado |
|---|---:|---|
| Fecha / hora inicio | 120/120 | Verificado |
| Importe | 120/120 | Verificado |
| Plataforma | 120/120 | Verificado |
| Kilómetros | 93/120 | Parcial |
| Duración | 93/120 | Parcial |
| Zona / origen-destino | 0/120 | Pendiente GPS |

## Días con km y duración completos
- 05/11/2026 — 16 viajes
- 06/11/2026 — 16 viajes
- 07/11/2026 — 22 viajes
- 08/11/2026 — 17 viajes
- 10/11/2026 — 19 viajes

## Día parcial
**03/11/2026:** 30 viajes; km 3/30 y duración 3/30.

La provenance conocida distingue viajes provenientes de historial detallado de los provenientes de una lista que no entregó km/min. Acción pendiente: reimportar el detalle del 03/11 si sigue disponible en el A22.

## Datos no entregados por la fuente
Zona/origen-destino no está disponible en los datos DiDi auditados. No debe marcarse como cero ni como error de importación: queda **pendiente GPS**.

## Turnos / odómetro
En la auditoría del 11/11, el Worker no tenía sesiones persistidas. No asumir que turnos u odómetro visibles en un navegador estén sincronizados al KV hasta verificarlo mediante la API.

## Procedimiento de certificación post-importación
1. Refrescar los datos desde el Worker.
2. Revisar el export y confirmar que no haya colecciones truncadas.
3. Recalcular la matriz de cobertura por día.
4. Mostrar badge global y badges por día: **verificado**, **parcial** o **pendiente**.
5. Un preview del export completo del A22 que reporte cero viajes nuevos puede usarse como evidencia de reconciliación, siempre que utilice el mismo parser/deduplicación que la ingestión real.

## Regla de integridad
Ausencia de dato ≠ 0. No completar por inferencia sin marcar explícitamente el valor como derivado y documentar su método.
