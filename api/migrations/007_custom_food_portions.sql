ALTER TABLE custom_foods
  ADD COLUMN IF NOT EXISTS food_category VARCHAR(20) DEFAULT 'food'
    CHECK (food_category IN ('food', 'drink', 'sweet', 'other')),
  ADD COLUMN IF NOT EXISTS serving_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS serving_unit VARCHAR(20) DEFAULT 'g';
