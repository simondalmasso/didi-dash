# Extracción desde el teléfono (A22) — procedimiento operativo

**Estado al 16/11/2026:** el pipeline TIRÓN está validado de punta a punta sobre frames sintéticos, en dos sistemas operativos (Linux y Windows/Python 3.13): demo 46/46 duplicados, e2e recall 100% sin viajes fantasma, costura PASS. **La muestra real de 8 frames sobre la UI del teléfono sigue pendiente: es el gate obligatorio antes de la primera captura masiva.** La validación sintética no reemplaza esa muestra.

Este documento es el punto de entrada para cualquier agente que necesite extraer viajes del teléfono. La verdad operativa del ledger sigue siendo el Worker (`GET /api/export`); la extracción es solo su fuente de alimentación. Antes de tocar el ledger, leer `AGENTS.md` y `docs/DATA-STATUS.md`.

## 1. Veredicto de fuentes — no volver a sondear

La investigación de fuentes estructuradas está **cerrada con evidencia (15/11/2026)**: no existe una vía estructurada exportable por ADB sin privilegios en la instalación actual (DiDi Conductor 7.10.70, Android 11, SM-A225M).

| Vía | Resultado |
|---|---|
| `run-as` / datos internos `/data/user/0` | Bloqueado (build release; sin root no hay acceso) |
| `adb backup` | `allowBackup=false` en el manifest decodificado |
| Content providers | `DataProvider` y `FileProvider` `exported=false`; `ShareProvider` exportado pero sin evidencia de que entregue viajes (no consultado) |
| Almacenamiento externo app-scoped | Solo recursos H5 (JS/CSS/HTML); sin bases ni CSV de viajes |
| Capa interna (strings de `libapp.so`) | Existe (`sqflite`, `historyOrders/getDataList`) pero requiere el contexto de autenticación de la app; no es accesible y no debe invocarse |

**TIRÓN — captura de la UI visible + OCR local — es la única vía operativa.** Re-sondear esas vías es trabajo desperdiciado.

## 2. Piezas

| Pieza | Dónde | Rol |
|---|---|---|
| TIRÓN v1.1 | `scripts/tiron/` | Adquisición: ráfaga de screenshots por ADB + OCR local (RapidOCR/ONNX) + costura con deduplicación. Detalle completo de comandos y salidas: `scripts/tiron/README_RUNBOOK.md` |
| A22 + DiDi Conductor | Teléfono de Simon, conectado por USB | Fuente: Historial de viajes con filtro **TODO** |
| Diálogo Importar del dashboard | Home desplegada | Commit: whitelist de campos, preview `?dry=1`, confirmación explícita (reglas en `AGENTS.md`) |

TIRÓN no hace requests propios, no intercepta tráfico, no modifica la app ni el teléfono: la única interacción son screenshots y, con `--auto-swipe`, swipes verticales equivalentes a scrollear a mano. Todo el procesamiento es local. Las capturas originales y el OCR irrestricto existen solo en memoria; nunca se escriben a disco.

## 3. Flujo de punta a punta

### Precondiciones

- `adb devices -l` muestra el SM-A225M autorizado (estado `device`, no `unauthorized`).
- DiDi Conductor abierto y logueado, en **Viajes → filtro TODO → lista arriba del todo**.
- El día objetivo está cerrado (extraer después del último viaje del día).
- Batería ≥ 30%. Python 3.9+ con `pip install -r scripts/tiron/requirements.txt`.
- Regla de privacidad activa desde el inicio (§5).

### Paso 1 — validación sin teléfono (una vez por máquina)

```sh
cd scripts/tiron
python test_privacy.py && python test_stitch_cases.py && python test_e2e.py
```

Los tres deben dar PASS. test_privacy.py valida la lista blanca OCR, la regeneración de JSON antiguos y el difuminado de frames. Generan sus propios frames sintéticos: no dependen del teléfono ni de PNG de demo (que no están commiteados; la demo del runbook se regenera con `make_synthetic_frames.py`).

### Paso 2 — muestra real de 8 frames (gate obligatorio, una vez)

```sh
python tiron.py capture --sesion muestra --auto-swipe --max-frames 8
python tiron.py all --sesion muestra --hoy <hoy>
python tiron.py rows --sesion muestra --frame 2
```

Verificar en `muestra/out/ledger.csv` que hora/tipo/monto se parsean sobre la UI real. Si algo no cierra, ajustar los patrones al tope de `tiron.py` (`RE_HORA`, `RE_MONTO`, `parse_fecha_header`, `clasificar_fila`, `MODALIDADES`) y repetir la muestra. **No capturar completo antes de que esto cierre.**

### Paso 3 — captura completa

