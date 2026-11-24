# CORR-003 — Regla: archivar originales de análisis externos

**Estado:** vigente (institucionalizado el 2026-11-24 con este espacio) · **Severidad:** media (proceso) · **Ejecución:** cumplida por el propio auditor
**Anclaje:** `main@1e9c8a70`

## Hallazgo (motivación)

El original del análisis de Sakana (2026-11-24, japonés dialecto de Kansai) llegó pegado en la conversación y **nunca se archivó**. La conversación perdió contexto y el texto original quedó irrecuperable (búsqueda completa: issues, comentarios de PR, código, commits, gists públicos y entornos de trabajo locales — ver `traducciones/2026-11-24-analisis-sakana.md` §4). Solo sobreviven las afirmaciones que el script de verificación contrastó y el punto metodológico adoptado en el plan del motor.

## Regla nueva (vigente desde hoy)

Todo análisis externo (Sakana, Gemini, Qwen u otro agente) que informe una decisión de este repositorio se archiva en `docs/auditoria/traducciones/` — o en el subdirectorio que corresponda — con:

1. Fecha de recepción y autor.
2. Idioma y registro del original.
3. **Texto original íntegro** en un archivo (`.md` o `.txt`).
4. SHA-256 del texto cuando llega pegado en chat (integridad verificable).
5. La traducción oficial, cuando se pida, se produce **contra el archivo archivado**, nunca contra la memoria de la conversación.

## Alcance

- No aplica a evidencia de ingesta (esa sigue por `docs/DATA-STATUS.md` y los procedimientos de TIRÓN con su régimen de privacidad).
- No aplica a material con PII: si un análisis externo contuviera datos de pasajeros, se aplica primero el contrato de privacidad de `AGENTS.md` y se archiva solo la versión saneada, con nota de lo recortado.
