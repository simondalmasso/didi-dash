# TIRÓN — Fase 1 del pipeline: mega-captura + OCR + costura de "Viajes" (DiDi Conductor)

TIRÓN extrae **todos los viajes de un tirón** desde la UI de Viajes de DiDi
Conductor con el filtro **TODO** aplicado: rafaga de screenshots por ADB,
OCR local (RapidOCR / modelos PP-OCR en ONNX) y costura con deduplicacion
entre frames. **Es la fase de adquisicion y evidencia del pipeline híbrido,
no un alimentador directo del Worker.**

```
A22 / DiDi
    │
    ├── FASE 1 · TIRÓN  (esta herramienta)
    │   captura TODO → OCR → costura → delta
    │   entrega: out/candidatos.csv  (preview clasificado, con evidencia)
    │
    ▼
importer del ledger vivo  (clasificacion / normalizacion / privacidad)
    │
    ▼
Worker /api/ingest?dry=1  (validar → commit)
    │
    ▼
Fase 2 (futura): abrir SOLO los detalles nuevos → desglose fino
(tarifa distancia / tiempo / base dinámica / diferencial / reembolso)
```

Division de responsabilidades (no se duplica logica financiera aca):

- **TIRÓN** = adquisicion + evidencia: dice *que viajes existen* y deja el
  frame redaccionado citado por fila. No normaliza moneda, no decide que
  es ingreso, no toca el Worker.
- **importer** = clasificacion: decide que entra, como se deduplica y que
  se sanea. TIRÓN solo entrega el preview `candidatos.csv`.
- **Fase 2 (selectiva)** = enriquecimiento: abre el detalle de los pocos
  viajes nuevos para el desglose real de ganancias.

**Que NO hace TIRÓN (reglas de juego):** sin root, sin interceptar trafico,
sin requests propios a ninguna API, sin modificar la app ni sus datos. La
unica interaccion con el telefono son screenshots y — solo con
`--auto-swipe` — swipes verticales sobre la lista (equivalente a scrollear
a mano). Todo el procesamiento es local: los datos nunca salen de la maquina.

## 0. Versiones

- **v1.3 (15/11):** validaci?n real completa en A22: 56 frames, 112 tarjetas, 5 fechas con viajes; delta contra export acotado al rango: 107 duplicados, 4 nuevos, 1 discrepancia, 0 faltantes. Sin ingest ni cambios del Worker.

- **v1.2 (15/11):** reconoce el timestamp real de tarjeta `DD/MM/YYYY, h:mm am/pm`, conserva ?nicamente esa caja segura y asocia fecha/hora con la fila de modalidad + monto. Muestra real A22: 8 frames, 18 tarjetas, 2 filas parciales sin hora por recorte de scroll; falta cubrir el rango completo.

- **v1.1 (15/11, noche):** multiplataforma — fuentes con cadena de candidatos (Linux DejaVu → Windows Arial → macOS → fallback de PIL), stdout/stderr en UTF-8 y `subprocess` con encoding explícito en los tests. Sin cambios de lógica de captura/OCR/costura. Re-validada en Linux: demo 46/46, e2e PASS, stitch PASS.
- **v1.0 (15/11):** validada en Linux por GLM y en Windows/Python 3.13 por ARQ (demo 46/46 duplicados, e2e PASS recall 100%, stitch PASS — con ajustes locales de fuentes/encoding que v1.1 incorpora de serie).

## 1. Requisitos

- Python 3.9+ (probado en 3.12 Linux y 3.13 Windows)
- `adb` en el PATH (Android platform-tools actualizado)
- Telefono conectado por USB con depuracion USB autorizada
- Dependencias:

```bash
pip install -r requirements.txt
```

(trae `rapidocr` + `onnxruntime`; los modelos OCR vienen incluidos en el
paquete, no descargan nada al correr).

## 2. FASE 0 — validar antes de la captura completa

**2a. Sin telefono (demo sintetica incluida en el zip):**

```bash
python tiron.py all --sesion demo --hoy 2026-11-15 --export demo/ground_truth.csv
```

Esperado: 46/46 duplicados, 0 nuevos, 0 discrepancias. Con esto se prueba
que la instalacion (rapidocr/onnxruntime) funciona en la maquina.
Extra: `python test_privacy.py` valida redaccion/allowlist; `python test_e2e.py` corre la validacion automatica completa y
`python test_stitch_cases.py` los casos de ambigüedad (los tres deben dar PASS).

**2b. Con el telefono (muestra real de ~8 frames):**

1. Usuario abre DiDi → Viajes → filtro **TODO** → lista arriba del todo.
2. Capturar una muestra corta:

```bash
python tiron.py capture --sesion muestra --auto-swipe --max-frames 8
```

