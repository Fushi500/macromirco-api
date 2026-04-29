-- Add public/community fields to recipes
-- Run: psql -U fushi -d macromicro -f migrations/016_recipe_public.sql

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
