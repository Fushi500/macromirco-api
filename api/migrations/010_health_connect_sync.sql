-- Add source column to workout_logs to distinguish Health Connect imports
ALTER TABLE workout_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'health_connect'));

-- Daily health sync table: one row per user per day, upserted on each HC sync
CREATE TABLE IF NOT EXISTS daily_health_sync (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  steps         INTEGER NOT NULL DEFAULT 0,
  active_calories INTEGER NOT NULL DEFAULT 0,
  last_sync_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_health_sync_user_date
  ON daily_health_sync (user_id, date DESC);
