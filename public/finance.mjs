export const ETIOS_BASELINE_L_PER_100KM = 8.8;

export const MONTHLY_COST_FIELDS = [
  "insurance",
  "maintenance",
  "tires",
  "tax",
  "other"
];

function amount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function calculateTripNetAfterFuel({ tripGross = 0, fuelPurchaseSpend = 0 } = {}) {
  return Math.round((amount(tripGross) - amount(fuelPurchaseSpend) + Number.EPSILON) * 100) / 100;
}

export function dashboardRangeFromSearch(search = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\\?/, ""));
  const value = params.get("range");
  if (value === "all") return 0;
  const range = Number(value);
  return [1, 7, 30].includes(range) ? range : 30;
}

export function dashboardUrlWithRange(pathname, search, hash, range) {
  const days = Number(range);
  if (![0, 1, 7, 30].includes(days)) throw new Error("Unsupported dashboard range");
  const params = new URLSearchParams(String(search || "").replace(/^\\?/, ""));
  if (days === 30) params.delete("range");
  else params.set("range", days === 0 ? "all" : String(days));
  const query = params.toString();
  return String(pathname || "/") + (query ? "?" + query : "") + String(hash || "");
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function selectFuelPurchasesForPeriod(fuelLogs, { range = 30, from = null, to = null } = {}) {
  return (Array.isArray(fuelLogs) ? fuelLogs : []).filter((row) => {
    if (amount(row?.total_ars) <= 0) return false;
    if (!row?.date || range === 0) return true;
    if (!validDate(row.date)) return false;
    return (!from || row.date >= from) && (!to || row.date <= to);
  });
}

export function mergePriceHistory(savedHistory, defaultHistory = []) {
  const snapshots = new Map();
  for (const rows of [defaultHistory, savedHistory]) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object" || !validDate(row.effective_from)) continue;
      snapshots.set(row.effective_from, row);
    }
  }
  return [...snapshots.values()].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}

export function priceForDate(history, date) {
  const snapshots = (Array.isArray(history) ? history : [])
    .filter((row) => validDate(row.effective_from) && amount(row.price_ars_per_liter) > 0)
    .slice()
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  if (!snapshots.length || !validDate(date)) return null;
  const eligible = snapshots.filter((row) => row.effective_from <= date);
  return eligible.length ? eligible[eligible.length - 1] : null;
}

export function estimateFuelForDistance(km, date, priceHistory, consumptionLPer100Km = ETIOS_BASELINE_L_PER_100KM) {
  const distance = amount(km);
  const consumption = amount(consumptionLPer100Km);
  const price = priceForDate(priceHistory, date);
  if (!(distance > 0) || !(consumption > 0) || !price) return null;
  const liters = distance * consumption / 100;
  return {
    km: distance,
    liters: Math.round((liters + Number.EPSILON) * 10000) / 10000,
    priceArsPerLiter: Number(price.price_ars_per_liter),
    priceEffectiveFrom: price.effective_from,
    costArs: Math.round((liters * Number(price.price_ars_per_liter) + Number.EPSILON) * 100) / 100
  };
}

