# Diseño: contrato operativo, auditoría e importador local

**Estado:** propuesta para revisión. Este documento no implementa cambios de producción.  
**Fecha de evidencia:** 2026-11-11 (ART)  
**Base:** `main` en `c436319e5cf8a4f452b4be6bab53b6bb08efb036`

## 1. Objetivo y límites

Consolidar cuatro piezas del proyecto Didi Dash:

1. Un contrato persistente para agentes en `AGENTS.md`.
2. Un snapshot auditable de cobertura en `docs/DATA-STATUS.md`.
3. Un importador iniciado desde la home, pero ejecutado localmente para no entregar `INGEST_TOKEN` al JavaScript público.
4. Una auditoría post-importación con estados visibles por día y una separación explícita entre datos de viajes y datos de odómetro.

La extracción automática del A22/ADB queda como fase posterior. El importador tendrá un contrato de entrada estable para que esa extracción futura produzca el mismo formato; no se asumirá que DiDi ofrece un archivo exportable ni se inventará una fuente.

Se conserva el stack actual: Cloudflare Worker + KV, HTML/JavaScript vanilla y Node test runner. No se agrega framework ni dependencia de frontend.

## 2. Evidencia verificada en producción

Pruebas realizadas el 2026-11-11 contra `https://didi-dash.simondalmasso44.workers.dev`:

| Prueba | Resultado |
|---|---|
| `GET /` | HTTP 200; `Cache-Control: no-store, max-age=0, must-revalidate` |
| `GET /api/health` | `ok=true`; almacenamiento `kv` |
| `POST /api/ingest` sin Bearer | HTTP 401 |
| `POST /api/sessions` | HTTP 405; las escrituras se restringen al endpoint privado |
| `GET /api/trips?limit=5000` | 120 registros; `total=120`; `truncated=false` |
| `GET /api/export` | ninguna colección truncada; 120 viajes, 4 recompensas, 4 registros de combustible y 0 sesiones |

El importe sumado de los 120 viajes es **ARS 438.000**. Procedencia actual: 93 registros `didi_history_detail` y 27 `didi_history`.

### Cobertura de viajes en el ledger

| Fecha | Viajes | Fecha/hora, importe y plataforma | Km reales | Duración positiva | Estado interno |
|---|---:|---:|---:|---:|---|
| 03/11/2026 | 30 | 30/30 | 3/30 | 3/30 | Parcial |
| 05/11/2026 | 16 | 16/16 | 16/16 | 16/16 | Completo en ledger |
| 06/11/2026 | 16 | 16/16 | 16/16 | 16/16 | Completo en ledger |
| 07/11/2026 | 22 | 22/22 | 22/22 | 22/22 | Completo en ledger |
| 08/11/2026 | 17 | 17/17 | 17/17 | 17/17 | Completo en ledger |
| 10/11/2026 | 19 | 19/19 | 19/19 | 19/19 | Completo en ledger |
| **Total** | **120** | **120/120** | **93/120** | **93/120** | **Parcial global** |

Los 27 incompletos pertenecen al 03/11 y proceden de `didi_history`: el registro de lista no contiene distancia ni duración. En el esquema actual, distancia desconocida queda representada con `km=0` y `km_source=unknown`; la duración 0 se cuenta como no comprobada. No completar esos valores por inferencia.

**Zonas:** 0/120 con zona persistida. El normalizador de viajes usa una lista blanca de campos y descarta direcciones y campos de ubicación. No afirmar que DiDi no entrega zonas: lo único demostrado en esta auditoría es que el ledger no las conserva. No guardar direcciones, nombres ni teléfonos de pasajeros.

**Turnos/odómetro:** `GET /api/sessions` devuelve una colección vacía en producción. El dashboard documenta que los turnos, gastos y configuraciones ingresados desde Inputs se guardan en el `localStorage` de ese navegador y no se sincronizan automáticamente. No confundir 0 sesiones en KV con 0 turnos trabajados.

**Límite de certificación:** estos resultados certifican la cobertura de lo que está almacenado en el Worker. No demuestran que el A22 no tenga viajes adicionales. Solo una comparación con una extracción completa y verificable del teléfono permitirá etiquetar un período como **comparado contra A22**.

## 3. Contrato operativo que se documentará

`AGENTS.md` será la primera lectura de cualquier agente. Debe indicar:

