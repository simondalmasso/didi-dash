# Traducción formal del análisis de Sakana (2026-11-24)

**Autor del análisis:** Sakana — analista externo de Simón; escribe en japonés, dialecto de Kansai (aparece también en consensos multi-agente de otros repos de Simón, p. ej. stracker y aMira).
**Traducción:** GLM (auditor) · **Registro:** español formal neutro.
**Estado:** PARCIAL — la parte verificable está traducida y contrastada; el original íntegro no fue archivado y debe re-adjuntarse para completar la traducción literal (§4).

## 1. Qué es este documento

El 2026-11-24, durante la investigación del motor de recomendaciones (PR #36), Simón aportó un análisis externo de Sakana sobre Didi Dash y la pregunta del motor. El original estaba escrito en japonés con registro coloquial del dialecto de Kansai. Este documento es la traducción formal al español solicitada por Simón, con una limitación declarada de entrada: el texto original no quedó archivado en ningún archivo del repositorio ni del entorno de trabajo, y el contexto de la conversación donde llegó se perdió. Se traduce y contrasta todo lo que sobrevive de forma verificable; la traducción literal íntegra queda pendiente del original (§4).

## 2. Criterios de la traducción formal

- Registro formal neutro: el original usa japonés coloquial de Kansai; la traducción formal neutraliza el registro y conserva el contenido técnico.
- Nada se agrega: cada afirmación traducida indica su vía de recuperación (script de verificación o plan del motor).
- Cada cifra fue contrastada contra evidencia local en la pasada de hoy.

## 3. Parte recuperada — traducción formal

### 3.1 Afirmaciones sobre los datos del ledger

Las afirmaciones de datos del análisis, según quedaron registradas en el script de verificación `check_sakana_claims.py` (2026-11-24, solo lectura, escrito para contrastarlas), versaban sobre la cantidad de viajes y los valores del campo `platform` en cada export local. Traducción formal del contenido, con el contraste re-ejecutado el 2026-11-24:

| Afirmación (contenido recuperado) | Evidencia contrastada | Resultado |
|---|---|---|
| Los exportes locales contienen los volúmenes documentados de viajes | `scripts/data_fina_export.json` (export 2026-11-15T03:48Z) | ✓ 191 viajes |
| — | `scripts/data_fina_export_1511.json` (export 2026-11-15T04:22Z) | ✓ 209 viajes |
| — | `scripts/data_fina/datos.json` (corte 2026-11-15T04:22Z) | ✓ 209 viajes |
| — | `download/verificacion-datos-etios.json` | ✓ 86 viajes |
| Todos los viajes registrados corresponden a la plataforma DiDi | Campo `platform` de cada export | ✓ `didi` = 100% (191/191, 209/209, 209/209, 86/86) |
| Las recompensas registradas provienen del historial de DiDi | Campo `source` de `rewards` | ✓ 7 registros `didi_history` por export |

Contexto de producción al momento del análisis y hasta la tarde de hoy (export fresco 2026-11-24T06:58:18Z, post-despliegue de Helio): 356 viajes, 100% DiDi, bruto ARS 1.351.666, recompensas ARS 109.300, combustible ARS 380.000, 182/356 con duración (51,1%), 195/356 con km reales (54,8%; 760,7 km).

### 3.2 El punto metodológico adoptado

Del análisis se adoptó un punto de método, registrado con atribución explícita en el plan del motor de recomendaciones (`docs/plans/2026-11-24-motor-de-recomendaciones.md`, §4.4, PR #36):

> **Ventana de observación:** comparar las jornadas recientes del propio conductor contra las jornadas previas antes de sugerir intensificar o descansar. Aplicado a los datos propios del conductor, nunca a los de terceros.

En registro formal: antes de recomendar un cambio de ritmo (conducir más o descansar), el motor debe contrastar el rendimiento reciente del conductor contra su propio rendimiento previo — nunca contra promedios de terceros —, de modo que la sugerencia responda a una tendencia observada dentro del propio historial.

## 4. Lo no recuperado — original pendiente de re-adjunto

El texto original íntegro (japonés, dialecto de Kansai) no fue archivado. Búsqueda completa el 2026-11-24: issues del repo (0), comentarios de los PRs abiertos (los 5 del PR #31, ninguno del #36), código (GitHub Search API), commits, gists públicos y entornos de trabajo locales (búsqueda de texto japonés: sin resultados). Sobreviven únicamente las afirmaciones contrastadas (§3.1) y el punto adoptado (§3.2).

**Pendiente para completar la traducción:** que Simón re-adjunte el texto original. Con el original en mano, la traducción literal completa se produce en la misma pasada, se archiva aquí junto al original y queda a salvo de la pérdida de contexto.

## 5. Lección institucional

La pérdida del original motivó la CORR-003 (regla de archivo de análisis externos, vigente desde hoy): todo análisis externo que informe una decisión del repo se archiva íntegro en `docs/auditoria/traducciones/` con fecha, autor, idioma y SHA-256 del texto cuando llega pegado en chat.

## Anclaje y vigencia

- Escrito el 2026-11-24 contra `main@1e9c8a70` (post-merge Helio; árbol idéntico al auditado `50d99c9`).
- Las cifras de §3.1 refieren a exportes congelados (fechas citadas en la tabla) y no caducan. El contexto de producción (356/…) caduca en cuanto el ledger avance.
- Este documento no toca código, Worker, KV ni datos.
