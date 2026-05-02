-- Migration 019: Performance indexes for frequently queried columns
-- Apply: docker exec <postgres> psql -U <user> -d <db> -f /migrations/019_performance_indexes.sql

-- Batch sync / daily lookups
CREATE INDEX IF NOT EXISTS idx_daily_foods_user_date ON daily_foods(user_id, date);
CREATE INDEX IF NOT EXISTS idx_workout_logs_user_date ON workout_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_weight_logs_user_date ON weight_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_fasts_user_started ON fasts(user_id, started_at);

-- Custom food search (public + personal)
CREATE INDEX IF NOT EXISTS idx_custom_foods_user_name ON custom_foods(user_id, product_name);
CREATE INDEX IF NOT EXISTS idx_custom_foods_public_name ON custom_foods(is_public, product_name) WHERE is_public = true;

-- Recipe lookups
CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

-- Collection lookups
CREATE INDEX IF NOT EXISTS idx_food_collections_user ON food_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON food_collection_items(collection_id);

-- Profile / target lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_user ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_adaptive_target_history_user ON adaptive_target_history(user_id, applied_at);

-- Health sync
CREATE INDEX IF NOT EXISTS idx_daily_health_sync_user_date ON daily_health_sync(user_id, date);

-- Bug reports (admin queries)
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);