- Arquitectura: Worker, binding KV `DATA`, clave `ledger:v1`, archivos principales y comandos de test.
- Lecturas públicas: `GET /api/health`, `/api/trips`, `/api/rewards`, `/api/fuel`, `/api/sessions` y `/api/export`.
- Única escritura: `POST /api/ingest`, con `Authorization: Bearer <INGEST_TOKEN>`. Nunca poner el token en HTML, JavaScript público, URL, repositorio, logs ni mensajes.
- El normalizador descarta campos de pasajeros y ubicación. No agregarlos sin un diseño de privacidad explícito.
- Ausencia no equivale a cero conocido. No inventar km, minutos, horarios, zonas ni importes. Los valores derivados deben etiquetarse como derivados y mantener su procedencia.
- Leer `docs/DATA-STATUS.md` antes de interpretar la completitud de los datos.
- Una auditoría debe usar `/api/trips?limit=5000` y `/api/export`, comprobar `truncated=false`, computar cobertura campo por campo y por día, revisar procedencia y distinguir ledger interno de comparación con fuente.
- Antes de afirmar un cambio: `npm test`, chequeos de sintaxis aplicables y revisión del diff.

`docs/DATA-STATUS.md` será un **snapshot fechado**, no una segunda base de verdad. La verdad viva sigue siendo el ledger del Worker. Cada actualización debe guardar fecha/hora, endpoints, cantidades, indicadores de truncamiento, reglas de cómputo y límites de certificación.

## 4. Diseño del importador

### Alternativas

**A. Importación enteramente en navegador.** El browser elige un archivo y envía el POST. Si el Bearer se conserva en `localStorage`, cualquier JavaScript ejecutado en el mismo origen podría leerlo. Pedir el token en cada sesión y mantenerlo solo en memoria sería más seguro, pero no resuelve el flujo ADB y agrega fricción.

**B. Aplicación local lanzada por protocolo personalizado.** La home abre un helper Windows que almacena el secreto localmente, presenta el preview en su propia ventana y ejecuta la confirmación. Es más simple y evita que el navegador tenga el token, pero el preview no queda integrado en la home.

**C. Compañero local de loopback (recomendado).** Un helper Windows escucha únicamente en `127.0.0.1`; la home se comunica con una API local acotada. El helper conserva la credencial mediante protección del sistema operativo y llama al Worker. Permite mantener selección, preview, confirmación y recibo en el dashboard. Tiene más complejidad de seguridad y compatibilidad del navegador que A o B; debe probarse con la versión real de Chrome antes de adoptarlo.

### Flujo propuesto para C

1. La home muestra **Importar viajes** y detecta si el compañero local está disponible. Si no está, muestra instrucciones para iniciarlo/instalarlo; no intenta ejecutar comandos arbitrarios.
2. El usuario selecciona un JSON local. El formato de entrada estable será una envoltura con colecciones `trips`, `rewards`, `fuel` y `sessions`, siguiendo el esquema ya aceptado por el Worker. Las sesiones locales de este navegador podrán incluirse en la misma operación solo después de mapear y validar su estructura.
3. El compañero valida el archivo localmente y envía un preview autenticado al Worker. El browser recibe únicamente conteos resumidos por día y colección, no el token ni el contenido completo.
4. El usuario revisa los conteos: nuevos, actualizados, duplicados y ambiguos. Los ambiguos se detienen para revisión; no se fuerzan merges.
5. El usuario pulsa **Confirmar importación**. El compañero repite la solicitud de escritura real y devuelve un recibo resumido. La home recarga el ledger y vuelve a calcular la cobertura.
6. La operación no incluye pantallas crudas con nombres, teléfonos o direcciones de pasajeros en el preview.

### Protección del secreto y del compañero local

- El secreto `INGEST_TOKEN` permanece en el helper y protegido para el usuario de Windows (Credential Manager o DPAPI); no se almacena en `localStorage`, HTML, JavaScript servido, parámetros de URL ni archivos del repo.
- El servicio escucha solo en loopback, valida el `Origin` exacto de producción y el encabezado `Host`, aplica CORS/Private Network Access de forma explícita y usa un nonce de emparejamiento de corta vida.
- Solo expone operaciones fijas de `health`, `preview` y `commit`; no acepta rutas arbitrarias, comandos, URLs de destino ni ejecución de shell.
- Preview y commit son acciones distintas. La autorización de commit se limita a esa importación revisada; no existe permiso permanente de escritura implícito.
- Los logs registran hora, conteos y resultado, nunca el Bearer ni el contenido sensible del archivo.
- Si la política de Chrome o la prueba de seguridad no permite una comunicación loopback fiable, usar B como fallback explícito en lugar de debilitar CORS o exponer el servicio a la red.

