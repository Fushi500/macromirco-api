-- Food Collections & Collection Items
-- Run: psql -U fushi -d macromicro -f migrations/003_food_collections.sql

CREATE TABLE IF NOT EXISTS food_collections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one system collection of each name per user
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_system_name
  ON food_collections(user_id, name) WHERE is_system = TRUE;

CREATE INDEX IF NOT EXISTS idx_food_collections_user
  ON food_collections(user_id);

CREATE TABLE IF NOT EXISTS food_collection_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id   UUID NOT NULL REFERENCES food_collections(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_source     TEXT NOT NULL,
  food_source_id  TEXT NOT NULL,
  food_name       TEXT NOT NULL,
  brands          TEXT,
  image_url       TEXT,
  calories        NUMERIC DEFAULT 0,
  protein         NUMERIC DEFAULT 0,
  carbs           NUMERIC DEFAULT 0,
  fat             NUMERIC DEFAULT 0,
  nutriments      JSONB,
  serving_quantity NUMERIC,
  serving_size    TEXT,
  ingredients_text TEXT,
  position        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collection_id, food_source, food_source_id)
);

CREATE INDEX IF NOT EXISTS idx_food_collection_items_collection
  ON food_collection_items(collection_id);

CREATE INDEX IF NOT EXISTS idx_food_collection_items_user
  ON food_collection_items(user_id);
