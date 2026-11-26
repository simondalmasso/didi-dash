# Hoja de ruta auditora (2026-11-24)

Hoja de ruta de la función de auditoría de Didi Dash: qué audita el auditor, cuándo, con qué gates y con qué invariantes. Documento vivo: cada fase se re-ancla al SHA vigente al entrar.

## FASE 0 — Espacio (2026-11-24) ✓

- Espacio de auditoría creado con autorización explícita de Simón (este directorio).
- Inventario v1 (13 ítems), CORR-001..003, PLAN-001, traducción Sakana (parcial).
- Dictamen del PR #31 head `50d99c9` (#7124201850): sin defectos bloqueantes.

## GATE A — Helio a producción (2026-11-24) ✓ técnico · falta inspección ocular

- Simón mergeeó el PR #31 (squash `1e9c8a70`, 06:46:51Z). Deploy success (06:47:09–06:47:25Z).
- Verificación post-despliegue del auditor (PLAN-001): health ok, export intacto (356/7/12/0/0), árbol idéntico al auditado. **Pendiente: inspección ocular de Simón** de las tarjetas Helio en móvil y desktop.
- Con esto, el GATE 0 del plan del motor (PR #36) queda cumplido.

## FASE 1 — Motor v1 «cuándo manejar» (a la orden de Simón)

- F1: spec autónoma fresca para la ronda ejecutora, anclada al SHA vigente, heredando los umbrales del repo (≥5 viajes, ≥2 fechas, ≥90% cobertura de duración).
- F2: implementación en rama aparte (`feat/reco-v1`); auditoría de implementación anclada a SHA.
- F3: QA visual (375×812 y 1280×900).
- F4: dictamen final + merge por Simón. Baseline de tests: solo crece.
- v2 (DiDi vs Uber) sigue bloqueada por INV-01/CORR-002.

## FASE 2 — Decisiones de Simón (paralelas, sin urgencia)

- `commission_pct` (CORR-002): habilita o descarta v2.
- Backfill de cobertura (INV-02/INV-03): pantallas de detalle TIRÓN para la cola documentada (101 + 26 viajes).
- INDET del 17/11 (INV-10) y normalización de los 27 km=0 legados (INV-11).
- Sesiones sincronizadas (INV-05): captura nueva si algún día se quieren horas conectadas.
- CORR-001 (test duplicado): apta para la próxima ronda ejecutora.

## Cadencia continua

- Cada PR de ejecución → dictamen SHA-anclado con condiciones de caducidad (protocolo con la ronda GPT).
- Cada ingest autorizada → re-verificación de conteos y actualización del inventario.
- Si el head de un PR auditado avanza → el dictamen caduca; re-anclar antes de opinar de nuevo.
- El inventario se re-versión tras cada merge o ingest significativa; los ítems cerrados se marcan, no se borran.

## Invariantes (no negociables)

1. Solo lectura por defecto; escrituras con autorización explícita de Simón.
2. Simón es el único decisor de merge y deploy.
3. Dictámenes con SHA exacto + condiciones de caducidad; reproducción independiente de cifras, nada «de oídas».
4. El auditor no edita código: las correcciones son especificaciones (CORR) para rondas ejecutoras.
5. Contrato completo de `AGENTS.md`: privacidad, sin PII, sin OCR libre, sin inferir datos faltantes.
6. Sin recomendaciones de negocio que la evidencia no respalde (facturación ≠ rentabilidad; con pasajero ≠ conectado).

## Métricas de vigilancia (en cada pasada)

- Cobertura de duración y km reales (hoy: 51,1% / 54,8%).
- Conteos y bruto del export fresco contra DATA-STATUS.
- Conteo de tests y duplicados conocidos (hoy: 185, uno duplicado).
- Estado de las CORR (hoy: 1 habilitada, 1 en decisión, 1 vigente).

**Anclaje:** `main@1e9c8a70` (2026-11-24). Caduca si `main` avanza o cambia el esquema; re-anclar al entrar a cada fase.
