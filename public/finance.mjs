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

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function priceForDate(history, date) {
  const snapshots = (Array.isArray(history) ? history : [])
    .filter((row) => validDate(row.effective_from) && amount(row.price_ars_per_liter) > 0)
    .slice()
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  if (!snapshots.length) return null;
  const eligible = snapshots.filter((row) => row.effective_from <= date);
  return eligible.length ? eligible[eligible.length - 1] : snapshots[0];
}

function measuredConsumption(fuelLogs) {
  const rows = (Array.isArray(fuelLogs) ? fuelLogs : [])
    .filter((row) => (row.full_tank === true || row.full_tank === 1) &&
      amount(row.odometer_km) >= 0 && amount(row.liters) > 0)
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
  const fuelMode = vehicleKm > 0
    ? "vehicle_odometer"
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
  const fuelDistanceByDate = fuelMode === "vehicle_odometer"
    ? vehicleDistanceByDate
    : fuelMode === "passenger_km_partial"
      ? passengerDistanceByDate
      : new Map();

  const consumption = measuredConsumption(fuelLogs);
  let fuelKm = 0;
  let fuelLiters = 0;
  let fuelCost = 0;
  let priceFallback = false;
  let missingPriceDates = 0;
  for (const [date, km] of fuelDistanceByDate) {
    const price = priceForDate(priceHistory, date);
    if (!price) {
      missingPriceDates += 1;
      continue;
    }
    if (price.effective_from > date) priceFallback = true;
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
  const totalKnownCosts = (fuelCost ?? 0) + otherCosts;
  const netPartial = fuelCost == null ? null : Math.round((gross - totalKnownCosts + Number.EPSILON) * 100) / 100;
  const netComplete = netPartial != null &&
    fuelMode === "vehicle_odometer" &&
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
    netPartial,
    netOperating,
    netComplete,
    missingCosts,
    missingPriceDates,
    priceFallback
  };
}
