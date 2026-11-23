# Horas — Fase 1

## Estado

Scaffolding de la rama `feat/horas-1`. Este commit documenta el alcance y los contratos; no modifica runtime, API, Worker, KV, backups ni producción.

## Objetivo

Convertir los datos horarios ya registrados en una lectura operativa útil, sin presentar minutos con pasajero como horas conectadas ni completar ausencias con ceros.

## Contrato de datos

La implementación debe reutilizar `buildDataFina()` en `public/data-fina.mjs` y los datos ya entregados a `renderDataFina()` en `public/index.html`. No duplicar agregaciones dentro del DOM.

- **Horas con pasajero:** sumar únicamente duración de viajes observada y positiva (`duration_seconds`, con compatibilidad histórica `min`). Los intervalos entre viajes quedan excluidos. El total observado actual de referencia es 30,5 h; se calcula siempre desde los registros del período y nunca se codifica como constante.
- **Horas conectadas:** sumar únicamente `connected_minutes` de sesiones válidas y deduplicadas. Sin sesiones válidas, el total y las tasas basadas en él permanecen `null` / “Sin datos”; no mostrar 0 h como si se hubiera medido.
- **ARS/h con pasajero:** bruto de los mismos viajes con duración observada dividido por esa misma duración. No incluir recompensas ni viajes sin duración en el numerador.
- **ARS/día trabajado:** bruto de viajes dividido por fechas únicas con viajes en el período. Presentarlo como bruto de viajes por día activo, no como beneficio neto. Sin fechas válidas, mostrar “—”.
- **Comparación por día de semana:** agrupar por día calendario de `trip.date`, contar fechas distintas y viajes. Mostrar la tasa horaria sólo con al menos 3 fechas observadas para ese día de semana; por debajo del umbral, mostrar “Muestra insuficiente”. No interpretar fechas ausentes como francos.
- **Comparación por franja:** reutilizar `result.timeBands` y su lógica existente de duración, cobertura y elegibilidad. Una franja con menos de 5 viajes nunca se compara ni rankea. Con 5 o más viajes, respetar además los controles actuales de fechas y cobertura; no relajar los gates existentes.

## Presentación

- Integrar la lectura como módulo de dashboard, usando el HTML compartido y tokens/clases CSS existentes.
- Mantener cuatro métricas principales: horas con pasajero, horas conectadas, ARS/h con pasajero y ARS brutos por día activo.
- Mostrar comparación por día de semana y franja con recuento de muestra y cobertura.
- Usar “—” para valores no disponibles y una etiqueta explícita para “Sin datos” / “Muestra insuficiente”.
- Diseño mobile-first, HTML/CSS/JavaScript vanilla y cero dependencias nuevas.
- Escapar todo contenido dinámico antes de interpolarlo en HTML.

## Límites de seguridad y alcance

- Cambios sólo client-side en la vista y en agregación analítica pura.
- No tocar `src/index.js`, normalizadores, importador, ledger, API de ingesta, KV, backups, credenciales, flujos A22 ni datos de producción.
- No inferir turnos, pausas, tiempos de espera, conexión online, kilómetros ni días libres.
- No escribir datos locales del usuario como parte de esta feature.

## Plan de pruebas

1. Añadir pruebas de comportamiento a `test/data-fina.test.mjs` antes de implementar la agregación por día de semana: agrupación correcta, fechas duplicadas, muestra con 2 fechas (insuficiente) y con 3 fechas (elegible).
2. Verificar que ausencia de sesiones conserve `connectedHours === null`, aunque existan horas con pasajero.
3. Verificar que horas con pasajero y ARS/h usen sólo viajes con duración observada.
4. Verificar franja con menos de 5 viajes como no elegible y preservar los gates de cobertura/fechas ya vigentes.
5. Ejecutar pruebas focalizadas, luego `npm test`, comprobaciones de sintaxis y `git diff --check`. Registrar explícitamente cualquier test preexistente que siga fallando; no debilitarlo.

## Gate de integración

La rama no se fusiona ni se despliega desde este trabajo. Para integración se requiere suite completa verde, resolución independiente del blocker 172/173 y revisión externa de GLM canalizada por Simón. CLEAN1 y Helio permanecen fuera de alcance hasta cumplir sus gates propios.