export function summarizeEarnings({ trips = [], rewards = [], sessions = [], fuelLogs = [], priceHistory = [] } = {}) {
  const consumption = measuredConsumption(fuelLogs);
  const days = new Map();
  const dayFor = (date) => {
    if (!validDate(date)) return null;
    if (!days.has(date)) {
      days.set(date, {
        date, tripCount: 0, tripGross: 0, rewardGross: 0, gross: 0,
        actualTripCount: 0, actualPassengerKm: 0,
        estimatedTripCount: 0, estimatedRouteKm: 0,
        vehicleKm: 0, sessions: 0, sessionsWithoutOdometer: 0,
        fuelKm: 0, fuelLiters: 0, fuelCost: null, fuelMode: "unavailable",
        netAfterFuelPartial: null, priceEffectiveFrom: null,
        consumptionLPer100Km: consumption.value, consumptionSource: consumption.source
      });
    }
    return days.get(date);
  };

  for (const row of trips) {
    const day = dayFor(row.date);
    if (!day) continue;
    day.tripCount += 1;
    day.tripGross += amount(row.amount);
    const km = amount(row.km);
    const source = row.km_source ?? (km > 0 ? "actual" : "unknown");
    if (km > 0 && source === "actual") {
      day.actualTripCount += 1;
      day.actualPassengerKm += km;
    } else if (km > 0 && source === "estimated") {
      day.estimatedTripCount += 1;
      day.estimatedRouteKm += km;
    }
  }
  for (const row of rewards) {
    const day = dayFor(row.date);
    if (day) day.rewardGross += amount(row.amount);
  }
  for (const row of sessions) {
    const day = dayFor(row.date);
    if (!day) continue;
    day.sessions += 1;
    if (row.odometer_km != null && Number.isFinite(Number(row.odometer_km)) && Number(row.odometer_km) > 0) {
      day.vehicleKm += Number(row.odometer_km);
    } else {
      day.sessionsWithoutOdometer += 1;
    }
  }

  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of daily) {
    day.gross = day.tripGross + day.rewardGross;
    day.fuelKm = day.vehicleKm > 0 ? day.vehicleKm : day.actualPassengerKm;
    day.fuelMode = day.vehicleKm > 0
      ? (day.sessionsWithoutOdometer > 0 ? "vehicle_odometer_partial" : "vehicle_odometer")
      : day.actualPassengerKm > 0 ? "passenger_km_partial" : "unavailable";
    const estimate = estimateFuelForDistance(day.fuelKm, day.date, priceHistory, consumption.value);
    if (estimate) {
      day.fuelLiters = estimate.liters;
      day.fuelCost = estimate.costArs;
      day.priceEffectiveFrom = estimate.priceEffectiveFrom;
      day.netAfterFuelPartial = Math.round((day.gross - day.fuelCost + Number.EPSILON) * 100) / 100;
    }
    for (const key of ["tripGross", "rewardGross", "gross", "actualPassengerKm", "estimatedRouteKm", "vehicleKm", "fuelKm"]) {
      day[key] = Math.round((day[key] + Number.EPSILON) * 100) / 100;
    }
  }

  const monthMap = new Map();
  for (const day of daily) {
    const monthKey = day.date.slice(0, 7);
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        month: monthKey, tripCount: 0, tripGross: 0, rewardGross: 0, gross: 0,
        actualTripCount: 0, actualPassengerKm: 0,
        estimatedTripCount: 0, estimatedRouteKm: 0,
        vehicleKm: 0, sessions: 0, sessionsWithoutOdometer: 0,
        fuelKm: 0, fuelLiters: 0, fuelCostKnown: 0, missingPriceDays: 0,
        fuelCost: null, netAfterFuelPartial: null,
        consumptionLPer100Km: consumption.value, consumptionSource: consumption.source
      });
    }
    const month = monthMap.get(monthKey);
    for (const key of ["tripCount","tripGross","rewardGross","gross","actualTripCount","actualPassengerKm","estimatedTripCount","estimatedRouteKm","vehicleKm","sessions","sessionsWithoutOdometer","fuelKm","fuelLiters"]) {
      month[key] += day[key];
    }
    if (day.fuelKm > 0 && day.fuelCost == null) month.missingPriceDays += 1;
    if (day.fuelCost != null) month.fuelCostKnown += day.fuelCost;
  }

  const monthly = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const month of monthly) {
    if (month.fuelKm > 0 && month.missingPriceDays === 0) {
      month.fuelCost = Math.round((month.fuelCostKnown + Number.EPSILON) * 100) / 100;
      month.netAfterFuelPartial = Math.round((month.gross - month.fuelCost + Number.EPSILON) * 100) / 100;
    }
    delete month.fuelCostKnown;
    for (const key of ["tripGross","rewardGross","gross","actualPassengerKm","estimatedRouteKm","vehicleKm","fuelKm","fuelLiters"]) {
      month[key] = Math.round((month[key] + Number.EPSILON) * 100) / 100;
    }
  }
  return { daily, monthly };
}

function measuredConsumption(fuelLogs) {
  const rows = (Array.isArray(fuelLogs) ? fuelLogs : [])
    .filter((row) => (row.full_tank === true || row.full_tank === 1) &&
      row.odometer_km != null && Number.isFinite(Number(row.odometer_km)) &&
      Number(row.odometer_km) >= 0 && amount(row.liters) > 0)
    .slice()
    .sort((a, b) => Number(a.odometer_km) - Number(b.odometer_km));
  if (rows.length < 2) {
    return { value: ETIOS_BASELINE_L_PER_100KM, source: "road_test_reference" };
  }

  let litres = 0;
  let kilometres = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const previous = Number(rows[i - 1].odometer_km);
    const current = Number(rows[i].odometer_km);
    const delta = current - previous;
    if (!(delta > 0)) continue;
    const intervalLitres = (Array.isArray(fuelLogs) ? fuelLogs : [])
      .filter((row) => Number(row.odometer_km) > previous &&
        Number(row.odometer_km) <= current)
      .reduce((sum, row) => sum + amount(row.liters), 0);
    if (intervalLitres > 0) {
      litres += intervalLitres;
      kilometres += delta;
    }
  }
  if (!(litres > 0 && kilometres > 0)) {
    return { value: ETIOS_BASELINE_L_PER_100KM, source: "road_test_reference" };
  }
  return {
    value: litres / kilometres * 100,
    source: "tank_to_tank"
  };
}

