# Espacio de auditoría GLM — Didi Dash

Creado por instrucción directa de Simón el 2026-11-24 («armate un espacio de auditoría TUYO propio»). Este directorio es el espacio de trabajo permanente del auditor (GLM) dentro del repositorio: traducciones oficiales, inventario de mejoras, correcciones, planes y la hoja de ruta de la función de auditoría.

## Reglas del espacio

1. **Solo documentación.** Nada de lo que se escribe aquí cambia código, Worker, KV, esquema ni datos. Las correcciones (CORR) son especificaciones para rondas ejecutoras (GPT), no parches directos.
2. **Simón decide.** Merge, deploy, escritura de ledger y toda decisión de producción son exclusivas de Simón. Este espacio se escribe con autorización explícita por tanda.
3. **Anclaje y caducidad.** Todo documento declara el SHA exacto contra el que fue escrito y sus condiciones de caducidad (protocolo acordado con la ronda ejecutora).
4. **Sin secretos ni PII.** Aplica el contrato completo de `AGENTS.md`: sin nombres de pasajeros, direcciones, tokens ni OCR libre.
5. **Idioma.** Español; las traducciones oficiales usan registro formal neutro.

## Convenciones

- Nombres de archivo: `AAAA-MM-DD-nombre.md` (hereda la convención de `docs/plans/`).
- `traducciones/` — traducciones oficiales de análisis externos, con el original archivado cuando existe.
- `inventario/` — inventario de mejoras a corregir, versionado por fecha.
- `correcciones/` — una corrección por archivo, ID `CORR-NNN`.
- `planes/` — planes operativos del auditor, ID `PLAN-NNN`.
- `hoja-de-ruta/` — hoja de ruta de la función de auditoría.

### Ciclo de vida de una CORR

`propuesto` → `aprobado (Simón)` → `en cola (ronda ejecutora)` → `verificado (dictamen SHA)` → `cerrado`. Si el contexto cambia antes de ejecutar, pasa a `caducado` y se reescribe.

## Contenido (2026-11-24)

| Archivo | Qué es |
|---|---|
| `traducciones/2026-11-24-analisis-sakana.md` | Traducción formal del análisis de Sakana — parte verificable; original pendiente de re-adjunto |
| `inventario/2026-11-24-inventario-mejoras.md` | Inventario v1 de mejoras a corregir (13 ítems con evidencia) |
| `correcciones/2026-11-24-CORR-001-test-duplicado.md` | Consolidar el test duplicado de retiros |
| `correcciones/2026-11-24-CORR-002-commission-pct.md` | Hueco de esquema `commission_pct` — bloquea v2 |
| `correcciones/2026-11-24-CORR-003-archivo-analisis-externos.md` | Regla: archivar originales de análisis externos (lección Sakana) |
| `planes/2026-11-24-PLAN-001-verificacion-post-despliegue-helio.md` | Verificación post-despliegue de Helio — ejecutada; falta inspección ocular |
| `hoja-de-ruta/2026-11-24-hoja-de-ruta-auditora.md` | Fases, gates, cadencia e invariantes |

## Estado del repo al crear el espacio (2026-11-24, ~07:00 UTC)

- `main@1e9c8a70` — squash merge del PR #31 (Helio) hecho por Simón a las 06:46:51Z. Árbol idéntico al head auditado `50d99c9` (verificado: `git diff --stat` vacío), de modo que el dictamen #7124201850 se aplica íntegro al contenido fusionado.
- CI del push (run 45343005214): job `test` success (06:46:57–06:47:07Z); job `deploy` **success** (06:47:09–06:47:25Z) → producción desplegada.
- Post-despliegue verificado por el auditor: `/api/health` → `{"ok":true,"service":"didi-dash","storage":"kv"}`; export fresco 2026-11-24T06:58:18Z con 356 viajes · ARS 1.351.666 · 7 recompensas (109.300) · 12 combustibles (380.000) · 0 sesiones · 0 retiros, `truncated=false` en las cinco colecciones, 100% DiDi — datos intactos tras el deploy.
- Pendiente de cierre: inspección ocular de Simón sobre producción (PLAN-001, paso 5).
- PR #36 (plan del motor, draft) sigue abierto; su GATE 0 («Helio mergeado y desplegado») quedó técnicamente cumplido — la spec F1 se emite cuando Simón lo ordene.
