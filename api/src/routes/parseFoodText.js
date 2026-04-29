const { foodsIndex } = require('../meili');
const { query } = require('../db');
const { parseRomanianFoodText, parseMultiFoodText } = require('../parser/ro-quantity-parser');

const SEARCH_ATTRS = [
  'id', 'barcode', 'product_name', 'brands', 'quantity',
  'calories', 'protein', 'fat', 'carbs',
  'fiber', 'sugar', 'saturated_fat', 'sodium',
  'cholesterol', 'potassium', 'calcium', 'iron',
  'vitamin_a', 'vitamin_c', 'serving_size',
  'image_url', 'source', 'food_category', 'portions',
];

/**
 * POST /parse-food-text
 *
 * Supports multi-food input separated by commas, "și", "and", etc.
 * Returns an array of items, each with parsed info + top 3 candidates.
 *
 * Body: { text: "2 pizza și 1 cola" }
 * Response: {
 *   items: [
 *     { prediction_id, parsed: {...}, candidates: [...] },
 *     { prediction_id, parsed: {...}, candidates: [...] },
 *   ]
 * }
 *
 * POST /parse-food-text/feedback — unchanged
 */
async function parseFoodTextRoutes(fastify) {

  // ── POST /parse-food-text ────────────────────────────────────────
  fastify.post('/parse-food-text', {
    schema: {
      body: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 500 },
        },
        required: ['text'],
      },
    },
  }, async (request, reply) => {
    const { text } = request.body;

    // Optional auth
    let userId = null;
    try {
      await request.jwtVerify();
      userId = request.user.sub;
    } catch {}

    // 1. Parse — may return multiple items
    const parsedItems = parseMultiFoodText(text);
    const validItems = parsedItems.filter(p => p.food_query);

    if (validItems.length === 0) {
      return reply.code(400).send({ error: 'Could not extract food name from text' });
    }

    // 2. Search + enrich each item in parallel
    const items = await Promise.all(validItems.map(async (parsed) => {
      // Search all sources in parallel: My Foods, Community, Meilisearch (OFF+USDA)
      const [myFoodsResult, communityResult, meiliResults] = await Promise.all([
        // My Foods (only if authenticated)
        userId
          ? query(
              `SELECT * FROM custom_foods
               WHERE user_id = $1 AND product_name ILIKE $2
               ORDER BY product_name LIMIT 3`,
              [userId, `%${parsed.food_query}%`]
            )
          : { rows: [] },
        // Community foods
        query(
          `SELECT * FROM custom_foods
           WHERE is_public = true AND product_name ILIKE $1
           ORDER BY product_name LIMIT 3`,
          [`%${parsed.food_query}%`]
        ),
        // Meilisearch (OFF + USDA)
        foodsIndex.search(parsed.food_query, {
          limit: 3,
          attributesToRetrieve: SEARCH_ATTRS,
        }),
      ]);

      // Convert custom_foods rows to candidate format
      const customToCand = (row, source) => ({
        id: row.id,
        barcode: row.barcode || '',
        product_name: row.product_name,
        brands: row.brands || '',
        quantity: '',
        calories: parseFloat(row.calories) || 0,
        protein: parseFloat(row.protein) || 0,
        fat: parseFloat(row.fat) || 0,
        carbs: parseFloat(row.carbs) || 0,
        fiber: parseFloat(row.fiber) || 0,
        sugar: parseFloat(row.sugar) || 0,
        saturated_fat: parseFloat(row.saturated_fat) || 0,
        sodium: parseFloat(row.sodium) || 0,
        cholesterol: parseFloat(row.cholesterol) || 0,
        potassium: parseFloat(row.potassium) || 0,
        calcium: parseFloat(row.calcium) || 0,
        iron: parseFloat(row.iron) || 0,
        vitamin_a: parseFloat(row.vitamin_a) || 0,
        vitamin_c: parseFloat(row.vitamin_c) || 0,
        serving_size: row.serving_size || '100 g',
        image_url: row.image_url || '',
        source,
        food_category: '',
        portions: [],
      });

      // Priority: My Foods > Community > OFF/USDA — pick top 3
      const allCandidates = [
        ...myFoodsResult.rows.map(r => customToCand(r, 'custom_mine')),
        ...communityResult.rows.map(r => customToCand(r, 'custom_community')),
        ...meiliResults.hits,
      ].slice(0, 3);

      const candidates = allCandidates.map(hit => {
        const enriched = { ...hit };
        enriched.estimated_grams = estimateGrams(parsed, hit);
        enriched.serving_description = describeServing(parsed, enriched.estimated_grams);
        return enriched;
      });

      const processingMs = meiliResults.processingTimeMs;

      // Log prediction
      let predictionId = null;
      try {
        const res = await query(
          `INSERT INTO food_recognition_feedback
             (user_id, raw_text, parsed_query, parsed_quantity, parsed_unit, parsed_grams,
              candidate_count, processing_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            userId,
            parsed.raw,
            parsed.food_query,
            parsed.quantity,
            parsed.unit,
            parsed.grams,
            candidates.length,
            processingMs,
          ]
        );
        predictionId = res.rows[0].id;
      } catch (err) {
        fastify.log.error({ err }, 'Failed to log food prediction');
      }

      // Structured log
      fastify.log.info({
        event: 'food_prediction',
        prediction_id: predictionId,
        user_id: userId,
        raw_text: parsed.raw,
        parsed_query: parsed.food_query,
        parsed_quantity: parsed.quantity,
        parsed_unit: parsed.unit,
        parsed_grams: parsed.grams,
        candidate_count: candidates.length,
        top_candidate: candidates[0]?.product_name || null,
        top_candidate_source: candidates[0]?.source || null,
        processing_ms: processingMs,
      });

      return { prediction_id: predictionId, parsed, candidates };
    }));

    return { items };
  });

  // ── POST /parse-food-text/feedback ───────────────────────────────
  fastify.post('/parse-food-text/feedback', {
    schema: {
      body: {
        type: 'object',
        properties: {
          prediction_id: { type: 'integer' },
          selected_food_id: { type: 'string' },
          selected_food_name: { type: 'string' },
          selected_source: { type: 'string' },
          final_grams: { type: 'integer', minimum: 1 },
          was_edited: { type: 'boolean' },
          was_rejected: { type: 'boolean' },
        },
        required: ['prediction_id'],
      },
    },
  }, async (request, reply) => {
    const {
      prediction_id,
      selected_food_id,
      selected_food_name,
      selected_source,
      final_grams,
      was_edited,
      was_rejected,
    } = request.body;

    const result = await query(
      `UPDATE food_recognition_feedback
       SET selected_food_id = $1,
           selected_food_name = $2,
           selected_source = $3,
           final_grams = $4,
           was_edited = COALESCE($5, false),
           was_rejected = COALESCE($6, false)
       WHERE id = $7
       RETURNING id`,
      [
        selected_food_id || null,
        selected_food_name || null,
        selected_source || null,
        final_grams || null,
        was_edited,
        was_rejected,
        prediction_id,
      ]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Prediction not found' });
    }

    fastify.log.info({
      event: 'food_feedback',
      prediction_id,
      selected_food_id,
      selected_food_name,
      selected_source,
      final_grams,
      was_edited,
      was_rejected,
    });

    return { ok: true };
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function estimateGrams(parsed, food) {
  if (parsed.grams != null) return parsed.grams;

  const portions = food.portions || [];
  const quantity = parsed.quantity;
  const unit = parsed.unit;

  const unitAliases = {
    'cup': ['cup', 'cups'],
    'tbsp': ['tbsp', 'tablespoon', 'tablespoons'],
    'tsp': ['tsp', 'teaspoon', 'teaspoons'],
    'slice': ['slice', 'slices'],
    'piece': ['piece', 'pieces', 'ea', 'each'],
    'serving': ['serving', 'servings', 'svg'],
    'plate': ['plate'],
  };

  const aliases = unitAliases[unit] || [unit];

  for (const portion of portions) {
    const pUnit = (portion.unit || '').toLowerCase();
    const pDesc = (portion.description || '').toLowerCase();
    if (aliases.some(a => pUnit === a || pDesc.includes(a))) {
      return Math.round(quantity * portion.gram_weight);
    }
  }

  if (unit === 'serving' && portions.length > 0) {
    return Math.round(quantity * portions[0].gram_weight);
  }

  const defaults = {
    'serving': 150, 'piece': 100, 'slice': 30,
    'plate': 300, 'cup': 240, 'tbsp': 15, 'tsp': 5,
  };

  return Math.round(quantity * (defaults[unit] || 100));
}

function describeServing(parsed, estimatedGrams) {
  if (['g', 'kg', 'ml', 'l'].includes(parsed.unit)) {
    return `${parsed.quantity} ${parsed.unit}`;
  }
  return `${parsed.quantity} × ${parsed.unit} (~${estimatedGrams}g)`;
}

module.exports = parseFoodTextRoutes;
