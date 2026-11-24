# ADR-2026-11-21 — Delegación de ingesta a GPT

- **Estado:** Aceptado con ejecución condicionada por gates
- **Fecha:** 2026-11-21
- **Responsable de decisión y revocación:** Simón
- **Alcance:** operación incremental de lectura ADB/OCR de DiDi Conductor y envío de registros validados al endpoint autenticado de ingesta de didi-dash.

## Decisión

Simón autoriza a GPT a preparar y ejecutar la ingesta de evidencia de viajes y gastos de DiDi únicamente mediante el flujo canónico de `POST /api/ingest`. La automatización no adquiere autoridad para modificar el almacenamiento directamente ni para alterar la lógica del Worker.

La ejecución exige export completo, comparación del baseline, Preview autenticado, ausencia de duplicados y ambigüedades, backup PRE con SHA-256, Confirm, export posterior reconciliado y backup POST con SHA-256. Si cualquier gate falla o el resultado difiere de lo esperado, la operación se detiene sin reintentos ciegos.

## Custodia de credenciales

- El secreto `INGEST_TOKEN` se conserva en Windows Credential Manager, bajo el target local `didi-dash/INGEST_TOKEN`, y como Worker secret en Cloudflare.
- GPT puede leer la credencial local únicamente en memoria durante una operación autorizada. Está prohibido imprimirla, mostrarla, copiarla a archivos, incluirla en logs o transmitirla en mensajes.
- La longitud observada en Credential Manager el 2026-11-21 fue de **43 caracteres**. El valor no se incorporó a este documento ni a ningún artefacto.
- La autenticación ya había sido probada conductualmente: petición sin credencial rechazada con HTTP 401 y Preview autenticado aceptado con HTTP 200.
- GPT no tiene autoridad para rotar, crear ni reemplazar el secreto.

## Evidencia y calidad de datos

- La lectura de DiDi se realiza con ADB y captura de pantalla/OCR local, sin depender del árbol UIAutomator de Flutter.
- Por registro se conserva evidencia operativa saneada y su SHA-256 antes de construir el payload. No se persiste OCR libre ni datos personales de pasajeros.
- Fecha, hora, importe, kilometraje y duración deben provenir de evidencia observable. Un valor desconocido o null no se transforma en cero ni se estima.
- El backfill de kilometraje solo puede cambiar null a un valor real respaldado por detalle visible, evidencia saneada y hash. No puede sobrescribir valores existentes.
- Los 101 registros nuevos con km null y los 27 registros antiguos del 2026-11-03 con km=0/km_source=unknown se mantienen como poblaciones distintas.

## Límites de autoridad

Quedan fuera de esta delegación:
- escrituras directas a KV o cualquier bypass del endpoint autenticado;
- peticiones al endpoint sin token;
- exposición o rotación de credenciales por GPT;
- reimportación de los 107 viajes ya presentes en producción;
- cambios de lógica, dependencias, configuración o despliegues;
- reescritura Git, CLEAN1, modificaciones del PR #31/Helio o cambios de Horas;
- modificación de datos sin Preview, backup, Confirm y reconciliación posterior.

## Revocación

Simón conserva la autoridad exclusiva para revocar la delegación. La revocación inmediata se ejecuta rotando `INGEST_TOKEN` en el Worker de Cloudflare; esa rotación invalida la credencial previamente almacenada. La actualización de Windows Credential Manager, si corresponde para una delegación futura, también queda bajo control de Simón. GPT no debe realizar ninguna de esas operaciones por iniciativa propia.

## Automatización

La tarea diaria se programó con objetivo flexible alrededor de las 08:00 (hora de Argentina). La plataforma no garantiza un minuto exacto en recurrencias. Cada corrida debe comprobar PC, ADB y A22 al inicio; si el equipo o el dispositivo no están accesibles, debe terminar sin cambiar el watermark ni afirmar que hubo ingesta. La primera corrida prevista es 2026-11-22.

## Estado de producción al aprobar este ADR

El último export en vivo verificado para esta decisión contiene 316 viajes, 7 recompensas, 10 combustibles, 0 sesiones, 0 retiros y ARS 300.000 en combustible. La carga YPF del 2026-11-21 por ARS 40.000, con hora null, sigue pendiente de Confirm y reconciliación. Este ADR no declara esa carga completada.

