#!/usr/bin/env node
/**
 * Import USDA FoodData Central (Foundation + SR Legacy) into Meilisearch.
 * Adds documents to the existing 'foods' index with source: 'usda_foundation' or 'usda_sr_legacy'.
 * Also configures RO↔EN synonyms for the index.
 *
 * Usage (inside api container):
 *   node scripts/import-usda.js
 *
 * Expects JSON files in scripts/data/:
 *   - FoodData_Central_foundation_food_json_*.json
 *   - FoodData_Central_sr_legacy_food_json_*.json
 */

const fs = require('fs');
const path = require('path');
const { MeiliSearch } = require('meilisearch');

const MEILI_URL = process.env.MEILI_URL || 'http://meilisearch:7700';
const MEILI_KEY = process.env.MEILI_KEY || process.env.MEILI_MASTER_KEY;
const BATCH_SIZE = 500;

// USDA nutrient IDs → our field names
// All values are per 100g
const NUTRIENT_MAP = {
  1008: { field: 'calories',      unit: 'kcal' },  // Energy (kcal)
  1003: { field: 'protein',       unit: 'g' },      // Protein
  1004: { field: 'fat',           unit: 'g' },      // Total lipid (fat)
  1005: { field: 'carbs',         unit: 'g' },      // Carbohydrate, by difference
  1079: { field: 'fiber',         unit: 'g' },      // Fiber, total dietary
  1063: { field: 'sugar',         unit: 'g' },      // Sugars, Total
  2000: { field: 'sugar',         unit: 'g' },      // Sugars, total including NLEA (fallback)
  1258: { field: 'saturated_fat', unit: 'g' },      // Fatty acids, total saturated
  1093: { field: 'sodium',        unit: 'mg' },     // Sodium, Na
  1253: { field: 'cholesterol',   unit: 'mg' },     // Cholesterol
  1092: { field: 'potassium',     unit: 'mg' },     // Potassium, K
  1087: { field: 'calcium',       unit: 'mg' },     // Calcium, Ca
  1089: { field: 'iron',          unit: 'mg' },     // Iron, Fe
  1106: { field: 'vitamin_a',     unit: 'ug' },     // Vitamin A, RAE (µg → store as µg)
  1162: { field: 'vitamin_c',     unit: 'mg' },     // Vitamin C
};

function round2(v) {
  return v != null ? Math.round(parseFloat(v) * 100) / 100 : 0;
}

function extractNutrients(foodNutrients) {
  const result = {
    calories: 0, protein: 0, fat: 0, carbs: 0,
    fiber: 0, sugar: 0, saturated_fat: 0, sodium: 0,
    cholesterol: 0, potassium: 0, calcium: 0, iron: 0,
    vitamin_a: 0, vitamin_c: 0,
  };

  for (const fn of foodNutrients) {
    const mapping = NUTRIENT_MAP[fn.nutrient?.id];
    if (!mapping) continue;
    // Don't overwrite if we already have a value (e.g., sugar from id 1063 takes priority over 2000)
    if (result[mapping.field] !== 0 && mapping.field === 'sugar' && fn.nutrient.id === 2000) continue;
    result[mapping.field] = round2(fn.amount);
  }

  // If calories is 0 but we have macros, estimate: 4*P + 4*C + 9*F
  if (result.calories === 0 && (result.protein > 0 || result.carbs > 0 || result.fat > 0)) {
    result.calories = round2(result.protein * 4 + result.carbs * 4 + result.fat * 9);
  }

  return result;
}

function extractPortions(foodPortions) {
  if (!foodPortions || foodPortions.length === 0) return [];
  return foodPortions
    .filter(p => p.gramWeight > 0)
    .map(p => ({
      amount: p.amount || p.value || 1,
      unit: p.measureUnit?.abbreviation !== 'undetermined'
        ? p.measureUnit?.abbreviation || p.modifier || 'serving'
        : p.modifier || 'serving',
      description: p.modifier || p.measureUnit?.name || '',
      gram_weight: round2(p.gramWeight),
    }));
}

function transformFood(food, source) {
  const nutrients = extractNutrients(food.foodNutrients || []);
  const portions = extractPortions(food.foodPortions || []);

  // Skip foods with no name or no calories
  if (!food.description) return null;

  return {
    id: `usda_${food.fdcId}`,
    barcode: '',
    product_name: food.description,
    brands: 'USDA',
    quantity: '100 g',
    image_url: '',
    serving_size: portions.length > 0
      ? `${portions[0].amount} ${portions[0].unit} (${portions[0].gram_weight}g)`
      : '100 g',
    ingredients_text: '',
    allergen_tags: '',
    source,
    usda_fdc_id: food.fdcId,
    usda_ndb_number: food.ndbNumber || '',
    food_category: food.foodCategory?.description || '',
    portions,
    ...nutrients,
  };
}

