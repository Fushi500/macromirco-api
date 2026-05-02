-- Migration 018: Backend enhancements for offloading frontend logic
-- Run: docker exec <postgres> psql -U fushi -d macromicro -f migrations/018_backend_enhancements.sql

-- 1. Fasts table (was in 017 but not applied)
CREATE TABLE IF NOT EXISTS fasts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  planned_duration_hours INTEGER NOT NULL,
  goal_met            BOOLEAN DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fasts_user_started ON fasts (user_id, started_at DESC);

-- 2. Recipe ingredients: add missing macro columns so server can sum everything
ALTER TABLE recipe_ingredients
  ADD COLUMN IF NOT EXISTS fiber NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sugar NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS saturated_fat NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS sodium NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS cholesterol NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS potassium NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS calcium NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS iron NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS vitamin_a NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS vitamin_c NUMERIC(10,2);

-- 3. Adaptive target history table (server-side replacement for SharedPreferences)
CREATE TABLE IF NOT EXISTS adaptive_target_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  applied_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_target        NUMERIC(10,2) NOT NULL,
  new_target        NUMERIC(10,2) NOT NULL,
  measured_tdee     NUMERIC(10,2),
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adaptive_target_history_user_applied
  ON adaptive_target_history (user_id, applied_at DESC);

-- 4. Add cooking_adjustment_pct to recipes (frontend sends it but DB didn't store it)
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS cooking_adjustment_pct NUMERIC(5,2) NOT NULL DEFAULT 100.0;
