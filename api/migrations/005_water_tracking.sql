-- water_logs: one row per (user_id, date); amount_ml is cumulative daily total
CREATE TABLE water_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  amount_ml  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- goal column on user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS water_goal_ml INTEGER NOT NULL DEFAULT 2000;
