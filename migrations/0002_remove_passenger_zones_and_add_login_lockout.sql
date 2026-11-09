DROP INDEX IF EXISTS trips_origin_zone_idx;
DROP INDEX IF EXISTS trips_destination_zone_idx;

ALTER TABLE trips DROP COLUMN origin_zone;
ALTER TABLE trips DROP COLUMN destination_zone;

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_updated_at_idx
  ON login_attempts(updated_at);