```sh
python tiron.py capture --sesion sesion_todo --auto-swipe
python tiron.py all --sesion sesion_todo --hoy <hoy> --export <export_del_ledger.csv>
```

El export del ledger se obtiene de `GET /api/export` y se convierte a CSV con columnas fecha, hora, tipo, monto (el parser de TIRÓN también acepta remapeo con `--col-fecha/--col-hora/--col-monto`). La corrida entrega `sesion_todo/out/candidatos.csv` clasificado: `nuevo` / `duplicado` / `discrepancia` / `ambiguous` / `descartado`.

### Paso 4 — armado del envelope

Formato: colecciones de `POST /api/ingest` (ejemplo completo en el README, sección *Private ingestion*).

- Solo filas `nuevo` → `trips` con `{"date", "start", "amount", "platform": "didi", "source": "didi_history"}`.
- `discrepancia` → revisar a mano antes de incluir: ¿ajuste real de DiDi o error de OCR? Nunca sobrescribir silenciosamente.
- `ambiguous` → decisión humana; el Worker no fuerza merges y los cuenta aparte.
- `duplicado` → no tocar.
- Límite: 500 registros totales por request.

### Paso 5 — Fase 2 selectiva (enriquecimiento de detalles)

Abrir **solo** los viajes nuevos o pendientes de detalle y transcribir de la pantalla de detalle: km (`km` + `km_source: "actual"`), duración (`min` y `duration_seconds`), `service_type`/modality y desglose canónico (`breakdown` con los seis códigos de `docs/DATA-FINA-SCHEMA.md`, `source: "actual"`, reconciliación dentro de ARS 2). El enriquecimiento viaja como `source: "didi_history_detail"` en el mismo envelope.

**Regla de pantalla:** la pantalla de detalle muestra direcciones de origen/destino. Recortar la captura a la zona numérica o descartar el PNG inmediatamente después de transcribir. Nunca persistir un frame de detalle con direcciones.

### Paso 6 — commit vía dashboard

Home → **Importar** → seleccionar el JSON del envelope → preview `?dry=1` → revisar conteos por día, clasificaciones y ambiguos → confirmar. El `INGEST_TOKEN` lo entra Simon en el diálogo; vive solo en memoria durante la sesión del diálogo (regla de `AGENTS.md`).

### Paso 7 — verificación y registro

- `GET /api/export` antes y después: delta exacto, 0 duplicados no esperados, `truncated=false` en todas las colecciones.
- Actualizar `docs/DATA-STATUS.md` con el snapshot nuevo: fecha, endpoints, conteos, cobertura por campo y por día, procedencia.
- Borrar las sesiones de TIRÓN (`muestra/`, `sesion_todo/`) una vez confirmado el commit: son evidencia transitoria, no artefactos del repo.

## 4. Rendimiento esperado

Captura ~1–2 s/frame (auto-swipe); OCR ~2–3 s/frame en CPU. Un mes de historial (~200 tarjetas) ≈ 35–40 frames ≈ 2–3 min de captura + ~2 min de OCR.

## 5. Privacidad (no negociable)

- Las capturas originales y el OCR irrestricto se procesan en memoria únicamente.
- Antes de ejecutar OCR sobre un frame de disco, TIRÓN reemplaza primero su copia por una imagen completamente enmascarada. El OCR se ejecuta sobre la imagen original en memoria y luego se guarda una versión enmascarada que restaura únicamente las cajas permitidas: fecha, hora, modalidad, monto y detalle estrictamente numérico km/min.
- Los JSON OCR contienen exclusivamente cajas permitidas y se regeneran en cada corrida; no se confían cachés anteriores. ledger.csv y candidatos.csv contienen campos normalizados. filas_sin_parsear.csv conserva solo frame, motivo y posición, nunca texto OCR libre.
- Prohibido persistir o enviar: nombres, teléfonos, direcciones, coordenadas, notas o chats de pasajeros (contrato completo en AGENTS.md).
- Los frames enmascarados y las carpetas de sesión son evidencia transitoria: borrarlos al cerrar la pasada y nunca incluirlos en el repositorio.
- Chequeo pre-commit: el envelope no debe contener cadenas tipo dirección, teléfono (+54), email o pares de coordenadas.

## 6. Limitaciones conocidas

- La lista expone fecha/hora/modalidad/importe: el desglose fino y el estado del viaje requieren la Fase 2 por viaje.
- Dos viajes con firma idéntica (fecha+hora+monto+modalidad) en frames distintos se deduplican como uno; el conteo por fecha del `resumen.txt` lo delata.
- La captura asume scroll monótono hacia abajo.
- La retención del historial en la app no está documentada por DiDi: la ventana visible es la ventana extraíble.
