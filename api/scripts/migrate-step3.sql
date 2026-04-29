-- Step 3: portion_index + food_recognition_feedback tables
-- Run inside postgres container:
--   psql -U fushi -d macromicro -f /migrate-step3.sql

BEGIN;

-- ══════════════════════════════════════════════════════════════════
-- portion_index: standard portions from USDA, used for gram estimation
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS portion_index (
  id            SERIAL PRIMARY KEY,
  fdc_id        INTEGER NOT NULL,          -- USDA FoodData Central ID
  food_name     TEXT NOT NULL,              -- e.g. "Chicken, breast, rotisserie"
  portion_amount NUMERIC(8,2) NOT NULL,     -- e.g. 1, 0.5
  portion_unit  TEXT NOT NULL,              -- canonical: cup, tbsp, tsp, slice, piece, serving
  portion_desc  TEXT DEFAULT '',            -- original description, e.g. "breast, bone and skin removed"
  gram_weight   NUMERIC(8,2) NOT NULL,     -- grams for this portion
  source        TEXT NOT NULL DEFAULT 'usda', -- usda_foundation, usda_sr_legacy
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portion_index_unit ON portion_index (portion_unit);
CREATE INDEX IF NOT EXISTS idx_portion_index_food ON portion_index USING gin (to_tsvector('english', food_name));
CREATE INDEX IF NOT EXISTS idx_portion_index_fdc  ON portion_index (fdc_id);

-- ══════════════════════════════════════════════════════════════════
-- food_recognition_feedback: logs each text→food prediction
-- Used for thesis statistics and improving the parser over time
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS food_recognition_feedback (
  id              SERIAL PRIMARY KEY,
  user_id         UUID,                       -- NULL if unauthenticated
  raw_text        TEXT NOT NULL,               -- original user input
  parsed_query    TEXT NOT NULL,               -- extracted food query
  parsed_quantity NUMERIC(8,2),                -- extracted quantity
  parsed_unit     TEXT,                        -- extracted unit
  parsed_grams    INTEGER,                     -- estimated grams from parser
  -- candidate info (which candidate the user selected, if any)
  selected_food_id TEXT,                       -- Meilisearch doc id of chosen food
  selected_food_name TEXT,                     -- product_name of chosen food
  selected_source  TEXT,                       -- openfoodfacts, usda_foundation, usda_sr_legacy
  final_grams     INTEGER,                     -- grams the user actually confirmed/edited
  -- metadata
  candidate_count INTEGER DEFAULT 0,           -- how many candidates were returned
  was_edited      BOOLEAN DEFAULT false,       -- did user edit the grams?
  was_rejected    BOOLEAN DEFAULT false,       -- did user reject all candidates?
  processing_ms   INTEGER,                     -- Meilisearch processing time
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user    ON food_recognition_feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON food_recognition_feedback (created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_source  ON food_recognition_feedback (selected_source);

COMMIT;
