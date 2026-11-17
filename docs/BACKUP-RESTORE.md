# Backup y restauración del ledger

## Por qué

Todo el ledger vive en **un único valor KV** (binding `DATA`, clave `ledger:v1`, tope 25 MiB). No hay historial de versiones: si un import escribe datos equivocados o el valor se corrompe, no existe deshacer. El único disco de seguridad es una copia externa tomada **antes** de que algo falle.

**Regla operativa:** después de cada sesión de ingest autorizada (y antes de restaurar o experimentar), correr `npm run backup`. El script descarga `GET /api/export`, valida que ninguna colección esté truncada, guarda `backups/ledger-<UTC YYYYMMDD-HHMMSS>.json` e imprime conteos y sha256. Si la validación falla, **no escribe ningún archivo** (un backup parcial es peor que ningún backup: parece completo).

- `backups/` está en `.gitignore`: el repositorio es público y el backup es la información financiera completa. Copiar cada archivo a otro soporte (nube personal, otra máquina): regla 3-2-1 — tres copias, dos soportes distintos, una fuera de casa.
- Un backup confiable tiene: las cinco colecciones presentes, `truncated` todo `false`, y conteos consistentes con lo esperado tras la última sesión.
- Contra otro entorno: `npm run backup -- --url http://localhost:8787` (wrangler dev) o variable `DIDI_DASH_URL`.

## Restauración

### Nivel 1 — KV legible, error lógico (merge equivocado, registros borrados)

Re-importar el último backup bueno desde el diálogo **Importar** de `/trips/`: preview dry-run → confirmar. El importador acepta el formato de export y los IDs deterministas hacen que lo ya presente se deduplicque en lugar de duplicarse. Es un merge, no un reemplazo: no pierde lo ingresado después del backup.

Verificación post-restauración:

1. `npm run backup` de nuevo y comparar conteos por colección con el backup de referencia.
2. Repetir la importación en dry-run: debe reportar todo como duplicado (idempotencia).

### Nivel 2 — KV ilegible (el valor está corrupto o vacío)

Solo cuando no queda nada que rescatar del valor actual. Requiere credenciales de Cloudflare (wrangler) y autorización explícita: pisar `ledger:v1` **reemplaza el estado completo**.

`readLedger` acepta un objeto con las colecciones `trips`, `rewards`, `fuel`, `sessions`, `withdrawals`; las claves extra del export (`schema_version`, `exported_at`, `truncated`) se ignoran sin daño, así que el propio archivo de backup sirve directo:

```sh
npx wrangler kv key put "ledger:v1" \
  --namespace-id <id listado en wrangler.jsonc> \
  --path backups/ledger-<stamp>.json --remote
```

Después: `GET /api/health` → `storage: "kv"`, luego `npm run backup` de verificación y comparación de conteos con el archivo restaurado.

### Qué NO hacer

- No aplicar Nivel 2 sobre un ledger que cambió después del backup sin antes exportar el estado actual: se perderían los registros nuevos. En ese caso, Nivel 1 (merge).
- No editar a mano el JSON del backup para "arreglar" registros: la corrección entra por re-ingest del registro correcto.
- No subir backups al repositorio ni pegarlos en chats: contienen el historial financiero completo.

## Frecuencia y retención sugeridas

- Un backup tras cada sesión de ingest (el script lo hace trivial).
- Conservar al menos: los últimos 5, más uno por cierre de mes, más el previo a cualquier operación de Nivel 2.
