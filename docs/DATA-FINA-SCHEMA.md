# Data Fina — esquema canónico de desglose

## Objetivo

Mostrar la composición real de las ganancias de viajes DiDi sin sintetizar, repartir ni estimar importes por concepto. La fuente de verdad de caja sigue siendo el importe del viaje. El desglose sólo se acepta como real cuando proviene de una pantalla de detalle y sus componentes reconcilian con el total del conductor.

## Contrato

Un viaje puede incluir:

~~~json
{
  "modality": "DiDi Express",
  "duration_seconds": 417,
  "breakdown": {
    "source": "actual",
    "components": [
      { "code": "distancia", "label": "Tarifa por distancia", "amount": 500 },
      { "code": "tiempo", "label": "Tarifa por tiempo", "amount": 900 },
      { "code": "espera", "label": "Tarifa por espera", "amount": 100 },
      { "code": "base_dinamica", "label": "Tarifa base dinámica", "amount": 1000 },
      { "code": "diferencial", "label": "Precio diferencial", "amount": 1400 }
    ]
  }
}
~~~

Los importes son enteros ARS no negativos. duration_seconds es un entero exacto y no reemplaza el campo min histórico. modality se mantiene separado de platform. Los kilómetros ausentes o cero se normalizan como `km: null` y `km_source: "unknown"`; null nunca se convierte en cero observado.

Las compras de combustible pueden incluir `time` opcional en formato `HH:mm` cuando la hora está observada en el ticket o fue informada explícitamente por el usuario. La hora se conserva y se muestra junto a la fecha; no se infiere cuando falta.

## Códigos permitidos

| Código | Etiqueta | Campo legado |
|---|---|---|
| distancia | Tarifa por distancia | distance_ars |
| tiempo | Tarifa por tiempo | time_ars |
| espera | Tarifa por espera | wait_ars |
| base_dinamica | Tarifa base dinámica | dynamic_base_ars |
| diferencial | Precio diferencial | differential_price_ars |
| reembolso_tarifario | Reembolso tarifario | fare_reimbursement_ars |

Seis códigos son intencionales: la pantalla DiDi observada el 14/11 muestra una línea de espera separada. Omitirla impediría conciliar cinco de los importes observados. Un código futuro/desconocido se agrupa como otro conservando su etiqueta visible; nunca se descarta silenciosamente.

## Reglas de validación

1. breakdown.source sólo acepta actual o unknown. Un desglose estimado se rechaza.
2. unknown significa que no hay desglose disponible; no crea componentes con valor cero.
3. Un desglose real requiere 1–12 componentes, cada uno con etiqueta y un importe entero no negativo.
4. La suma debe coincidir con trip.amount con tolerancia máxima de ARS 2.
5. Si la suma no reconcilia, se conserva el viaje y su importe original, se descarta el desglose canónico y se marca breakdown_status: review y detail_verified: false.
6. La ausencia de una línea o un valor null no equivale a cero. La vista omite esa partida.
7. Una corrección posterior debe coincidir en fecha/hora/plataforma y conservar el ID. Componentes existentes en conflicto se clasifican como ambiguos; no se sobrescriben.
8. Los normalizadores de Worker y el importador de navegador usan listas blancas independientes. Nombres, teléfonos, direcciones, ubicaciones y cualquier campo anidado no listado quedan fuera.

## Compatibilidad

El ledger actual conserva el formato histórico fare_breakdown con las seis claves planas y detail_verified. La vista public/data-fina.mjs adapta ambos formatos al modelo de lectura canónico. No se reescribe KV sólo para cambiar el formato. Los nuevos ingresos pueden usar breakdown; las lecturas históricas continúan funcionando.

## Agregación y presentación