function groupedDistance(rows, getDistance) {
  const grouped = new Map();
  for (const row of rows) {
    if (!validDate(row.date)) continue;
    const km = amount(getDistance(row));
    if (km <= 0) continue;
    grouped.set(row.date, (grouped.get(row.date) ?? 0) + km);
  }
  return grouped;
}

export function calculateProfitability({
  trips = [],
  rewards = [],
  sessions = [],
  fuelLogs = [],
  priceHistory = [],
  monthlyCosts = {},
  oneOffExpenses = [],
  fuelPurchases = null,
  periodDays = 30
} = {}) {
  const tripGross = trips.reduce((sum, row) => sum + amount(row.amount), 0);
  const rewardGross = rewards.reduce((sum, row) => sum + amount(row.amount), 0);
  const gross = tripGross + rewardGross;

  const actualPassengerKm = trips.reduce((sum, row) => {
    const km = amount(row.km);
    const source = row.km_source ?? (km > 0 ? "actual" : "unknown");
    return sum + (km > 0 && source === "actual" ? km : 0);
  }, 0);
  const estimatedPassengerKm = trips.reduce((sum, row) =>
    sum + (row.km_source === "estimated" ? amount(row.km) : 0), 0
  );

  const vehicleDistanceByDate = groupedDistance(
    sessions,
    (row) => row.odometer_km
  );
  const vehicleKm = [...vehicleDistanceByDate.values()].reduce((sum, km) => sum + km, 0);
  const activeTripDates = new Set(trips.map((row) => row.date).filter(validDate));
  const odometerDates = new Set(sessions
    .filter((row) => row.odometer_km != null && amount(row.odometer_km) > 0)
    .map((row) => row.date)
    .filter(validDate));
  const odometerComplete = sessions.length > 0 &&
    activeTripDates.size > 0 &&
    sessions.every((row) => row.odometer_km != null && amount(row.odometer_km) > 0) &&
    [...activeTripDates].every((date) => odometerDates.has(date));
  const fuelMode = vehicleKm > 0
    ? (odometerComplete ? "vehicle_odometer" : "vehicle_odometer_partial")
    : actualPassengerKm > 0
      ? "passenger_km_partial"
      : "unavailable";

  const passengerDistanceByDate = groupedDistance(
    trips.filter((row) => {
      const km = amount(row.km);
      const source = row.km_source ?? (km > 0 ? "actual" : "unknown");
      return km > 0 && source === "actual";
    }),
    (row) => row.km
  );
  const fuelDistanceByDate = fuelMode.startsWith("vehicle_odometer")
    ? vehicleDistanceByDate
    : fuelMode === "passenger_km_partial"
      ? passengerDistanceByDate
      : new Map();

  const consumption = measuredConsumption(fuelLogs);
  let fuelKm = 0;
  let fuelLiters = 0;
  let fuelCost = 0;
  let missingPriceDates = 0;
  for (const [date, km] of fuelDistanceByDate) {
    const price = priceForDate(priceHistory, date);
    if (!price) {
      missingPriceDates += 1;
      continue;
    }
    const litres = km * consumption.value / 100;
    fuelKm += km;
    fuelLiters += litres;
    fuelCost += litres * Number(price.price_ars_per_liter);
  }
  if (fuelDistanceByDate.size === 0 || missingPriceDates === fuelDistanceByDate.size) {
    fuelCost = null;
  } else {
    fuelCost = Math.round((fuelCost + Number.EPSILON) * 100) / 100;
  }

  const missingCosts = MONTHLY_COST_FIELDS.filter((key) => {
    const value = monthlyCosts[key];
    return value == null || String(value).trim() === "" ||
      !Number.isFinite(Number(value)) || Number(value) < 0;
  });
  const fixedMonthly = MONTHLY_COST_FIELDS.reduce((sum, key) =>
    sum + (missingCosts.includes(key) ? 0 : Number(monthlyCosts[key])), 0
  );
  const days = Math.max(0, Number(periodDays) || 0);
  const fixedCosts = Math.round((fixedMonthly * days / 30 + Number.EPSILON) * 100) / 100;
  const oneOffCosts = Math.round((oneOffExpenses.reduce((sum, row) => sum + amount(row.amount_ars), 0) + Number.EPSILON) * 100) / 100;
  const otherCosts = fixedCosts + oneOffCosts;
  const purchases = Array.isArray(fuelPurchases) ? fuelPurchases : fuelLogs;
  const fuelPurchaseSpend = Math.round((purchases.reduce((sum, row) => sum + amount(row.total_ars), 0) + Number.EPSILON) * 100) / 100;
  const netCashAfterFuelPurchases = Math.round((gross - fuelPurchaseSpend - otherCosts + Number.EPSILON) * 100) / 100;
  const totalKnownCosts = (fuelCost ?? 0) + otherCosts;
  const netPartial = fuelCost == null ? null : Math.round((gross - totalKnownCosts + Number.EPSILON) * 100) / 100;
  const netComplete = netPartial != null &&
    odometerComplete &&
    missingCosts.length === 0 &&
    missingPriceDates === 0;
  const netOperating = netComplete ? netPartial : null;

  return {
    gross,
    tripGross,
    rewardGross,
    actualPassengerKm,
    estimatedPassengerKm,
    vehicleKm,
    odometerComplete,
    fuelMode,
    fuelKm,
    fuelLiters,
    fuelCost,
    consumptionLPer100Km: consumption.value,
    consumptionSource: consumption.source,
    fixedMonthly,
    fixedCosts,
    oneOffCosts,
    otherCosts,
    totalKnownCosts,
    fuelPurchaseSpend,
    netCashAfterFuelPurchases,
    netPartial,
    netOperating,
    netComplete,
    missingCosts,
    missingPriceDates
  };
}

