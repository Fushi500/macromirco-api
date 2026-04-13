ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS estimated_calories NUMERIC(8,2);
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS intensity_level INTEGER;