3. Procesar y SONDEAR el layout real:

```bash
python tiron.py all --sesion muestra --hoy <fecha-de-hoy>
python tiron.py rows --sesion muestra --frame 2
```

4. La UI actual presenta fecha y hora juntas (`DD/MM/YYYY, h:mm am/pm`) y la modalidad + monto en la fila siguiente. Verificar en `muestra/out/ledger.csv` que fecha/hora/tipo/monto se parsean
   bien sobre la UI real. Si algo no cierra, mandar la salida de `rows` a
   GLM para ajustar los patrones (al tope de `tiron.py`: `RE_HORA`,
   `RE_MONTO`, `parse_fecha_header`, `clasificar_fila`, `MODALIDADES`).
   **Recien despues de esto, capturar completo.**

## 3. FASE 1 — captura completa con filtro TODO

```bash
# automatico: scrollea solo hasta el final de la lista
python tiron.py capture --sesion sesion_todo --auto-swipe

# manual: el usuario scrollea despacio, Ctrl+C corta
python tiron.py capture --sesion sesion_todo
```

```bash
python tiron.py all --sesion sesion_todo --hoy <fecha-de-hoy> --export <export_ledger_vivo.csv>
```

- `--auto-swipe` se frena solo tras N frames sin cambios (`--stop-dups`,
  default 3) o al llegar a `--max-frames` (default 500).
- Frames identicos consecutivos se descartan solos (hash de la zona central,
  ignora la barra de estado).
- Utiles: `--serial <id>`, `--paso 0.42`, `--settle 0.8`, `--append`.

## 4. Salidas (en `<sesion>/out/`)

### `candidatos.csv` — EL HANDOFF para el importer

Una fila por tarjeta vista, con la clasificacion lista para consumir:

| columna | contenido |
|---|---|
| fecha, hora | del encabezado y la tarjeta (ISO, HH:MM) |
| tipo, tipo_canon | texto tal cual lo leyo el OCR + modalidad canonica (express/auto/taxi/...) |
| detalle | sublinea visible (km/min) si existe |
| monto_raw, monto_num | tal cual la UI ("4.800") y en digitos (4800) |
| conf_ocr | confidence promedio de la fila |
| fecha_confiable | si/no — si el encabezado de fecha estaba visible en ese frame |
| frame, y | **evidencia visual**: que frame y en que posicion |
| estado | ok / ambiguous / revisar / descartado_* (interno del stitch) |
| clasificacion | **nuevo / duplicado / discrepancia / ambiguous / revisar / descartado / sin_comparar** |

- `nuevo` → candidato a insertar (pasa a Fase 2 / dry-run).
- `duplicado` → ya esta en el ledger vivo, no tocar.
- `discrepancia` → misma fecha+hora con monto distinto (ajuste u OCR): revisar.
- `ambiguous` → colision de firma sin resolver: **no se deduplico**, decidir a mano.
- `sin_comparar` → no habia export para comparar.

### Archivos internos

| archivo | contenido |
|---|---|
| `ledger.csv` | registro interno de adquisicion (todo, con estado; base de candidatos.csv) |
| `resumen.txt` | totales, viajes por fecha, suma de montos |
| `filas_sin_parsear.csv` | frame, motivo y posición; nunca texto OCR libre |
| `delta/nuevos.csv`, `delta/duplicados.csv`, `delta/discrepancias.csv`, `delta/faltantes_en_ui.csv` | detalle del cruce contra el export |

## 5. Firma de deduplicacion (v2) y politica `ambiguous`

La firma de una tarjeta es **(fecha, hora, monto en digitos, modalidad
canonica)**. El tipo se canoniza para que el ruido de OCR ("DID1Auto" vs
"DiDi Auto") no genere duplicados falsos. Politica de conflictos:

- Misma firma en frames solapados (scroll normal) → se deduplica; si un
  lado tenia tipo desconocido, adopta el conocido.
- Misma (fecha, hora, monto) con **modalidad distinta** → NO se deduplica:
  ambas quedan `ambiguous` para decision humana/importer.
- Misma firma completa **dos veces en el mismo frame** → son dos viajes
  distintos: ambas `ambiguous`.
- La suma de montos y los conteos por fecha salen en `resumen.txt` para
  control cruzado rapido.

## 6. Notas de rendimiento

- Captura: ~1-2 s/frame. Un mes de viajes (~150 tarjetas) ≈ 2-3 min en auto.
- OCR: ~2-3 s/frame en CPU (la primera corrida carga modelos, ~5 s extra).
- Todo resumible: `ocr` siempre reprocesa los frames, regenera JSON allowlist y redacciona entradas; `capture --append`
  sigue numerando.

## 7. Troubleshooting