**Aprobación:** autorización explícita de Simón en conversación, 2026-11-21. Este registro documenta el alcance acordado; no es una firma digital criptográfica.


## Addendum sxc_DAILY4 — autoridad y estado de operación (2026-11-22)

Este addendum actualiza el snapshot operativo de la aprobación original; no borra el historial del 2026-11-21.

### Confirm verificado

La corrida incremental del 2026-11-22 envió 26 viajes y 1 combustible por el endpoint canónico. Preview HTTP 200; Confirm HTTP 201; inserted=27, updated=0, duplicates=0, ambiguous=0. El export post-Confirm verificó 342 viajes, 7 recompensas, 11 combustibles, 0 sesiones, 0 retiros y ARS 340.000 de combustible; las cinco colecciones completas y Health/KV operativo.

El registro YPF del 2026-11-21 es ARS 40.000. Hora, litros y odómetro siguen null porque no se observaron. Backup PRE SHA-256: `ad4732410560794096ff6040893501193c964279d88c0a4b18c517b2d5be2d71`. Backup POST SHA-256: `f184d722f7b8cb2a765b28a11e95941ecff910ab8001fecdcd8fe2f292abb0a9`.

### Re-medición de custodia

El 2026-11-22 se volvió a medir el tamaño de la credencial protegida: **43 caracteres**. Solo se reportó la longitud; el secreto no se reveló, persistió ni rotó.

### Watermark

Estado persistido fuera del repo: `C:\Temp\didi-dash-evidence\state\watermark.json`. Último viaje importado y verificado: **2026-11-22 00:14**, ID `17e150e0b9c6584b0ade6d5a913b29e79f7f0a1b1c007d047e3da758e5e6878f`. El watermark solo avanza después de Confirm y export reconciliado.

### Operación diaria

Objetivo horario seleccionado: **08:00, America/Argentina/Cordoba**, desde 2026-11-23. El programador de ChatGPT marca el horario como flexible; no garantiza minuto exacto. La tarea visible `Didi Daily Ingest` tiene entorno heredado sin PC asignada y no cuenta con primera corrida autónoma verificada. El intento de actualizarla devolvió `This task is no longer available.`; no se generó otra tarea duplicada. La ejecución autónoma diaria sigue condicionada a resolver la disponibilidad del entorno.

La operación de Confirm no requiere el botón Confirm del dashboard: se ejecuta POST directo con Bearer leído desde Windows Credential Manager en memoria. En la primera operación, el lanzamiento del proceso fue bloqueado por el control de herramientas de OpenAI con el mensaje `Los controles de seguridad de OpenAI bloquearon esta llamada a la herramienta. Verifica nuevamente lo que estás intentando enviar.`; se completó luego de aprobación en el panel de revisión de Desktop Commander. Por consiguiente, la ruta directa HTTP está probada, pero la ejecución futura sin intervención ante un gate de seguridad no está garantizada.

### Frontera Git

Git debe ejecutarse exclusivamente desde la sesión del usuario propietario del checkout, comprobada como `DESKTOP-DPH3941\Simon`. SentinelX opera como `NT AUTHORITY\SYSTEM` y no debe ejecutar Git contra este repositorio. No registrar `safe.directory` para SYSTEM, no cambiar la propiedad del checkout y no reescribir historial para resolver el aislamiento.

### Revocación

Simón mantiene la autoridad exclusiva de revocación. La revocación se realiza rotando `INGEST_TOKEN` en Cloudflare Worker; GPT no puede rotarlo ni reemplazar la credencial local. Tras revocar, cualquier ejecución debe fallar cerrado hasta una delegación futura explícita.

### Tarea diaria sxc_DAILY4

Se creó una tarea diaria nueva con primer objetivo 2026-11-23 a las 08:00 (America/Argentina/Cordoba), en modalidad flexible. Sus instrucciones exigen comprobar el acceso real a PC/A22 y terminar sin mutaciones si el entorno remoto no está disponible. El entorno queda heredado sin enlace explícito al ordenador, por lo que una primera ejecución completa sigue siendo el gate para declarar la rutina autónoma. El horario es objetivo flexible, no promesa de minuto exacto.
