CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL CHECK (length(date) = 10),
  start TEXT NOT NULL CHECK (length(start) = 5),
  amount INTEGER NOT NULL CHECK (amount > 0),
  km REAL NOT NULL CHECK (km >= 0),
  min REAL NOT NULL CHECK (min >= 0),
  platform TEXT NOT NULL,
  source TEXT NOT NULL,
  origin_zone TEXT,
  destination_zone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS trips_date_start_idx ON trips(date DESC, start DESC);
CREATE INDEX IF NOT EXISTS trips_platform_date_idx ON trips(platform, date DESC);
CREATE INDEX IF NOT EXISTS trips_origin_zone_idx ON trips(origin_zone);
CREATE INDEX IF NOT EXISTS trips_destination_zone_idx ON trips(destination_zone);

CREATE TABLE IF NOT EXISTS fuel_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL CHECK (length(date) = 10),
  odometer_km REAL NOT NULL CHECK (odometer_km >= 0),
  liters REAL NOT NULL CHECK (liters > 0),
  total_ars REAL NOT NULL CHECK (total_ars > 0),
  station TEXT,
  full_tank INTEGER NOT NULL DEFAULT 0 CHECK (full_tank IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS fuel_logs_date_odo_idx ON fuel_logs(date DESC, odometer_km DESC);

CREATE TABLE IF NOT EXISTS work_sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL CHECK (length(date) = 10),
  platform TEXT NOT NULL,
  connected_start TEXT NOT NULL,
  connected_end TEXT NOT NULL,
  connected_minutes INTEGER NOT NULL CHECK (connected_minutes > 0),
  odometer_start REAL,
  odometer_end REAL,
  odometer_km REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (odometer_start IS NULL AND odometer_end IS NULL AND odometer_km IS NULL)
    OR
    (odometer_start IS NOT NULL AND odometer_end IS NOT NULL AND odometer_km >= 0)
  )
);

CREATE INDEX IF NOT EXISTS work_sessions_date_platform_idx ON work_sessions(date DESC, platform);