| problema | solucion |
|---|---|
| `adb no esta en el PATH` | instalar platform-tools y agregarlo al PATH |
| varios dispositivos | `--serial <id>` (ver `adb devices`) |
| `screencap fallo (rc=...)` | actualizar platform-tools (exec-out viejo) |
| export con columnas raras | forzar: `--col-fecha X --col-hora Y --col-monto Z` |
| montos sin `$` | el parser acepta `$4.800` y `ARS 4.800`; el matching contra el export es por digitos |
| fechas desplazadas un año | pasar `--hoy` correcto (la inferencia asume scroll hacia atras) |
| OCR lento | normal en CPU; `ocr` es resumible, correr por partes |

## 8. Limitaciones conocidas

- El monto se compara por digitos sin separadores: coincide entre UI y
  export mientras ambos usen el mismo formato de moneda.
- Dos viajes con fecha, hora, monto Y modalidad identicos en frames
  distintos se deduplican como uno (caso extremo; el conteo por fecha del
  resumen lo delataria).
- La captura asume scroll monotonico hacia abajo; si se scrollea para
  arriba y abajo, el dedupe por firma mantiene la primera aparicion.
- La lista solo expone fecha/hora/modalidad/importe/detalle visible: el
  desglose fino de ganancias (tarifa distancia, tiempo, base dinamica,
  diferencial, reembolso) requiere la Fase 2 sobre el detalle individual.


## 9. Privacidad y redacción

- capture procesa cada PNG bruto en memoria, aplica OCR y persiste solo un frame enmascarado con las cajas permitidas restauradas.
- ocr sustituye primero la entrada de disco por una versión completamente enmascarada, vuelve a procesarla en memoria y regenera siempre los JSON con solo fecha, hora, modalidad, monto y km/min numéricos.
- Texto desconocido, direcciones y teléfonos se descartan. filas_sin_parsear.csv no lleva texto; contiene solo frame, motivo y posición.
- Validar con python test_privacy.py antes de usar el teléfono. Los PNG redaccionados y carpetas de sesión se borran al cerrar la pasada.


## 10. Frontera de ejecución y Git

- Antes de operaciones Git, comprobar `whoami` y que el proceso se ejecute como el propietario del checkout. En este equipo, el contexto autorizado es `DESKTOP-DPH3941\Simon`.
- SentinelX se ejecuta como `NT AUTHORITY\SYSTEM`. Usarlo para ADB, captura/OCR y observación permitida, nunca para Git sobre el checkout de Simon.
- No agregar `safe.directory` a la configuración global de SYSTEM, no cambiar la propiedad del repositorio y no intentar resolver el rechazo de Git desde esa identidad.
- Si la sesión propietaria no está disponible, detener la operación Git. No usar SentinelX como sustituto.

## 11. Estado persistente y digestos diarios

El watermark reside fuera del repo en `C:\Temp\didi-dash-evidence\state\watermark.json`. Solo representa el último viaje importado en un Confirm cuya exportación posterior fue reconciliada. Un digest debe registrar los cinco contadores antes/después (trips, rewards, fuel, sessions, withdrawals), importes brutos/cargas, delta nuevo por fecha, resultado Preview/Confirm, health/truncation, watermark, avance de kilometraje y SHA-256 del backup POST vigente. No fabricar una corrida ni adelantar watermark si ADB, app, PC o evidencia no están disponibles.

Objetivo horario elegido: 08:00, America/Argentina/Cordoba. La recurrencia de ChatGPT es flexible y no garantiza el minuto exacto. La primera ejecución autónoma debe validar el acceso real al PC y al A22; un entorno heredado sin equipo asignado no se considera prueba de automatización.

El Confirm se ejecuta exclusivamente por POST autenticado a `/api/ingest`, tras Preview exacto y backup PRE. No requiere el botón Confirm del dashboard. Si un gate de seguridad bloquea el lanzamiento del proceso, registrar el mensaje literal, no eludirlo y no afirmar que la ingesta se ejecutó. Tras una respuesta Confirm ambigua, no repetir POST: reconciliar con un export fresco.

### Digest mínimo obligatorio

1. Timestamp local, estado PC/ADB/A22 y rango visible de historial.
2. Watermark anterior y posterior; viajes nuevos por fecha e importe ARS.
3. Conteos antes/después de las cinco colecciones y nuevos registros de rewards/fuel/sessions/withdrawals.
4. Preview y Confirm: received/inserted/updated/duplicates/ambiguous por colección.
5. SHA-256 de evidencia/manifiesto, payload y backups PRE/POST.
6. Health, truncation, kilometraje real/nulo/ceros desconocidos y backfill pendiente.
7. Bloqueos y causa exacta; si no hubo cambios, indicarlo expresamente.
