# Plan: Motor de Recomendaciones para Didi Dash

> **PRECONDICIÓN DURA — orden directa de Simón (2026-11-24):** este plan **solo se aplica si el diseño Helio se despliega** a producción. Mientras el PR #31 no esté mergeado y desplegado, **no se implementa nada de esto**: ni una línea de código, ni migraciones, ni cambios de esquema, ni pruebas nuevas. Este documento queda en reposo como referencia. La razón de arquitecto: la tarjeta del motor monta sobre el sistema de diseño de Helio; construirla sobre el diseño viejo duplicaría el QA visual y se tiraría al mergear Helio.

> **For agentic workers (rondas GPT):** no iniciar ninguna tarea de este archivo por cuenta propia. Está trancado detrás de una decisión de despliegue que solo toma Simón. Cuando el gate se abra, la ronda ejecutora recibe una spec autónoma fresca y anclada al SHA vigente, según el protocolo de siempre. Este archivo no reemplaza esa spec.

**Anclaje de auditoría (GLM, arquitecto/auditor, 2026-11-24):**
- Escrito contra `main@8543728` (2026-11-24) y PR #31 head `50d99c9` (draft, abierto, 185/185 en CI run #136, deploy skipped por evento de PR).
- **Caduca si:** (a) cambia el esquema de viajes o de Data Fina; (b) Helio se rediseña sustancialmente antes del merge; (c) `main` avanza tocando `public/` o `docs/DATA-FINA-SCHEMA.md` sin re-auditar; (d) cambian las reglas de ranking de franjas (umbrales de muestra/fechas/cobertura). Ante cualquiera de esas, re-anclar antes de ejecutar cualquier fase.

**Meta:** pasar de "describir qué pasó" (lo que el dashboard ya hace bien) a "sugerir qué hacer" para un único conductor: cuándo conviene manejar, cuándo conviene descansar y —más adelante, con otro debate de esquema— con qué plataforma. Sin magia: solo evidencia que ya vive en el ledger, convertida en acción concreta.

**Arquitectura en una línea:** una función pura nueva (`public/reco.mjs`) que consume las mismas agregaciones que ya calcula `buildDataFina`, y una tarjeta Helio nueva que muestra de 1 a 3 sugerencias. Cero dependencias, cero cambios de Worker/KV/esquema, cero llamadas externas, cero telemetría. Todo corre en el navegador, como todo Didi Dash.

---

## 1. Qué es un motor de recomendaciones (en criollo)

Netflix, YouTube y TikTok tienen sistemas que miran lo que hiciste y predicen qué te conviene ver después. Para un chofer es lo mismo, pero mucho más simple y con más responsabilidad: mirar tus viajes pasados y decirte cosas como "los jueves a la noche rendís más que los martes al mediodía" o "hace seis días seguidos que laburás y tu rendimiento está cayendo". El "motor" es la parte que hace esa cuenta de forma repetible, y —esto es lo importante— con honestidad sobre cuánta evidencia hay detrás de cada afirmación. Si no hay evidencia, el motor tiene que decir "no sé", no inventar.

## 2. La búsqueda mundial: qué usan los mejores (verificado el 2026-11-24)

**Metodología.** Búsqueda web en 10 idiomas (inglés, español, portugués, chino, japonés, ruso, alemán, francés, coreano y árabe) más verificación estrella por estrella contra la API de búsqueda de GitHub. Las señales más fuertes vinieron de inglés, chino y coreano; alemán, francés y árabe devolvieron mayormente resultados genéricos en inglés. Referencia académica principal: "A Comparative Evaluation of Recommender Systems Tools" (IEEE Access, 2025), que compara 42 herramientas open source y destaca Microsoft Recommenders, LensKit, Turi Create y Cornac.

### 2.1 Tabla verificada (estrellas al 2026-11-24, GitHub Search API)

