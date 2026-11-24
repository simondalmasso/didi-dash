# CORR-001 — Consolidar el test duplicado de retiros

**Estado:** propuesto (requiere aprobación de Simón) · **Severidad:** baja · **Ejecución:** ronda ejecutora (GPT) · **Verificación:** GLM
**Anclaje:** `main@1e9c8a70` · **Caduca si:** cambia el contenido de `test/dashboard-entry-controls.test.mjs`.

## Hallazgo

El test `withdrawal dashboard distinguishes missing evidence from a zero fee` aparece **dos veces** en `test/dashboard-entry-controls.test.mjs` (verificado con `git grep` en main: líneas 7 y 8). Es deuda preexistente: ya estaba duplicado en `main@8543728`, en `46958a7` y en `6c6ddb8`; los dictámenes del PR #31 (#7123586766 y #7124201850) lo reportaron como no bloqueante en ambas pasadas.

## Impacto

- Infla el conteo de pruebas: el «185/185» vigente incluye ambas copias; hay 184 pruebas distintas.
- `node:test` lo tolera y ambas copias pasan: no hay riesgo de falla, solo de conteo y de ruido.

## Especificación de la corrección (para la ronda ejecutora)

1. Eliminar **una** de las dos copias idénticas del test. No tocar ninguna otra aserción del archivo.
2. Correr `npm test`: la suite debe quedar verde con **184/184** (una prueba menos, ninguna nueva).
3. `git grep -c "distinguishes missing evidence from a zero fee" test/` debe devolver exactamente 1.
4. Commit atómico con mensaje claro (p. ej. `test: consolidate duplicated withdrawal evidence test`).

## Timing

El gate original (aplicar después del merge de Helio) ya se cumplió: Simón mergeeó el PR #31 el 2026-11-24 06:46:51Z y el deploy fue success. La corrección está **habilitada** para la próxima ronda ejecutora, con aprobación previa de Simón. Tras aplicarla, el siguiente dictamen re-ancla la baseline en 184/184.

## Aceptación

- Suite verde 184/184; una sola ocurrencia del test; `git diff --stat` = 1 archivo; ninguna otra aserción modificada.
