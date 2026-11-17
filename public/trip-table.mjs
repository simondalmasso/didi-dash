const SORTABLE_FIELDS = new Set(["date", "start", "amount", "km", "platform"]);

function searchableText(trip) {
  return [
    trip.date, trip.start, trip.platform, trip.modality, trip.service_type,
    trip.amount, trip.km, trip.id
  ].filter((value) => value != null).join(" ").toLocaleLowerCase("es-AR");
}

export function queryTripRows(trips, options = {}) {
  const query = String(options.query ?? "").trim().toLocaleLowerCase("es-AR");
  const sort = SORTABLE_FIELDS.has(options.sort) ? options.sort : "date";
  const direction = options.direction === "asc" ? 1 : -1;
  const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(options.pageSize) || 25)));
  const requestedPage = Math.max(1, Math.trunc(Number(options.page) || 1));
  const filtered = (Array.isArray(trips) ? trips : [])
    .filter((trip) => !query || searchableText(trip).includes(query))
    .slice()
    .sort((a, b) => {
      const left = a?.[sort] ?? "";
      const right = b?.[sort] ?? "";
      const comparison = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "es-AR", { numeric: true });
      return comparison === 0
        ? String(a?.id ?? "").localeCompare(String(b?.id ?? ""))
        : comparison * direction;
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageCount,
    pageSize
  };
}
