-- Add weight column to workout_logs for PR tracking
ALTER TABLE workout_logs ADD COLUMN IF NOT EXISTS weight_kg numeric(6,2);

-- Body measurements table
CREATE TABLE IF NOT EXISTS measurements (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  date          date NOT NULL,
  chest_cm      numeric(5,1),
  waist_cm      numeric(5,1),
  hips_cm       numeric(5,1),
  upper_arm_cm  numeric(5,1),
  thigh_cm      numeric(5,1),
  notes         text CHECK (char_length(notes) <= 1000),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS measurements_user_date ON measurements (user_id, date);
