# CORR-002 — Hueco de esquema: `commission_pct` no existe

**Estado:** decisión pendiente de Simón · **Severidad:** alta solo para v2 · **No bloquea** v1 del motor
**Anclaje:** `main@1e9c8a70` · **Caduca si:** el esquema de viajes cambia o se agrega el campo.

## Hallazgo

El campo `commission_pct` no existe en el esquema (`migrations/0001_initial_schema.sql`), en la whitelist de ingesta ni en el contrato (`AGENTS.md`). El plan del motor de recomendaciones (PR #36) deja explícito que la comparación DiDi vs Uber (v2) queda **bloqueada** por esta decisión de esquema previa e independiente: sin comisión observada o declarada por plataforma, cualquier comparación de rentabilidad entre plataformas sería una afirmación sin evidencia.

## Por qué importa

- Los montos registrados en el ledger son lo que el conductor cobra (driver amount). Para comparar plataformas hace falta saber qué parte retiene cada una — hoy no hay campo ni evidencia que lo respalde.
- Agregarlo «porque sí» violaría la regla del repo de no inferir datos faltantes.

## Opciones (decisión de Simón)

| Opción | Qué implica | Riesgo |
|---|---|---|
| A. Evidencia observada | Capturar comisiones desde estados de cuenta / pantallas de DiDi y Uber; ingest con whitelist nueva | Fuente de evidencia por definir; carga de captura |
| B. Constante declarada | Campo por plataforma con valor declarado por Simón y fecha de vigencia, documentado como supuesto | Un supuesto duro puede contaminar comparaciones si cambia |
| C. Diferir v2 | Mantener v1 («cuándo manejar») sin comparación de plataformas; reabrir cuando haya evidencia | Ninguno; v2 queda diferida |

## Próximo paso

Palabra de Simón sobre A/B/C. Con la opción elegida se escribe la spec de esquema correspondiente y sigue el circuito normal: spec → ronda ejecutora → auditoría SHA → merge por Simón.
