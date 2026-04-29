CREATE TABLE IF NOT EXISTS training_split (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  label           text NOT NULL,
  calorie_delta   integer NOT NULL DEFAULT 0,
  carb_delta_g    numeric(6,2) NOT NULL DEFAULT 0,
  fat_delta_g     numeric(6,2) NOT NULL DEFAULT 0,
  protein_delta_g numeric(6,2) NOT NULL DEFAULT 0,
  UNIQUE (user_id, weekday)
);
