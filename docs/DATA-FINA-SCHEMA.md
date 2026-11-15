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

Los importes son enteros ARS no negativos. duration_seconds es un entero exacto y no reemplaza el campo min histórico. modality se mantiene separado de platform.

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
- Las bandas horarias se etiquetan como referencia. No demuestran turnos, prime-time contractual ni tiempo disponible.
- El consumo del Etios a 8.8 L/100 km se muestra como referencia de prueba aplicada a km reales con pasajero, no medición del vehículo.

## Tests obligatorios

Ejecutar npm test. Los casos cubren suma y tolerancia, seis componentes, nulos ausentes, códigos desconocidos, origen no real, revisión por descuadre, idempotencia, conflictos, whitelists, fuel sin fecha, buckets diarios/horarios y límites de horas conectadas.

### Inteligencia operativa por franja

Las franjas se agrupan por hora de inicio del viaje: 18–20, 20–22 y 22–24. Para cada franja:

- `tripCount` incluye todos los viajes con hora de inicio válida en la franja.
- `durationTrips` incluye solo viajes con duración observada positiva.
- `coveragePercent = durationTrips / tripCount × 100`.
- `grossPerPassengerHour = suma de importes de esos mismos viajes con duración / suma de sus duraciones × 3600`. No se usa el bruto de viajes sin duración en el numerador.
- Una franja se puede ordenar solo con al menos 5 viajes, actividad en al menos 2 fechas y cobertura de duración de al menos 90%. Las demás se muestran como `no rankeada`, incluso cuando la tasa parcial parezca alta.

La tasa representa horas con pasajero informadas por DiDi, no horas conectado a la app. La ausencia de sesiones sincronizadas significa que esa métrica es desconocida. Las comparaciones por día de semana con menos de 3 fechas por grupo también deben permanecer descriptivas, no rankeadas.

### Comisiones de retiros

`amount_ars` es el principal transferido y no se resta como gasto. `fee_ars: null` es comisión desconocida. Solo un `fee_ars` numérico con `reconciled: true` acredita la comisión para el período; un cero explícito reconciliado sí representa comisión cero. Si el período contiene movimientos sin comisión reconciliada, el total de comisión del período permanece desconocido. El cálculo de caja puede mostrar una hipótesis aritmética de $0, pero debe etiquetarla como supuesto, no como dato observado.
