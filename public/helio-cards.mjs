const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0
});
const compact = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 0,
  notation: "compact"
});
const number = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const reduceMotion = typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;
const mounted = new WeakMap();

const BANDS = [
  { key: "dawn", label: "Madrugada 00–06", start: 0, end: 6, color: "#707078" },
  { key: "morning", label: "Mañana 06–12", start: 6, end: 12, color: "#8e8e93" },
  { key: "afternoon", label: "Tarde 12–18", start: 12, end: 18, color: "#1d8f47" },
  { key: "night", label: "Noche 18–24", start: 18, end: 24, color: "#30d158" }
];

function valueOf(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullable(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function normalizedHours(source) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    hour, gross: 0, trips: 0
  }));
  if (!Array.isArray(source)) return rows;
  for (const row of source) {
    const hour = Number(row?.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    rows[hour].gross += Math.max(0, valueOf(row.gross));
    rows[hour].trips += Math.max(0, valueOf(row.trips));
  }
  return rows;
}

export function buildHelioViewModel(result = {}, financial = {}) {
  const gross = Math.max(0, valueOf(result.gross));
  const hours = normalizedHours(result.hours);
  const hourGross = hours.reduce((sum, row) => sum + row.gross, 0);
  const unassignedHourGross = Math.max(0, gross - hourGross);
  const bands = BANDS.map((band) => ({
    ...band,
    gross: hours.filter((row) => row.hour >= band.start && row.hour < band.end)
      .reduce((sum, row) => sum + row.gross, 0)
  }));
  if (unassignedHourGross > 0) {
    bands.push({
      key: "unknown", label: "Sin hora válida", start: null, end: null,
      color: "#48484f", gross: unassignedHourGross
    });
  }
  const days = (Array.isArray(result.days) ? result.days : [])
    .filter((row) => row && typeof row.date === "string")
    .map((row) => ({
      date: row.date,
      gross: Math.max(0, valueOf(row.gross)),
      trips: Math.max(0, valueOf(row.trips))
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    tripCount: Math.max(0, valueOf(result.tripCount)),
    tripGross: gross,
    rewardGross: Math.max(0, valueOf(result.rewardGross)),
    fuelPurchaseSpend: Math.max(0, valueOf(result.fuelSpend)),
    cashAfterRecordedCosts: nullable(financial.netCashAfterFuelPurchases),
    operatingProfit: nullable(financial.netOperating),
    operatingComplete: financial.netComplete === true,
    fuelCostEstimate: nullable(financial.fuelCost),
    fuelMode: typeof financial.fuelMode === "string" ? financial.fuelMode : "unavailable",
    otherCosts: Math.max(0, valueOf(financial.otherCosts)),
    missingCosts: Array.isArray(financial.missingCosts)
      ? financial.missingCosts.filter((item) => typeof item === "string")
      : [],
    actualKm: Math.max(0, valueOf(result.actualKm)),
    actualKmTrips: Math.max(0, valueOf(result.actualKmTrips)),
    durationTrips: Math.max(0, valueOf(result.durationTrips)),
    passengerHours: nullable(result.passengerHours),
    connectedHours: nullable(result.connectedHours),
    grossPerPassengerHour: nullable(result.grossPerPassengerHour),
    primeGross: Math.max(0, valueOf(result.primeGross)),
    primeSharePercent: Math.max(0, valueOf(result.primeSharePercent)),
    bestHour: Number.isInteger(result.bestHour) ? result.bestHour : null,
    bestHourGross: Math.max(0, valueOf(result.bestHourGross)),
    activeDays: Math.max(0, valueOf(result.activeDays, days.length)),
    dailyAverage: nullable(result.dailyAverage),
    days,
    hours,
    hourGross,
    unassignedHourGross,
    bands
  };
}

function detailRows(rows) {
  return rows.map((row) =>
    '<div class="helio-row"><span>' + safe(row[0]) + '</span><strong>' +
    safe(row[1]) + '</strong></div>'
  ).join("");
}

function markup(model) {
  const lastDay = model.days[model.days.length - 1];
  const peakLabel = model.bestHour == null ? "Sin hora pico" :
    "Pico " + String(model.bestHour).padStart(2, "0") + " h";
  const operating = model.operatingProfit == null
    ? "No disponible"
    : money.format(model.operatingProfit);
  const fuelEstimate = model.fuelCostEstimate == null
    ? "Sin base suficiente"
    : money.format(model.fuelCostEstimate);
  const fuelBasis = model.fuelMode === "passenger_km_partial"
    ? "Parcial: km reales con pasajero"
    : model.fuelMode === "vehicle_odometer_partial"
      ? "Parcial: odómetro"
      : model.fuelMode === "vehicle_odometer"
        ? "Odómetro completo"
        : "Sin distancia válida";
  const bandLegend = model.bands.filter((band) => band.key !== "unknown").map((band) => {
    const share = model.hourGross ? band.gross / model.hourGross * 100 : 0;
    return '<div class="helio-legend-row"><i style="background:' + band.color +
      '"></i><span>' + safe(band.label) + '</span><strong>' +
      safe(money.format(band.gross)) + ' · ' + number.format(share) + '%</strong></div>';
  }).join("");
  const daysText = model.days.map((day) =>
    '<li>' + safe(day.date) + ': ' + safe(money.format(day.gross)) +
    ' (' + safe(day.trips) + ' viajes)</li>'
  ).join("") || "<li>Sin actividad.</li>";
  const hoursText = model.hours.map((row) =>
    '<li>' + String(row.hour).padStart(2, "0") + ':00 · ' +
    safe(money.format(row.gross)) + ' · ' + safe(row.trips) + ' viajes</li>'
  ).join("");

  return ''
    + '<div class="helio-grid">'
    + '<article class="helio-card" data-helio-card>'
    + '<div class="helio-inner">'
    + '<section class="helio-face helio-front" aria-hidden="false">'
    + '<div class="helio-head"><div><h3>Ingresos</h3><p>Por día con actividad · ' + model.activeDays + ' días</p></div>'
    + '<button type="button" class="helio-flip" data-flip aria-expanded="false">Ver economía</button></div>'
    + '<div class="helio-readout"><strong data-day-value>' + (lastDay ? safe(money.format(lastDay.gross)) : "—") + '</strong>'
    + '<span data-day-label>' + (lastDay ? safe(lastDay.date) : "Sin actividad") + '</span></div>'
    + '<canvas class="helio-canvas helio-stems" data-chart="days" aria-hidden="true"></canvas>'
    + '<div class="helio-foot"><div><span>Bruto viajes</span><strong>' + safe(money.format(model.tripGross)) + '</strong></div>'
    + '<div><span>Promedio/día</span><strong>' + (model.dailyAverage == null ? "—" : safe(money.format(model.dailyAverage))) + '</strong></div>'
    + '<div><span>Viajes</span><strong>' + model.tripCount + '</strong></div></div>'
    + '<ul class="helio-sr-only" aria-label="Ingresos por día">' + daysText + '</ul>'
    + '</section>'
    + '<section class="helio-face helio-back" aria-hidden="true" inert>'
    + '<div class="helio-head"><div><h3>Economía registrada</h3><p>Importes separados por origen</p></div>'
    + '<button type="button" class="helio-flip" data-flip aria-expanded="true">Volver</button></div>'
    + '<div class="helio-big">' + (model.tripCount ? safe(money.format(model.tripGross / model.tripCount)) : "—")
    + '<small>Ingreso bruto promedio por viaje</small></div>'
    + '<div class="helio-rows">' + detailRows([
      ["Bruto de viajes", money.format(model.tripGross)],
      ["Recompensas", money.format(model.rewardGross)],
      ["Combustible comprado", money.format(model.fuelPurchaseSpend)],
      ["Otros costos cargados", money.format(model.otherCosts)],
      ["Caja tras combustible y otros costos", model.cashAfterRecordedCosts == null ? "Sin datos" : money.format(model.cashAfterRecordedCosts)],
      ["Resultado operativo estimado", operating]
    ]) + '</div>'
    + '<p class="helio-note">Caja no equivale a beneficio. El resultado operativo queda sin publicar mientras falte información necesaria para completarlo.</p>'
    + '</section></div></article>'

    + '<article class="helio-card" data-helio-card><div class="helio-inner">'
    + '<section class="helio-face helio-front" aria-hidden="false">'
    + '<div class="helio-head"><div><h3>Reparto por franja</h3><p>Gross por hora de inicio del viaje</p></div>'
    + '<button type="button" class="helio-flip" data-flip aria-expanded="false">Ver cobertura</button></div>'
    + '<div class="helio-ring-wrap"><canvas class="helio-canvas helio-ring" data-chart="ring" aria-hidden="true"></canvas>'
    + '<div class="helio-ring-center"><strong data-ring-value>—</strong><span data-ring-label>Sin datos</span></div></div>'
    + '<div class="helio-legend">' + bandLegend + '</div>'
    + '<p class="helio-note">Las franjas se comparan sobre el gross con hora válida. ' +
      (model.unassignedHourGross > 0 ? safe(money.format(model.unassignedHourGross)) + " sin hora (" + number.format(model.unassignedHourGross / Math.max(model.tripGross, 1) * 100) + "% del bruto total) queda fuera del reparto." : "Todo el bruto tiene hora válida.") + '</p>'
    + '</section>'
    + '<section class="helio-face helio-back" aria-hidden="true" inert>'
    + '<div class="helio-head"><div><h3>Cobertura del período</h3><p>Datos observados, sin turnos inferidos</p></div>'
    + '<button type="button" class="helio-flip" data-flip aria-expanded="true">Volver</button></div>'
    + '<div class="helio-big">' + number.format(model.primeSharePercent) + '<small>% en franja prime de referencia</small></div>'
    + '<div class="helio-rows">' + detailRows([
      ["Gross prime (07–09 y 17–22)", money.format(model.primeGross)],
      ["Kilómetros reales con pasajero", number.format(model.actualKm) + " km"],
      ["Viajes con km reales", model.actualKmTrips + " / " + model.tripCount],
      ["Viajes con duración", model.durationTrips + " / " + model.tripCount],
      ["Horas con pasajero", model.passengerHours == null ? "Sin datos" : number.format(model.passengerHours) + " h"],
      ["Horas conectadas", model.connectedHours == null ? "Sin datos" : number.format(model.connectedHours) + " h"]
    ]) + '</div>'
    + '<p class="helio-note">La franja prime replica buildDataFina. Las horas con pasajero no son horas conectadas; sin sesiones, la conexión es desconocida.</p>'
    + '</section></div></article>'

    + '<article class="helio-card" data-helio-card><div class="helio-inner">'
    + '<section class="helio-face helio-front" aria-hidden="false">'
    + '<div class="helio-head"><div><h3>Horas</h3><p>Gross por hora de inicio</p></div>'
    + '<button type="button" class="helio-flip" data-flip aria-expanded="false">' + safe(peakLabel) + '</button></div>'
    + '<div class="helio-readout"><strong data-hour-value>' + (model.bestHour == null ? "—" : safe(money.format(model.bestHourGross))) + '</strong>'
    + '<span data-hour-label>' + (model.bestHour == null ? "Sin horas registradas" : String(model.bestHour).padStart(2, "0") + ":00 · hora pico") + '</span></div>'
    + '<canvas class="helio-canvas helio-bars" data-chart="hours" aria-hidden="true"></canvas>'
    + '<div class="helio-foot helio-foot-two"><div><span>Prime 07–09 y 17–22</span><strong>' + safe(money.format(model.primeGross)) + '</strong></div>'
    + '<div><span>Resto con hora válida</span><strong>' + safe(money.format(Math.max(0, model.hourGross - model.primeGross))) + '</strong></div></div>'
    + '<ul class="helio-sr-only" aria-label="Gross por hora">' + hoursText + '</ul>'
    + '</section>'
    + '<section class="helio-face helio-back" aria-hidden="true" inert>'
    + '<div class="helio-head"><div><h3>Combustible y costos</h3><p>Compras y estimación separadas</p></div>'
    + '<button type="button" class="helio-flip" data-flip aria-expanded="true">Volver</button></div>'
    + '<div class="helio-big">' + safe(fuelEstimate) + '<small>Combustible estimado</small></div>'
    + '<div class="helio-rows">' + detailRows([
      ["Combustible comprado", money.format(model.fuelPurchaseSpend)],
      ["Combustible estimado", fuelEstimate],
      ["Base de estimación", fuelBasis],
      ["Costos pendientes", model.missingCosts.length ? model.missingCosts.join(", ") : "Ninguno informado"],
      ["Resultado operativo", operating]
    ]) + '</div>'
    + '<p class="helio-note">Las compras pagadas no equivalen a combustible consumido. El costo estimado parcial no se suma a las compras de caja.</p>'
    + '</section></div></article></div>';
}

function canvasSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

export function renderHelioCards(container, result, financial) {
  if (!container) return;
  mounted.get(container)?.();
  const model = buildHelioViewModel(result, financial);
  container.innerHTML = markup(model);
  const cleanups = [];
  const addCleanup = (callback) => cleanups.push(callback);
  const cards = [...container.querySelectorAll("[data-helio-card]")];

  for (const card of cards) {
    for (const button of card.querySelectorAll("[data-flip]")) {
      button.addEventListener("click", () => {
        const flipped = card.classList.toggle("is-flipped");
        const front = card.querySelector(".helio-front");
        const back = card.querySelector(".helio-back");
        if (front) {
          front.setAttribute("aria-hidden", String(flipped));
          front.inert = flipped;
        }
        if (back) {
          back.setAttribute("aria-hidden", String(!flipped));
          back.inert = !flipped;
        }
        for (const control of card.querySelectorAll("[data-flip]")) {
          control.setAttribute("aria-expanded", String(flipped));
        }
      });
    }
  }

  const daysCanvas = container.querySelector('[data-chart="days"]');
  const dayValue = container.querySelector("[data-day-value]");
  const dayLabel = container.querySelector("[data-day-label]");
  let dayIndex = model.days.length - 1;
  let dayPointer = null;

  const drawDays = () => {
    const surface = canvasSize(daysCanvas);
    if (!surface) return;
    const ctx = surface.ctx, width = surface.width, height = surface.height;
    ctx.clearRect(0, 0, width, height);
    if (!model.days.length) {
      ctx.fillStyle = "#a1a1a8";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Sin actividad en el período", width / 2, height / 2);
      return;
    }
    const pad = { left: 16, right: 16, top: 14, bottom: 25 };
    const max = Math.max(1, ...model.days.map((row) => row.gross));
    const slot = (width - pad.left - pad.right) / model.days.length;
    const base = height - pad.bottom;
    ctx.strokeStyle = "rgba(255,255,255,.13)";
    ctx.beginPath();
    ctx.moveTo(pad.left, base);
    ctx.lineTo(width - pad.right, base);
    ctx.stroke();
    model.days.forEach((row, index) => {
      const x = pad.left + slot * (index + .5);
      const y = base - row.gross / max * (height - pad.top - pad.bottom);
      const active = index === dayIndex;
      ctx.strokeStyle = active ? "#a5f0bd" : "#30d158";
      ctx.lineWidth = active ? 2.8 : 1.6;
      if (active) {
        ctx.shadowColor = "rgba(48,209,88,.75)";
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = active ? "#d8ffe4" : "#30d158";
      ctx.beginPath();
      ctx.arc(x, y, active ? 3.2 : 2, 0, Math.PI * 2);
      ctx.fill();
      if (index % 2 === 0 || active) {
        ctx.fillStyle = "#a1a1a8";
        ctx.font = "9px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(row.date.slice(8, 10), x, height - 7);
      }
      if (active && dayPointer) {
        ctx.strokeStyle = "rgba(48,209,88,.5)";
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, Math.max(pad.top, dayPointer.y));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  };

  const selectDay = (index) => {
    if (!model.days.length) return;
    dayIndex = Math.max(0, Math.min(model.days.length - 1, index));
    dayValue.textContent = money.format(model.days[dayIndex].gross);
    dayLabel.textContent = model.days[dayIndex].date + " · " + model.days[dayIndex].trips + " viajes";
    drawDays();
  };
  if (model.days.length) {
    selectDay(dayIndex);
    const onMove = (event) => {
      const rect = daysCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      dayPointer = { y: event.clientY - rect.top };
      selectDay(Math.floor(x / Math.max(rect.width / model.days.length, 1)));
    };
    const onLeave = () => {
      dayPointer = null;
      selectDay(model.days.length - 1);
    };
    daysCanvas.addEventListener("pointermove", onMove);
    daysCanvas.addEventListener("pointerleave", onLeave);
    addCleanup(() => {
      daysCanvas.removeEventListener("pointermove", onMove);
      daysCanvas.removeEventListener("pointerleave", onLeave);
    });
  } else drawDays();

  const hoursCanvas = container.querySelector('[data-chart="hours"]');
  const hourValue = container.querySelector("[data-hour-value]");
  const hourLabel = container.querySelector("[data-hour-label]");
  let selectedHour = model.bestHour;
  let hourPointer = null;

  const drawHours = () => {
    const surface = canvasSize(hoursCanvas);
    if (!surface) return;
    const ctx = surface.ctx, width = surface.width, height = surface.height;
    ctx.clearRect(0, 0, width, height);
    const pad = { left: 8, right: 8, top: 12, bottom: 22 };
    const max = Math.max(1, ...model.hours.map((row) => row.gross));
    const slot = (width - pad.left - pad.right) / 24;
    const base = height - pad.bottom;
    model.hours.forEach((row) => {
      const x = pad.left + row.hour * slot + slot * .2;
      const barWidth = slot * .6;
      const fullHeight = row.gross / max * (height - pad.top - pad.bottom);
      const distance = hourPointer == null ? 999 : Math.abs(hourPointer - (pad.left + (row.hour + .5) * slot));
      const fill = hourPointer == null ? .55 : Math.max(.32, 1 - distance / Math.max(width * .34, 1));
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.fillRect(x, base - Math.max(2, fullHeight), barWidth, Math.max(2, fullHeight));
      const filledHeight = fullHeight * fill;
      ctx.fillStyle = row.hour === selectedHour ? "#d8ffe4" : "#30d158";
      if (row.hour === selectedHour) {
        ctx.shadowColor = "rgba(48,209,88,.7)";
        ctx.shadowBlur = 8;
      }
      ctx.fillRect(x, base - filledHeight, barWidth, Math.max(row.gross ? 2 : 0, filledHeight));
      ctx.shadowBlur = 0;
      if (row.hour % 3 === 0 || row.hour === selectedHour) {
        ctx.fillStyle = "#a1a1a8";
        ctx.font = "9px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(String(row.hour).padStart(2, "0"), pad.left + (row.hour + .5) * slot, height - 6);
      }
    });
  };

  const selectHour = (hour) => {
    selectedHour = hour;
    if (hour == null) {
      hourValue.textContent = model.bestHour == null ? "—" : money.format(model.bestHourGross);
      hourLabel.textContent = model.bestHour == null ? "Sin horas registradas" :
        String(model.bestHour).padStart(2, "0") + ":00 · hora pico";
    } else {
      const row = model.hours[hour];
      hourValue.textContent = money.format(row.gross);
      hourLabel.textContent = String(hour).padStart(2, "0") + ":00 · " + row.trips + " viajes";
    }
    drawHours();
  };
  selectHour(selectedHour);
  const onHourMove = (event) => {
    const rect = hoursCanvas.getBoundingClientRect();
    hourPointer = event.clientX - rect.left;
    selectHour(Math.max(0, Math.min(23, Math.floor(hourPointer / Math.max(rect.width / 24, 1)))));
  };
  const onHourLeave = () => {
    hourPointer = null;
    selectHour(model.bestHour);
  };
  hoursCanvas.addEventListener("pointermove", onHourMove);
  hoursCanvas.addEventListener("pointerleave", onHourLeave);
  addCleanup(() => {
    hoursCanvas.removeEventListener("pointermove", onHourMove);
    hoursCanvas.removeEventListener("pointerleave", onHourLeave);
  });

  const ringCanvas = container.querySelector('[data-chart="ring"]');
  const ringValue = container.querySelector("[data-ring-value]");
  const ringLabel = container.querySelector("[data-ring-label]");
  let ringPointer = null;
  let ringFrame = 0;
  let ringPhase = 0;
  let ringVisible = true;

  const bandForHour = (hour) => model.bands.find((band) =>
    band.start != null && hour >= band.start && hour < band.end
  );
  const hourForFraction = (fraction) => {
    if (!model.hourGross) return null;
    const target = fraction * model.hourGross;
    let accumulated = 0;
    for (const row of model.hours) {
      accumulated += row.gross;
      if (accumulated >= target && row.gross > 0) return row.hour;
    }
    return model.bestHour;
  };
  const drawRing = () => {
    const surface = canvasSize(ringCanvas);
    if (!surface) return;
    const ctx = surface.ctx, width = surface.width, height = surface.height;
    const cx = width / 2, cy = height / 2;
    ctx.clearRect(0, 0, width, height);
    if (!model.hourGross) {
      ctx.fillStyle = "#a1a1a8";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Sin horas válidas", cx, cy);
      return;
    }
    const count = 120;
    const inner = Math.min(width, height) * .25;
    const outerBase = Math.min(width, height) * .39;
    const pointerAngle = ringPointer == null ? null :
      Math.atan2(ringPointer.y - cy, ringPointer.x - cx);
    const angleStart = -Math.PI / 2;
    const hoursCumulative = [];
    let sum = 0;
    for (const row of model.hours) {
      sum += row.gross;
      hoursCumulative.push(sum);
    }
    for (let index = 0; index < count; index += 1) {
      const fraction = (index + .5) / count;
      const hour = hourForFraction(fraction);
      const band = hour == null ? null : bandForHour(hour);
      const angle = angleStart + fraction * Math.PI * 2;
      let reach = 0;
      if (pointerAngle != null) {
        const distance = Math.atan2(Math.sin(angle - pointerAngle), Math.cos(angle - pointerAngle));
        reach = Math.max(0, 1 - Math.abs(distance) / .52) * 34;
      }
      const outer = outerBase + reach + (ringPointer && !reduceMotion ? Math.sin(index * .45 + ringPhase) * 1.8 : 0);
      ctx.strokeStyle = band?.color ?? "#30d158";
      ctx.globalAlpha = band ? .92 : .3;
      ctx.lineWidth = reach > 15 ? 2.2 : 1.5;
      if (reach > 15) {
        ctx.shadowColor = "rgba(48,209,88,.75)";
        ctx.shadowBlur = 7;
      }
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  };
  const updateRingReadout = () => {
    let hour = model.bestHour;
    if (ringPointer && model.hourGross) {
      const rect = ringCanvas.getBoundingClientRect();
      const angle = Math.atan2(ringPointer.y - rect.height / 2, ringPointer.x - rect.width / 2);
      const fraction = ((angle + Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
      hour = hourForFraction(fraction);
    }
    if (hour == null) {
      ringValue.textContent = "—";
      ringLabel.textContent = "Sin datos horarios";
      return;
    }
    ringValue.textContent = money.format(model.hours[hour].gross);
    ringLabel.textContent = String(hour).padStart(2, "0") + ":00 · " + model.hours[hour].trips + " viajes";
  };
  const stopRing = () => {
    if (ringFrame) cancelAnimationFrame(ringFrame);
    ringFrame = 0;
  };
  const animateRing = () => {
    if (ringFrame || reduceMotion || !ringPointer || !ringVisible) return;
    const frame = () => {
      ringPhase += .06;
      drawRing();
      if (ringPointer && ringVisible) ringFrame = requestAnimationFrame(frame);
      else ringFrame = 0;
    };
    ringFrame = requestAnimationFrame(frame);
  };
  const onRingMove = (event) => {
    const rect = ringCanvas.getBoundingClientRect();
    ringPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    updateRingReadout();
    drawRing();
    animateRing();
  };
  const onRingLeave = () => {
    ringPointer = null;
    stopRing();
    updateRingReadout();
    drawRing();
  };
  ringCanvas.addEventListener("pointermove", onRingMove);
  ringCanvas.addEventListener("pointerleave", onRingLeave);
  addCleanup(() => {
    ringCanvas.removeEventListener("pointermove", onRingMove);
    ringCanvas.removeEventListener("pointerleave", onRingLeave);
  });
  updateRingReadout();

  const redraw = () => {
    drawDays();
    drawHours();
    drawRing();
  };
  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(redraw);
    resizeObserver.observe(container);
    addCleanup(() => resizeObserver.disconnect());
  } else {
    window.addEventListener("resize", redraw);
    addCleanup(() => window.removeEventListener("resize", redraw));
  }
  let intersectionObserver = null;
  if (typeof IntersectionObserver === "function") {
    intersectionObserver = new IntersectionObserver((entries) => {
      ringVisible = entries.some((entry) => entry.isIntersecting);
      if (!ringVisible) stopRing();
      else if (ringPointer) animateRing();
    });
    intersectionObserver.observe(container);
    addCleanup(() => intersectionObserver.disconnect());
  }
  redraw();

  const cleanup = () => {
    stopRing();
    cleanups.forEach((callback) => callback());
    container.replaceChildren();
    mounted.delete(container);
  };
  mounted.set(container, cleanup);
}
