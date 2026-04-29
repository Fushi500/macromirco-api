-- Rename instructions -> steps to match Flutter Recipe model
ALTER TABLE recipes RENAME COLUMN instructions TO steps;
