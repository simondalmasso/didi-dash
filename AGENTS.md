# AGENTS.md — didi-dash

## Propósito
Dashboard financiero y operativo para un chofer DiDi en Argentina. Los datos deben conservar trazabilidad: el ledger es la fuente de verdad y la UI nunca inventa valores faltantes.

## Arquitectura
- Cloudflare Worker + KV.
- Frontend vanilla HTML/CSS/JS, sin build.
- Tests con `node:test`.
- No agregar dependencias sin una justificación técnica concreta.

## Contrato de API
Lectura pública:
- `GET /api/trips`
- `GET /api/rewards`
- `GET /api/fuel`
- `GET /api/sessions`
- `GET /api/export`

Escritura:
- `POST /api/ingest` es el único contrato privado de ingestión.
- Requiere token de ingestión. Nunca exponer el secreto en HTML, repositorio, logs o documentación.
- La escritura debe seguir siendo idempotente y preservar provenance de los campos.

## Reglas de datos
- Ausencia de dato no significa cero.
- No inventar ni completar como hechos kilómetros, duración, horarios o zonas.
- Cualquier valor derivado debe estar marcado como derivado y conservar su método.
- Mostrar cobertura con numerador/denominador cuando sea parcial.
- Antes de cambiar datos o métricas, leer `docs/DATA-STATUS.md`.

## Auditoría post-importación
1. Obtener la verdad viva desde `/api/trips` y `/api/export`.
2. Confirmar que las colecciones del export no estén truncadas.
3. Calcular cobertura por día para: fecha/hora, importe, plataforma, km, duración y zonas.
4. Mantener zonas separadas como `pendiente GPS` cuando la fuente DiDi no las entregue.
5. No declarar un día “100% verificado” si faltan campos requeridos para esa certificación.
6. Si existe modo preview/dry-run, usar el mismo parser y deduplicación del Worker antes de una escritura real.

## Estado operativo
El snapshot humano para agentes está en `docs/DATA-STATUS.md`. No tratar ese archivo como fuente de verdad en tiempo real: la fuente viva es el ledger expuesto por las APIs de lectura.
