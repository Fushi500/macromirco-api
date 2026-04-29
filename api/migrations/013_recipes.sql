-- Recipes schema
-- Run: psql -U fushi -d macromicro -f migrations/013_recipes.sql

CREATE TABLE IF NOT EXISTS recipes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  instructions        TEXT,
  prep_time_minutes   INTEGER,
  cook_time_minutes   INTEGER,
  servings            INTEGER NOT NULL DEFAULT 1,
  serving_quantity    NUMERIC(10,2),
  serving_size        TEXT,
  calories            NUMERIC(10,2),
  protein             NUMERIC(10,2),
  carbs               NUMERIC(10,2),
  fat                 NUMERIC(10,2),
  fiber               NUMERIC(10,2),
  sugar               NUMERIC(10,2),
  saturated_fat       NUMERIC(10,2),
  sodium              NUMERIC(10,2),
  cholesterol         NUMERIC(10,2),
  potassium           NUMERIC(10,2),
  calcium             NUMERIC(10,2),
  iron                NUMERIC(10,2),
  vitamin_a           NUMERIC(10,2),
  vitamin_c           NUMERIC(10,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  food_source     TEXT NOT NULL,
  food_source_id  TEXT NOT NULL,
  food_name       TEXT NOT NULL,
  quantity_g      NUMERIC(10,2) NOT NULL,
  calories        NUMERIC(10,2),
  protein         NUMERIC(10,2),
  carbs           NUMERIC(10,2),
  fat             NUMERIC(10,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
