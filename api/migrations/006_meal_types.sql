-- daily_foods: add meal_type column
ALTER TABLE daily_foods
  ADD COLUMN meal_type VARCHAR(50) NOT NULL DEFAULT 'other';

-- user_profiles: add meal_periods JSONB column
ALTER TABLE user_profiles
  ADD COLUMN meal_periods JSONB DEFAULT '[
    {"id":"breakfast","name":"Mic dejun","start":"06:00","end":"10:00"},
    {"id":"lunch",    "name":"Prânz",    "start":"11:00","end":"14:00"},
    {"id":"dinner",   "name":"Cină",     "start":"18:00","end":"22:00"},
    {"id":"snack",    "name":"Gustare",  "start":null,   "end":null  }
  ]'::jsonb;