| Motor / biblioteca | Quién | Estrellas | Lenguaje | Estado | Qué es |
|---|---|---|---|---|---|
| recommenders | Microsoft / Linux Foundation AI & Data | ~22.000 | Python | Activo | Las "mejores prácticas" de facto: recetas y pipelines |
| gorse | gorse-io | 9.927 | Go | Activo | Motor autoinstalable con REST API; el más "producto" de todos |
| monolith | ByteDance (TikTok) | 9.284 | Python | **Archivado** | El motor de TikTok, abierto en 2022; hoy read-only |
| vowpal_wabbit | Comunidad (ex Microsoft/Yahoo) | 8.745 | C++ | Activo | Bandidos contextuales y aprendizaje online |
| LightFM | Lyst | 5.120 | Python | Mantenimiento mínimo | Filtrado colaborativo híbrido clásico |
| RecBole | RUC AI Box | 4.620 | Python | Activo | 90+ algoritmos; el benchmark académico estándar |
| implicit | Ben Frederickson | 3.844 | Python | Activo | ALS/BPR ultrarrápido para feedback implícito |
| librec | Guo Gui Bing | 3.252 | Java | Legacy | Biblioteca académica Java |
| TensorFlow Ranking | Google | 2.771 | Python | **Archivado** | Learning-to-rank; retirado |
| TorchRec | Meta | 2.630 | Python | Activo | La escala de Instagram: tablas de embeddings en GPU |
| TFRS | Google | 2.040 | Python | Activo | TensorFlow Recommenders |
| generative-recommenders (HSTU) | Meta | 2.031 | Python | Activo | La frontera 2024+: recomendadores generativos de billones de parámetros |
| cornac | Preferred.AI | 1.065 | Python | Activo | Framework comparativo multimodal |
| lenskit | GroupLens | 971 (Java) / 313 (lkpy) | Java/Python | Java archivado | Referencia académica histórica |
| mabwiser | Fidelity | 300 | Python | Activo | Bandidos contextuales livianos |

Mencionados en comparativas pero no verificados directamente en esta pasada: NVIDIA Merlin, Turi Create, Spotlight, Seldon. Nota del auditor: dos repos famosos llegaron **archivados** (monolith de TikTok y TensorFlow Ranking) y Apache Mahout derivó hacia cómputo cuántico. En recsys la fama caduca rápido; por eso este plan ancla todos los números con fecha.

### 2.2 Los que no son open source (y por qué no van)

- **Amazon Personalize / Google Vertex AI (Search/Recommendations for Retail):** potentes y gestionados, pero se pagan por uso, mandan tus datos de guita afuera y están pensados para catálogos de millones de ítems y millones de usuarios. Con un usuario y 356 viajes es tirar plata y privacidad. **Descartados por el contrato de privacidad del repo** (nada de los viajes sale del dispositivo/Worker).
- **Netflix / YouTube / TikTok en producción:** no se instalan, se estudian (papers). Lo que sí se copia de ellos son principios de diseño: mostrar pocas sugerencias concretas, no afirmar sin evidencia y separar lo que se rankea de lo que se muestra igual.

## 3. Conclusión honesta de la búsqueda

Ninguno de los grandes entra en Didi Dash, y no es una derrota:

- Todos exigen Python, GPU o un servidor de entrenamiento; Didi Dash es JS puro en un Cloudflare Worker + KV, cero dependencias por decisión de diseño.
- Todos resuelven el problema de **muchos usuarios eligiendo entre muchos ítems**. Nuestro problema es **un solo usuario (Simón) y sus propias franjas horarias**: no hay matriz usuario-ítem, hay una serie de tiempo propia. El problema correcto se parece más a la fórmula del Top 250 de IMDB y a los bandidos multi-brazo que a TorchRec.

## 4. Qué sí le robamos a los mejores (las ideas, no los paquetes)