async function loadAndTransform(filePath, sourceKey, arrayKey) {
  console.log(`Loading ${filePath}...`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const foods = data[arrayKey];
  console.log(`  Found ${foods.length} foods in ${arrayKey}`);

  const docs = [];
  let skipped = 0;
  for (const food of foods) {
    const doc = transformFood(food, sourceKey);
    if (doc) {
      docs.push(doc);
    } else {
      skipped++;
    }
  }
  console.log(`  Transformed: ${docs.length}, Skipped: ${skipped}`);
  return docs;
}

async function configureSynonyms(index) {
  console.log('Configuring RO↔EN synonyms...');
  const synonymsPath = path.join(__dirname, 'ro-en-synonyms.json');
  const synonyms = JSON.parse(fs.readFileSync(synonymsPath, 'utf8'));

  const task = await index.updateSynonyms(synonyms);
  console.log(`  Synonyms task enqueued: ${task.taskUid}`);
  await index.waitForTask(task.taskUid, { timeOutMs: 60000 });
  console.log('  Synonyms configured successfully');
}

async function configureIndex(index) {
  // Make sure 'source' and 'food_category' are filterable
  console.log('Updating index settings...');

  const currentSettings = await index.getSettings();
  const currentFilterable = currentSettings.filterableAttributes || [];
  const currentSearchable = currentSettings.searchableAttributes || ['*'];

  // Add new filterable attributes if not present
  const newFilterable = new Set(currentFilterable);
  newFilterable.add('source');
  newFilterable.add('food_category');
  newFilterable.add('barcode');

  const filterTask = await index.updateFilterableAttributes([...newFilterable]);
  console.log(`  Filterable attributes task: ${filterTask.taskUid}`);
  await index.waitForTask(filterTask.taskUid, { timeOutMs: 120000 });

  // Ensure product_name and food_category are searchable
  if (currentSearchable[0] === '*') {
    // Already searching all fields — good
    console.log('  Searchable attributes: already set to [*]');
  } else {
    const newSearchable = new Set(currentSearchable);
    newSearchable.add('product_name');
    newSearchable.add('brands');
    newSearchable.add('food_category');
    const searchTask = await index.updateSearchableAttributes([...newSearchable]);
    await index.waitForTask(searchTask.taskUid, { timeOutMs: 120000 });
  }

  console.log('  Index settings updated');
}

async function main() {
  const meili = new MeiliSearch({ host: MEILI_URL, apiKey: MEILI_KEY });
  const index = meili.index('foods');

  // Check current state
  const stats = await index.getStats();
  console.log(`Current index has ${stats.numberOfDocuments} documents`);

  // Find data files
  const dataDir = path.join(__dirname, 'data');
  const files = fs.readdirSync(dataDir);

  const foundationFile = files.find(f => f.includes('foundation_food_json'));
  const srLegacyFile = files.find(f => f.includes('sr_legacy_food_json'));

  if (!foundationFile || !srLegacyFile) {
    console.error('Missing data files in scripts/data/');
    console.error('  Foundation:', foundationFile || 'NOT FOUND');
    console.error('  SR Legacy:', srLegacyFile || 'NOT FOUND');
    process.exit(1);
  }

  // Load and transform
  const foundationDocs = await loadAndTransform(
    path.join(dataDir, foundationFile), 'usda_foundation', 'FoundationFoods'
  );
  const srLegacyDocs = await loadAndTransform(
    path.join(dataDir, srLegacyFile), 'usda_sr_legacy', 'SRLegacyFoods'
  );

  const allDocs = [...foundationDocs, ...srLegacyDocs];
  console.log(`\nTotal documents to index: ${allDocs.length}`);

  // Configure index settings first
  await configureIndex(index);

  // Index in batches
  console.log(`\nIndexing in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
    const batch = allDocs.slice(i, i + BATCH_SIZE);
    const task = await index.addDocuments(batch);
    process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allDocs.length / BATCH_SIZE)} (task ${task.taskUid})...`);
    await index.waitForTask(task.taskUid, { timeOutMs: 120000 });
    process.stdout.write(' done\n');
  }

  // Configure synonyms
  await configureSynonyms(index);

  // Final stats
  const finalStats = await index.getStats();
  console.log(`\nDone! Index now has ${finalStats.numberOfDocuments} documents`);
  console.log('Field distribution:', JSON.stringify(finalStats.fieldDistribution, null, 2));
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
