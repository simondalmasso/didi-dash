const COMPONENTS = [
  { code: "distancia", label: "Tarifa por distancia", legacy: "distance_ars" },
  { code: "tiempo", label: "Tarifa por tiempo", legacy: "time_ars" },
  { code: "espera", label: "Tarifa por espera", legacy: "wait_ars" },
  { code: "base_dinamica", label: "Tarifa base dinámica", legacy: "dynamic_base_ars" },
  { code: "diferencial", label: "Precio diferencial", legacy: "differential_price_ars" },
  { code: "reembolso_tarifario", label: "Reembolso tarifario", legacy: "fare_reimbursement_ars" }
];
const COMPONENT_BY_CODE = new Map(COMPONENTS.map((item) => [item.code, item]));
const PRIME_HOURS = new Set([7, 8, 9, 17, 18, 19, 20, 21, 22]);

function validAmount(value) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isInteger(amount) && amount >= 0 && amount <= 100000000 ? amount : null;
}

function cleanCanonicalComponents(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const amount = validAmount(item.amount);
    if (amount == null) continue;
    const known = COMPONENT_BY_CODE.get(item.code);
    const code = known ? known.code : "otro";
    const label = typeof item.label === "string" && item.label.trim()
      ? item.label.trim().slice(0, 48)
      : known?.label ?? "Otro";
    result.push({ code, label, amount });
  }
  return result;
}

export function readTripBreakdown(trip) {
  if (!trip || typeof trip !== "object") {
    return { status: "missing", components: [], total: 0, missingAmount: 0 };
  }
  const tripAmount = validAmount(trip.amount) ?? 0;
  const canonical = trip.breakdown;
  if (canonical && typeof canonical === "object" && !Array.isArray(canonical)) {
    if (canonical.source !== "actual") {
      return { status: "missing", components: [], total: 0, missingAmount: tripAmount };
    }
    const components = cleanCanonicalComponents(canonical.components);
    const total = components.reduce((sum, item) => sum + item.amount, 0);
    const reconciled = components.length > 0 && Math.abs(total - tripAmount) <= 2;
    return {
      status: reconciled ? "verified" : "partial",
      components,
      total,
      missingAmount: Math.max(0, tripAmount - total),
      difference: total - tripAmount
    };
  }

  const legacy = trip.fare_breakdown;
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    const components = COMPONENTS.flatMap((item) => {
      const amount = validAmount(legacy[item.legacy]);
      return amount == null ? [] : [{ code: item.code, label: item.label, amount }];
    });
    const total = components.reduce((sum, item) => sum + item.amount, 0);
    if (!components.length) {
      return { status: "missing", components: [], total: 0, missingAmount: tripAmount };
    }
    const reconciled = trip.detail_verified === true && Math.abs(total - tripAmount) <= 2;
    return {
      status: reconciled ? "verified" : "partial",
      components,
      total,
      missingAmount: Math.max(0, tripAmount - total),
      difference: total - tripAmount
    };
  }

  if (trip.breakdown_status === "review") {
    return { status: "partial", components: [], total: 0, missingAmount: tripAmount };
  }
  return { status: "missing", components: [], total: 0, missingAmount: tripAmount };
}

function inRange(date, from, to) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return (!from || date >= from) && (!to || date <= to);
}

function tripDurationSeconds(trip) {
  const seconds = Number(trip.duration_seconds);
  if (Number.isInteger(seconds) && seconds > 0 && seconds <= 86400) return seconds;
  const minutes = Number(trip.min);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 1440
    ? Math.round(minutes * 60)
    : 0;
}