1. **Promedio bayesiano estilo IMDB Top 250** — la técnica de ranking liviana más famosa del mundo: `score = (n·R + m·C) / (n + m)`, con `R` = métrica de la franja, `C` = mediana global y `m` = peso de evidencia previa (`m = 5` viajes, calibrado al umbral mínimo de ranking del repo; afinable en la spec). Evita que una franja con cinco viajes afortunados desplace a una con cuarenta viajes sólidos.
2. **Mediana en vez de media** — robustez ante el viaje atípico: un viaje de 30 mil no compra el primer puesto de una franja.
3. **Las reglas de evidencia que ya están en el repo** (AGENTS.md / DATA-FINA-SCHEMA): mínimo 5 viajes, 2 fechas distintas y 90% de cobertura de duración para rankear una banda; mismo subconjunto con duración conocida en numerador y denominador; cobertura publicada siempre. **El motor no inventa umbrales propios: hereda estos.**
4. **Ventana de observación** (el punto del análisis de Sakana que sí suma): comparar tus últimas jornadas contra las previas antes de sugerir intensificar o descansar. Aplicado a los propios datos del conductor, no a los de nadie más.
5. **Bandido epsilon-greedy** (idea de Vowpal Wabbit / MABWiser, reservada para v3): destinar una fracción de sugerencias a franjas con poca evidencia, para seguir aprendiendo. En v1 se hace a mano y honesto: mostrar "poca evidencia todavía" es mejor que automatizar la exploración.
6. **Split temporal si algún día se evalúa el motor** ("¿acertó lo que sugirió?"): evaluación out-of-time, jamás aleatoria. Lección repetida en toda la literatura.
7. **Fricción cero de los grandes:** una tarjeta, no un informe. Máximo tres sugerencias concretas, con su por qué y con cuánta evidencia hay detrás.

## 5. Motor v1 — "cuándo manejar" (diseño concreto)

### 5.1 Datos de entrada (ya existen; cero ingesta nueva)

- Viajes del `/api/export` ya cargados en el dashboard (356 al 2026-11-24; hora de inicio, duración observada en 182/356, monto, fecha).
- Las seis franjas de inicio ya definidas por Helio: 00–06, 06–12, 12–18, 18–20, 20–22, 22–24.
- Los estados de cobertura por día de `public/audit.mjs` (para la señal de fatiga y para no confundir "día sin viajes registrados" con "día descansado").

### 5.2 Cálculo (función pura, determinista, testeable)

Módulo nuevo `public/reco.mjs`:

- `computeBandEvidence(trips)` — reutiliza las agregaciones de `data-fina.mjs` (la misma lógica de ranking, no una copia; si hace falta refactor de export, se hace aditivo y con tests).
- `bayesianScore(band, global)` — la fórmula IMDB adaptada del punto 4.1.
- `fatigueSignal(days)` — solo con días `Completo en ledger` consecutivos con viajes: si N >= 5 días seguidos con actividad completa y la mediana de bruto por hora-con-pasajero cayó >= 15% (provisorio; la spec final fija el valor) contra la ventana previa de igual tamaño, emite "considerá descansar". Si algún día del tramo no está completo en ledger, la señal **no** se emite: no se infiere descanso ni fatiga de huecos de captura.
- `buildRecommendations(state)` — devuelve de 0 a 3 sugerencias + razones + conteo de evidencia. **Cero relojes, cero azar, cero `Date.now()`**: la misma entrada produce la misma salida (testeable y auditable por el protocolo SHA).

### 5.3 Salida (tarjeta Helio)

- Una tarjeta nueva en la familia `helio-cards.css`: mismos tokens visuales, objetivo táctil de 44 px, flip solo si aporta; un panel simple también sirve. La decisión de forma exacta se toma en la spec de ejecución, ya sobre el Helio desplegado.
- Contenido: hasta tres sugerencias ("franjas rankeadas más altas + por qué + n viajes detrás"), y si no hay nada rankeado: "todavía no hay evidencia suficiente para recomendar turnos — capturá pantallas de detalle de tus viajes en las franjas X e Y para desbloquearlas". **El motor también recomienda qué medir, no solo qué hacer.**
- Sello de datos siempre visible: "356 viajes · duración conocida 51% · al 2026-11-24" (transparencia estilo DATA-STATUS).
- Idioma: español rioplatense, como el resto del dashboard.

### 5.4 Lo que el motor NO hace en v1 (límites explícitos)