- Sólo los viajes cuyo desglose reconcilia contribuyen a la barra apilada y a los totales por concepto.
- Los viajes parciales y los viajes sin desglose permanecen como bruto no asignado.
- La cobertura se expresa como viajes conciliados / viajes del período, no como dinero inventado.
- La caja neta registrada es viajes + recompensas − compras de combustible. No se llama beneficio neto.
- Compras de combustible sin fecha se incluyen en caja, pero no en una fecha o mes.
- El importe por hora usa duración de viajes. No equivale a hora conectada.
- El total de días trabajados cuenta fechas únicas con al menos un viaje o una sesión de trabajo válida con minutos conectados positivos; varias fuentes el mismo día cuentan una sola vez. Combustible y recompensas por sí solos no crean un día trabajado.
- El total de horas de jornada registradas suma `connected_minutes` de las sesiones dentro del período. Sin sesiones válidas, el total es desconocido (`null`), no cero. La conexión registrada no demuestra por sí sola tiempo conduciendo.
- Las horas con pasajero suman únicamente la duración observada de los viajes y se muestran por separado de las horas conectadas. Los intervalos entre viajes no se suman.
- Las bandas horarias se etiquetan como referencia. No demuestran turnos, prime-time contractual ni tiempo disponible.
- El consumo del Etios a 8.8 L/100 km se muestra como referencia de prueba aplicada a km reales con pasajero, no medición del vehículo.

## Tests obligatorios

Ejecutar npm test. Los casos cubren suma y tolerancia, seis componentes, nulos ausentes, códigos desconocidos, origen no real, revisión por descuadre, idempotencia, conflictos, whitelists, fuel sin fecha, buckets diarios/horarios y límites de horas conectadas.

### Inteligencia operativa y límites de decisión

Las métricas operativas se calculan sobre el período seleccionado y se basan en la hora de inicio observada del viaje. No intentan reconstruir sesiones, espera, tiempo libre ni turnos.

**Franjas horarias:** se agrupan en seis segmentos: 00–06, 06–12, 12–18, 18–20, 20–22 y 22–24. Para cada segmento:

- `tripCount` incluye todos los viajes cuya hora de inicio sea un `HH:mm` válido dentro del segmento.
- `durationTrips` incluye solo esos viajes con duración positiva observada.
- `coveragePercent = durationTrips / tripCount × 100`.
- `grossPerPassengerHour` divide el bruto de esos mismos viajes con duración por la suma de sus duraciones. El bruto de viajes sin duración no entra al numerador.
- Solo se rankea con al menos 5 viajes, actividad en 2 o más fechas y cobertura de duración de al menos 90%. Las demás franjas muestran la razón por la que no se rankean.
- Las horas de inicio ausentes o inválidas permanecen fuera de los buckets y se reportan por separado.

**Día de semana:** cada viaje se asigna al día calendario de su fecha ISO. Se muestran viajes, fechas activas, bruto por fecha activa, cobertura de duración y bruto por hora con pasajero. Solo se rankea con al menos 5 viajes, 3 fechas activas distintas y 90% de cobertura de duración. Con menos fechas, el resultado es descriptivo y no debe recomendar un día de trabajo.

**Distancia de viaje:** los rangos son corto (km reales >0 y ≤3), medio (>3 y ≤8) y largo (>8). Solo entran viajes con `km_source="actual"` y km positivos. Kilómetros estimados, nulos o desconocidos se excluyen y su cobertura se informa por separado. Para comparar se muestran bruto/km real y bruto/hora con pasajero. Solo se rankea con al menos 5 viajes, 2 fechas y 90% de duración conocida.

**Interpretación:** estas tasas son rendimiento bruto durante el tiempo con pasajero; no son beneficio, margen ni rendimiento por hora conectada. No incluyen distancias de recogida sin pasajero, circulación vacía, espera ni el costo completo del vehículo. Por tanto, una tasa alta no prueba que aceptar un viaje sea rentable. La caja registrada y el bruto diario tampoco prueban ganancia o pérdida diaria. La clasificación diaria de ganancia/pérdida requiere asignar costos reales y tiempo de jornada a cada fecha; mientras falte esa evidencia, debe mostrarse como no clasificable, no como cero ni como pérdida.

### Comisiones de retiros

`amount_ars` es el principal transferido y no se resta como gasto. `fee_ars: null` es comisión desconocida. Solo un `fee_ars` numérico con `reconciled: true` acredita la comisión para el período; un cero explícito reconciliado sí representa comisión cero. Si el período contiene movimientos sin comisión reconciliada, el total de comisión del período permanece desconocido. El cálculo de caja puede mostrar una hipótesis aritmética de $0, pero debe etiquetarla como supuesto, no como dato observado.
