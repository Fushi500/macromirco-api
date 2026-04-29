-- Workout session deduplication
-- Run: psql -U fushi -d macromicro -f migrations/014_workout_dedup.sql

ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS client_session_id TEXT;

-- Permanent dedup by client_session_id is cleaner than a 24h window.
-- The Flutter app generates a UUID per live session and sends it with each entry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_logs_client_session
  ON workout_logs(user_id, client_session_id)
  WHERE client_session_id IS NOT NULL;
