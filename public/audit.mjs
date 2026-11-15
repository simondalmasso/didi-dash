const COLLECTIONS = ["trips", "rewards", "fuel", "sessions"];

function safeRows(value) {
  return Array.isArray(value) ? value : [];
}

function hasTruncation(flags) {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return false;
  return Object.values(flags).some((value) => value === true);
}

function validDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function auditLedger(exportData) {
  if (!exportData || typeof exportData !== "object" || Array.isArray(exportData)) {
    throw new TypeError("Ledger export must be an object.");
  }

  const rows = Object.fromEntries(COLLECTIONS.map((name) => [name, safeRows(exportData[name])]));
  const globalTruncated = hasTruncation(exportData.truncated);
  const dates = new Set();
  for (const collection of COLLECTIONS) {
    for (const row of rows[collection]) {
      if (validDay(row?.date)) dates.add(row.date);
    }
  }

  const days = [...dates].sort((a, b) => b.localeCompare(a)).map((date) => {
    const trips = rows.trips.filter((row) => row.date === date);
    const rewards = rows.rewards.filter((row) => row.date === date);
    const fuel = rows.fuel.filter((row) => row.date === date);
    const sessions = rows.sessions.filter((row) => row.date === date);
    const actualKm = trips.filter((row) =>
      row.km_source === "actual" && Number(row.km) > 0
    ).length;
    const estimatedKm = trips.filter((row) =>
      row.km_source === "estimated" && Number(row.km) > 0
    ).length;
    const unknownKm = trips.filter((row) =>
      row.km_source === "unknown" || !(Number(row.km) > 0)
    ).length;
    const missingDuration = trips.filter((row) => !(Number(row.min) > 0)).length;
    const complete = !globalTruncated && trips.length > 0 &&
      actualKm === trips.length && missingDuration === 0;

    return {
      date,
      trips: trips.length,
      actualKm,
      estimatedKm,
      unknownKm,
      missingDuration,
      rewards: rewards.length,
      fuelEntries: fuel.length,
      syncedSessions: sessions.length,
      status: complete ? "Completo en ledger" : trips.length ? "Parcial en ledger" : "Sin viajes en ledger"
    };
  });

  const sessionSyncStatus = rows.sessions.length
    ? rows.sessions.length + " turnos sincronizados"
    : "Sin turnos sincronizados";

  const summary = globalTruncated
    ? "Exportación truncada: ninguna fecha puede certificarse como completa."
    : days.length
      ? days.length + " fechas con actividad en el ledger; revisar su cobertura individual."
      : "El ledger no contiene fechas con actividad registrada.";

  return {
    exportedAt: typeof exportData.exported_at === "string" ? exportData.exported_at : null,
    counts: Object.fromEntries(COLLECTIONS.map((name) => [name, rows[name].length])),
    globalTruncated,
    summary,
    sessionSyncStatus,
    a22Comparison: "No comparado contra A22",
    days
  };
}