export function createWorkSession(input = {}) {
  const date = input.date;
  if (!validDate(date)) throw new Error("date must be YYYY-MM-DD");
  const connected_start = input.connected_start;
  const connected_end = input.connected_end;
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(String(connected_start || ""))) throw new Error("connected_start must be HH:mm");
  if (!timePattern.test(String(connected_end || ""))) throw new Error("connected_end must be HH:mm");
  const toMinutes = (value) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = toMinutes(connected_start);
  let end = toMinutes(connected_end);
  if (end <= start) end += 24 * 60;
  const connected_minutes = end - start;
  if (connected_minutes > 16 * 60) throw new Error("connected session cannot exceed 16 hours");

  const odometer_start = Number(input.odometer_start);
  const odometer_end = Number(input.odometer_end);
  if (!Number.isFinite(odometer_start) || odometer_start < 0) throw new Error("odometer_start must be non-negative");
  if (!Number.isFinite(odometer_end) || odometer_end <= odometer_start) throw new Error("odometer_end must be greater than odometer_start");
  const platform = String(input.platform || "didi").trim().toLowerCase();
  if (!["didi","uber"].includes(platform)) throw new Error("platform must be didi or uber");
  const id = input.id || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "local-session-" + Date.now());
  return {
    id, date, platform, connected_start, connected_end, connected_minutes,
    odometer_start, odometer_end, odometer_km: odometer_end - odometer_start
  };
}

export function createFuelEntry(input = {}) {
  const date = input.date == null || String(input.date).trim() === "" ? null : input.date;
  if (date !== null && !validDate(date)) throw new Error("date must be YYYY-MM-DD");

  const rawOdometer = input.odometer_km;
  const odometer_km = rawOdometer == null || String(rawOdometer).trim() === ""
    ? null
    : Number(rawOdometer);
  if (odometer_km !== null && (!Number.isFinite(odometer_km) || odometer_km < 0)) {
    throw new Error("odometer must be non-negative");
  }

  const rawLiters = input.liters;
  const liters = rawLiters == null || String(rawLiters).trim() === ""
    ? null
    : Number(rawLiters);
  if (liters !== null && (!Number.isFinite(liters) || liters <= 0 || liters > 200)) {
    throw new Error("liters must be between 0 and 200");
  }

  const total_ars = Number(input.total_ars);
  if (!Number.isFinite(total_ars) || total_ars <= 0) throw new Error("total amount must be positive");
  const station = String(input.station || "").trim().slice(0,60);
  const full_tank = input.full_tank === true || input.full_tank === 1 ? 1 : 0;
  const id = input.id || (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "local-fuel-" + Date.now());
  return {
    id, date, odometer_km, liters, total_ars,
    price_per_liter: liters == null ? null : total_ars / liters,
    station, full_tank
  };
}
