-- Add zone_breakdown_sec JSON column for cardio HR zone tracking
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS zone_breakdown_sec JSONB;

-- Add fasting table for cross-device sync
CREATE TABLE IF NOT EXISTS fasts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  planned_duration_hours INTEGER NOT NULL,
  goal_met            BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fasts_user_started ON fasts (user_id, started_at DESC);