- No recomienda turnos ni jornadas completas: solo franjas con evidencia. Las horas conectadas siguen desconocidas (cero sesiones sincronizadas) y las horas-con-pasajero no son horas conectadas.
- No habla de ganancia neta: muestra bruto por hora-con-pasajero, igual que el PR #31. El combustible no se asigna por fecha (las compras sin fecha siguen sin fecha) y "caja después de compras" no es beneficio operativo.
- No compara plataformas: 356/356 viajes son DiDi y no existe `commission_pct` (el gap #1 del análisis de Sakana). Eso es v2 y requiere una decisión de esquema previa e independiente.
- No manda nada afuera ni persiste nada nuevo: es de solo lectura sobre el export ya cargado.

### 5.5 Pruebas

- Archivo nuevo `test/reco.test.mjs` (node:test, funciones puras): bayesiano con `n < m`, `n = m` y `n >> m`; franjas que no pasan el umbral quedan fuera; fatiga solo con días completos consecutivos; día incompleto no genera señal; cero sugerencias con cero viajes; determinismo (misma entrada, misma salida).
- La suite actual (185/185 en el head del PR #31) debe quedar intacta y crecer. Nunca debilitar tests (contrato de AGENTS.md).

## 6. Fases y gates

- **GATE 0 (duro): Helio desplegado.** PR #31 mergeado + deploy real a producción verificado. No basta CI: el CI de PR salta el deploy por diseño. Antes de este gate, nada.
- **F1 — Especificación:** GLM escribe la spec autónoma para la ronda GPT, anclada al SHA vigente, con los límites de 5.4 como invariantes. Simón aprueba la spec.
- **F2 — Implementación:** rama aparte (`feat/reco-v1`): módulo + tests + tarjeta, sin tocar Worker, KV ni esquema. CI verde.
- **F3 — QA visual:** sobre el render del SHA exacto, protocolo Helio (móvil 375×812 y desktop 1280×900, overflow, foco, flip si aplica).
- **F4 — Auditoría GLM + merge:** dictamen anclado a SHA exacto con condiciones de caducidad. Merge y deploy los decide Simón, como siempre.

## 7. v2 — comparación de plataformas (dependencia externa)

"¿Conviene DiDi o Uber en esta franja?" requiere, como mínimo, `commission_pct` por viaje (o equivalente) y viajes de ambas plataformas. Hoy: 356/356 son DiDi y no hay campo de comisión. Es el gap #1 del análisis de Sakana y una decisión de esquema previa, independiente de este plan: si Simón la aprueba, v2 se especifica aparte. Sin eso, cualquier comparación de plataformas es humo, y este motor no va a emitir humo.

## 8. v3 — bandit adaptativo (opcional, último)

Epsilon-greedy hecho a mano en unas 30 líneas de JS puro: cuando haya varias franjas rankeadas, destinar ~10% de las sugerencias a la rankeada con menos evidencia, marcada como "para aprender". Solo entra si v1 pasa un mes en producción sin regresiones. No es machine learning: es una regla con nombre elegante.

## 9. Riesgos y rollback

| Riesgo | Mitigación |
|---|---|
| Sugerencias sobre evidencia flaca | Heredar estrictamente los umbrales de ranking del repo; nunca rankear por debajo |
| Fatiga mal detectada | Solo días `Completo en ledger`; sin señal ante cualquier hueco |
| Sobreajuste a una semana buena | Mediana + prior bayesiano + ventana mínima de fechas |
| Cambio de esquema rompe el motor | Caducidad explícita del anclaje de este plan |
| Rollback | El motor es de solo lectura: revert del commit y listo. Sin migración, sin datos generados, sin cleanup de KV |

## 10. Gobernanza (sin cambios)

- **Simón:** única decisión de merge, deploy, y de abrir el GATE 0.
- **GPT (rondas de ejecución):** implementan con spec autónoma fresca; este archivo no reemplaza esa spec.
- **GLM (arquitecto/auditor):** cada dictamen cita el SHA exacto probado y sus condiciones de caducidad.
- Este documento es un plan, no una autorización: no habilita por sí mismo ningún cambio de código.