export function deduplicateWorkSessions(sessions) {
  const seen = new Set();
  return (Array.isArray(sessions) ? sessions : []).filter((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const identityParts = [
      row.date,
      String(row.platform ?? "").toLowerCase(),
      row.connected_start,
      row.connected_end
    ];
    const hasNaturalIdentity = identityParts.every((part) =>
      typeof part === "string" && part.length > 0
    );
    const identity = hasNaturalIdentity
      ? identityParts.join("|")
      : typeof row.id === "string" && row.id ? "id:" + row.id : null;
    if (identity == null) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function buildDataFina({
  trips = [],
  sessions = [],
  rewards = [],
  fuel = [],
  withdrawalFees = [],
  from = null,
  to = null,
  dailyGoal = 80000
} = {}) {
  const selectedTrips = (Array.isArray(trips) ? trips : []).filter((row) => inRange(row?.date, from, to));
  const selectedSessions = deduplicateWorkSessions(
    (Array.isArray(sessions) ? sessions : []).filter((row) => inRange(row?.date, from, to))
  );
  const recordedSessions = selectedSessions.filter((row) => {
    const minutes = Number(row?.connected_minutes);
    return Number.isFinite(minutes) && minutes > 0;
  });
  const connectedMinutes = recordedSessions.reduce((sum, row) => sum + Number(row.connected_minutes), 0);
  const connectedHours = recordedSessions.length ? connectedMinutes / 60 : null;
  const selectedRewards = (Array.isArray(rewards) ? rewards : []).filter((row) => inRange(row?.date, from, to));
  const selectedWithdrawalFees = (Array.isArray(withdrawalFees) ? withdrawalFees : [])
    .filter((row) => inRange(row?.date, from, to));
  // Undated fuel remains in cash outflow for every range but never joins a dated chart.
  const selectedFuel = (Array.isArray(fuel) ? fuel : []).filter((row) =>
    !row?.date || inRange(row.date, from, to)
  );

  const tripGross = selectedTrips.reduce((sum, row) => sum + (validAmount(row.amount) ?? 0), 0);
  const rewardGross = selectedRewards.reduce((sum, row) => sum + (validAmount(row.amount) ?? 0), 0);
  const fuelSpend = selectedFuel.reduce((sum, row) => sum + (validAmount(row.total_ars) ?? 0), 0);
  const withdrawalEvidence = selectedWithdrawalFees.length > 0 && selectedWithdrawalFees.every((row) =>
    row?.reconciled === true && validAmount(row.fee_ars) != null
  );
  const withdrawalFeeSpend = withdrawalEvidence
    ? selectedWithdrawalFees.reduce((sum, row) => sum + validAmount(row.fee_ars), 0)
    : null;
  const withdrawalFeeCount = withdrawalEvidence
    ? selectedWithdrawalFees.filter((row) => validAmount(row.fee_ars) > 0).length
    : null;
  const undatedFuel = selectedFuel.filter((row) => !row?.date);
  const undatedFuelSpend = undatedFuel.reduce((sum, row) => sum + (validAmount(row.total_ars) ?? 0), 0);
  const actualKmTrips = selectedTrips.filter((row) =>
    row.km_source === "actual" && Number.isFinite(Number(row.km)) && Number(row.km) > 0
  );
  const durationTrips = selectedTrips.filter((row) => tripDurationSeconds(row) > 0);
  const actualKm = actualKmTrips.reduce((sum, row) => sum + Number(row.km), 0);
  const actualKmGross = actualKmTrips.reduce((sum, row) => sum + (validAmount(row.amount) ?? 0), 0);
  const durationCoveredGross = durationTrips.reduce((sum, row) => sum + (validAmount(row.amount) ?? 0), 0);
  const reportedSeconds = durationTrips.reduce((sum, row) => sum + tripDurationSeconds(row), 0);

  const categoryTotals = new Map();
  let unclassifiedTrips = 0;
  for (const trip of selectedTrips) {
    const serviceType = typeof trip.service_type === "string" && trip.service_type.trim()
      ? trip.service_type.trim()
      : typeof trip.modality === "string" && trip.modality.trim()
        ? trip.modality.trim()
        : null;
    if (!serviceType) {
      unclassifiedTrips += 1;
      continue;
    }
    const current = categoryTotals.get(serviceType) ?? { serviceType, trips: 0, gross: 0 };
    current.trips += 1;
    current.gross += validAmount(trip.amount) ?? 0;
    categoryTotals.set(serviceType, current);
  }

  const componentTotals = new Map(COMPONENTS.map((item) => [
    item.code, { ...item, amount: 0, trips: 0 }
  ]));
  let verifiedTrips = 0;
  let partialTrips = 0;
  let missingTrips = 0;
  let verifiedGross = 0;
  let partialGross = 0;
  let missingGross = 0;
  for (const trip of selectedTrips) {
    const breakdown = readTripBreakdown(trip);
    if (breakdown.status === "verified") {
      verifiedTrips += 1;
      verifiedGross += Number(trip.amount) || 0;
      for (const component of breakdown.components) {
        const current = componentTotals.get(component.code) ??
          { code: component.code, label: component.label, legacy: null, amount: 0, trips: 0 };
        current.amount += component.amount;
        current.trips += 1;
        componentTotals.set(component.code, current);
      }
    } else if (breakdown.status === "partial") {
      partialTrips += 1;
      partialGross += Number(trip.amount) || 0;
    } else {
      missingTrips += 1;
      missingGross += Number(trip.amount) || 0;
    }
  }
  const verifiedBreakdownTotal = [...componentTotals.values()]
    .reduce((sum, component) => sum + component.amount, 0);
  const unallocatedGross = partialGross + missingGross;

  const daysMap = new Map();
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour, gross: 0, trips: 0, prime: PRIME_HOURS.has(hour)
  }));
  let primeGross = 0;
  for (const trip of selectedTrips) {
    const amount = validAmount(trip.amount) ?? 0;
    const day = daysMap.get(trip.date) ?? { date: trip.date, gross: 0, trips: 0 };
    day.gross += amount;
    day.trips += 1;
    daysMap.set(trip.date, day);
    const hour = Number(String(trip.start ?? "").slice(0, 2));
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
      hours[hour].gross += amount;
      hours[hour].trips += 1;
      if (PRIME_HOURS.has(hour)) primeGross += amount;
    }
  }
  const goal = Number.isFinite(Number(dailyGoal)) && Number(dailyGoal) > 0
    ? Number(dailyGoal)
    : 80000;
  const days = [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({ ...day, metGoal: day.gross >= goal }));
  const activeDays = days.length;
  const workDates = new Set([
    ...selectedTrips.map((row) => row.date),
    ...recordedSessions.map((row) => row.date)
  ]);
  const workDays = workDates.size;
  const workSessionCount = recordedSessions.length;
  const daysAtGoal = days.filter((day) => day.metGoal).length;
  const bestHour = hours.reduce((best, item) =>
    item.gross > (best?.gross ?? -1) ? item : best, null);
  // Unknown withdrawal evidence is displayed as unknown; cash net keeps an explicit zero-fee assumption for arithmetic only.
  const cashNet = tripGross + rewardGross - fuelSpend - (withdrawalFeeSpend ?? 0);
  const passengerHours = reportedSeconds / 3600;
  const TIME_BANDS = [
    { label: "18–20", startHour: 18, endHour: 20 },
    { label: "20–22", startHour: 20, endHour: 22 },
    { label: "22–24", startHour: 22, endHour: 24 }
  ];
  const MIN_TIME_BAND_TRIPS = 5;
  const MIN_TIME_BAND_DATES = 2;
  const MIN_TIME_BAND_COVERAGE_PERCENT = 90;
  const timeBands = TIME_BANDS.map((band) => {
    const rows = selectedTrips.filter((row) => {
      const hour = Number(String(row.start ?? "").slice(0, 2));
      return Number.isInteger(hour) && hour >= band.startHour && hour < band.endHour;
    });
    const withDuration = rows.filter((row) => tripDurationSeconds(row) > 0);
    const coveredGross = withDuration.reduce((sum, row) => sum + (validAmount(row.amount) ?? 0), 0);
    const durationSeconds = withDuration.reduce((sum, row) => sum + tripDurationSeconds(row), 0);
    const coveragePercent = rows.length ? withDuration.length / rows.length * 100 : 0;
    const dateCount = new Set(rows.map((row) => row.date).filter((date) => inRange(date, from, to))).size;
    const grossPerPassengerHour = durationSeconds > 0 ? coveredGross / (durationSeconds / 3600) : null;
    const ranked = rows.length >= MIN_TIME_BAND_TRIPS && dateCount >= MIN_TIME_BAND_DATES && coveragePercent >= MIN_TIME_BAND_COVERAGE_PERCENT && grossPerPassengerHour != null;
    return {
      ...band,
      tripCount: rows.length,
      durationTrips: withDuration.length,
      coveragePercent,
      coveredGross,
      durationSeconds,
      dateCount,
      grossPerPassengerHour,
      ranked,
      reason: ranked ? null : rows.length < MIN_TIME_BAND_TRIPS ? "muestra menor a 5 viajes" : dateCount < MIN_TIME_BAND_DATES ? "menos de 2 fechas con actividad" : coveragePercent < MIN_TIME_BAND_COVERAGE_PERCENT ? "cobertura de duración menor a 90%" : "sin duración observada"
    };
  });
  const rankedTimeBands = timeBands.filter((band) => band.ranked).slice().sort((a, b) =>
    b.grossPerPassengerHour - a.grossPerPassengerHour
  );

  return {
    tripCount: selectedTrips.length,
    gross: tripGross,
    rewardGross,
    fuelSpend,
    withdrawalFeeSpend,
    withdrawalFeeCount,
    withdrawalRecordCount: selectedWithdrawalFees.length,
    withdrawalUnreconciledCount: withdrawalEvidence ? 0 : selectedWithdrawalFees.length,
    withdrawalEvidence,
    cashNet,
    cashNetAssumesZeroWithdrawalFees: !withdrawalEvidence,
    undatedFuelCount: undatedFuel.length,
    undatedFuelSpend,
    actualKm,
    actualKmGross,
    actualKmTrips: actualKmTrips.length,
    durationTrips: durationTrips.length,
    durationCoveredGross,
    reportedSeconds,
    passengerHours,
    workDays,
    workSessionCount,
    connectedMinutes,
    connectedHours,
    grossPerPassengerHour: passengerHours > 0 ? durationCoveredGross / passengerHours : null,
    timeBands,
    rankedTimeBands,
    timeBandMinCoveragePercent: MIN_TIME_BAND_COVERAGE_PERCENT,
    timeBandMinTrips: MIN_TIME_BAND_TRIPS,
    timeBandMinDates: MIN_TIME_BAND_DATES,
    grossPerKm: actualKm > 0 ? actualKmGross / actualKm : null,
    cashMarginPerKm: null,
    categoryCoverage: {
      classifiedTrips: selectedTrips.length - unclassifiedTrips,
      unclassifiedTrips,
      coveragePercent: selectedTrips.length
        ? (selectedTrips.length - unclassifiedTrips) / selectedTrips.length * 100
        : 0,
      byType: [...categoryTotals.values()].sort((a, b) => a.serviceType.localeCompare(b.serviceType, "es"))
    },
    dailyAverage: activeDays > 0
      ? days.reduce((sum, day) => sum + day.gross, 0) / activeDays
      : null,
    dailyGoal: goal,
    activeDays,
    daysAtGoal,
    days,
    hours,
    primeGross,
    primeSharePercent: tripGross > 0 ? primeGross / tripGross * 100 : 0,
    bestHour: bestHour?.trips ? bestHour.hour : null,
    bestHourGross: bestHour?.trips ? bestHour.gross : 0,
    components: [...componentTotals.values()]
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    breakdown: {
      verifiedTrips,
      partialTrips,
      missingTrips,
      coveragePercent: selectedTrips.length ? verifiedTrips / selectedTrips.length * 100 : 0,
      verifiedGross,
      partialGross,
      missingGross,
      unallocatedGross,
      verifiedBreakdownTotal
    }
  };
}

export const DATA_FINA_COMPONENTS = COMPONENTS.map(({ code, label }) => ({ code, label }));