## 5. Extensión de la API para preview

El Worker actual **no implementa** `dry=1`; hoy la query sería ignorada y el POST escribiría. No implementar el cliente hasta agregarlo con tests.

Propuesta: extender el mismo `POST /api/ingest` con `?dry=1`, autenticación obligatoria también para preview y el mismo parseo/normalización/dedupe del commit real. En modo dry:

- leer el ledger actual;
- ejecutar las mismas funciones de normalización y coincidencia;
- devolver `dry_run=true` y conteos por colección/día;
- no llamar a `writeLedger` ni modificar KV;
- no devolver registros crudos;
- responder 200; el commit normal mantiene el 201 actual.

El preview y el commit deben producir categorías compatibles. La relectura del ledger inmediatamente antes del commit es obligatoria: el estado puede haber cambiado desde el preview. Si el resultado del commit difiere, mostrar el recibo real, no el resultado previo.

La API actual acepta hasta 500 registros totales por request y valida el tamaño del cuerpo. El primer MVP limitará el lote a esos límites y mostrará el error exacto si se exceden; no dividirá silenciosamente una importación en múltiples escrituras.

## 6. Auditoría y badges

La auditoría posterior se calcula sobre respuestas completas de `GET /api/trips` y `GET /api/sessions` (o `/api/export`), con `truncated=false`.

Cobertura de viaje:

- Fecha, hora de inicio, importe y plataforma: presencia/validez por registro.
- Km reales: `km > 0` y `km_source=actual`. Las distancias estimadas se informan aparte, nunca como reales.
- Duración: `min > 0` para la métrica de cobertura; cero permanece sin verificar hasta reconciliar la fuente.
- Zona: indicador separado **sin dato de zona en el ledger**, no un motivo para inventar una etiqueta.

Cobertura de vehículo:

- Sesiones existentes y cobertura de odómetro se computan separadamente de los viajes.
- 0 sesiones en KV produce **sin turnos sincronizados**, no “cero horas trabajadas”.
- No declarar neto operativo completo sin cobertura de odómetro y los costos requeridos por el cálculo actual.

Estados visibles:

- **Completo en ledger:** todos los registros de ese día tienen los campos de viaje definidos como obligatorios y km real + duración positiva.
- **Parcial en ledger:** existe al menos un registro incompleto.
- **Sin turnos sincronizados:** no existen sesiones en KV.
- **Comparado contra A22:** reservado para después de contrastar una extracción completa del teléfono, con conteos, claves y procedencia verificables.

El color nunca será la única señal: el texto del badge siempre dirá el estado y el denominador.

## 7. Pruebas de aceptación

- Test de Worker: preview sin token devuelve 401; preview autenticado devuelve conteos pero no modifica KV; commit autenticado modifica KV; reimportación es idempotente; conflicto ambiguo no se fusiona.
- Los conteos del preview corresponden al resultado real del normalizador. El test debe demostrar que el estado de KV permanece idéntico antes y después de un dry-run.
- Test de dashboard: CTA presente solo donde corresponda; estados por día se derivan del ledger completo y distinguen km real, estimado y desconocido; sesiones vacías no se muestran como 0 horas trabajadas.
- Test del helper: solo loopback, Origin/Host autorizados, nonce expirado/reutilizado rechazado, límites de tamaño, no ejecución arbitraria, secreto nunca devuelto ni escrito en logs.
- Verificación local completa con `npm test`, chequeos de sintaxis y `git diff --check`; CI debe pasar antes de abrir PR.
- Deploy solo mediante el flujo existente de GitHub Actions en `main`, tras review y merge explícito.

## 8. Fuera de alcance de esta primera entrega

- Automatización A22/ADB, navegación por DiDi, capturas de pantalla y OCR. Se define después de conocer con evidencia qué datos expone la app en el dispositivo.
- Inferir zonas desde GPS o direcciones de pasajeros.
- Sincronizar costos fijos y gastos personales del `localStorage` al KV.
- Publicar el helper en una interfaz de red o abrir un Cloudflare Tunnel.

## 9. Decisiones pendientes para la revisión

1. Aprobar el compañero local de loopback C, con B como fallback, en lugar de persistir el token en `localStorage`.
2. Confirmar que la primera importación sincronice también los turnos de `localStorage` de este navegador, enviando solo sesiones y nunca el resto de la configuración privada.
3. Aceptar los estados **Completo en ledger / Parcial en ledger / Comparado contra A22** para que “100%” no se confunda con una reconciliación que todavía no se realizó.
