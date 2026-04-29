#!/usr/bin/env node
/**
 * Populate portion_index table from USDA FoodData Central JSON files.
 * Extracts all foodPortions with valid gram weights.
 *
 * Usage (inside api container):
 *   node scripts/populate-portions.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const BATCH_SIZE = 200;

function normalizeUnit(measureUnit, modifier) {
  const abbr = (measureUnit?.abbreviation || '').toLowerCase();
  const name = (measureUnit?.name || '').toLowerCase();
  const mod = (modifier || '').toLowerCase();

  // Map to canonical units
  if (abbr === 'cup' || name === 'cup') return 'cup';
  if (abbr === 'tbsp' || name === 'tablespoon') return 'tbsp';
  if (abbr === 'tsp' || name === 'teaspoon') return 'tsp';
  if (mod.includes('slice')) return 'slice';
  if (mod.includes('piece') || mod.includes('ea') || abbr === 'ea') return 'piece';
  if (mod.includes('oz') || abbr === 'oz') return 'oz';
  if (mod.includes('breast')) return 'piece';
  if (mod.includes('thigh')) return 'piece';
  if (mod.includes('leg')) return 'piece';
  if (mod.includes('wing')) return 'piece';
  if (mod.includes('fillet') || mod.includes('filet')) return 'piece';
  if (mod.includes('patty')) return 'piece';
  if (mod.includes('link')) return 'piece';
  if (mod.includes('strip')) return 'piece';
  if (mod.includes('stalk') || mod.includes('stem')) return 'piece';
  if (mod.includes('leaf') || mod.includes('leaves')) return 'piece';
  if (mod.includes('fruit') || mod.includes('whole')) return 'piece';
  if (abbr === 'undetermined' || name === 'undetermined') {
    if (mod) return 'serving';
    return 'serving';
  }
  // RACC is a regulatory serving — treat as serving
  if (abbr === 'racc') return 'serving';

  return mod || name || 'serving';
}

function extractPortions(foods, source) {
  const rows = [];
  for (const food of foods) {
    if (!food.foodPortions || food.foodPortions.length === 0) continue;
    for (const p of food.foodPortions) {
      if (!p.gramWeight || p.gramWeight <= 0) continue;

      const unit = normalizeUnit(p.measureUnit, p.modifier);
      const desc = p.modifier || p.measureUnit?.name || '';

      rows.push({
        fdc_id: food.fdcId,
        food_name: food.description,
        portion_amount: p.amount || p.value || 1,
        portion_unit: unit,
        portion_desc: desc,
        gram_weight: Math.round(p.gramWeight * 100) / 100,
        source,
      });
    }
  }
  return rows;
}

async function insertBatch(rows) {
  if (rows.length === 0) return;

  const values = [];
  const params = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const offset = i * 7;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
    params.push(r.fdc_id, r.food_name, r.portion_amount, r.portion_unit, r.portion_desc, r.gram_weight, r.source);
  }

  await pool.query(
    `INSERT INTO portion_index (fdc_id, food_name, portion_amount, portion_unit, portion_desc, gram_weight, source)
     VALUES ${values.join(', ')}`,
    params
  );
}

async function main() {
  const dataDir = path.join(__dirname, 'data');
  const files = fs.readdirSync(dataDir);

  const foundationFile = files.find(f => f.includes('foundation_food_json'));
  const srLegacyFile = files.find(f => f.includes('sr_legacy_food_json'));

  let allRows = [];

  if (foundationFile) {
    console.log(`Loading Foundation: ${foundationFile}`);
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, foundationFile), 'utf8'));
    const rows = extractPortions(data.FoundationFoods, 'usda_foundation');
    console.log(`  Extracted ${rows.length} portions from ${data.FoundationFoods.length} foods`);
    allRows.push(...rows);
  }

  if (srLegacyFile) {
    console.log(`Loading SR Legacy: ${srLegacyFile}`);
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, srLegacyFile), 'utf8'));
    const rows = extractPortions(data.SRLegacyFoods, 'usda_sr_legacy');
    console.log(`  Extracted ${rows.length} portions from ${data.SRLegacyFoods.length} foods`);
    allRows.push(...rows);
  }

  console.log(`\nTotal portions to insert: ${allRows.length}`);

  // Clear existing data
  await pool.query('TRUNCATE portion_index RESTART IDENTITY');
  console.log('Cleared existing portion_index data');

  // Insert in batches
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    await insertBatch(batch);
    if ((i / BATCH_SIZE) % 10 === 0) {
      process.stdout.write(`  Inserted ${Math.min(i + BATCH_SIZE, allRows.length)}/${allRows.length}\r`);
    }
  }

  const result = await pool.query('SELECT COUNT(*) FROM portion_index');
  console.log(`\nDone! portion_index has ${result.rows[0].count} rows`);

  // Show unit distribution
  const dist = await pool.query('SELECT portion_unit, COUNT(*) as cnt FROM portion_index GROUP BY portion_unit ORDER BY cnt DESC LIMIT 15');
  console.log('\nUnit distribution:');
  dist.rows.forEach(r => console.log(`  ${r.portion_unit}: ${r.cnt}`));

  await pool.end();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
