const { foodsIndex } = require('../meili');
const { redis } = require('../redis');
const { query } = require('../db');

const SEARCH_CACHE_TTL = 3600;
const BARCODE_CACHE_TTL = 86400;

const OFF_API = 'https://world.openfoodfacts.org/api/v2/product';
const OFF_FIELDS = [
  'product_name', 'brands', 'quantity', 'image_url', 'serving_size',
  'ingredients_text', 'allergens',
  'nutriments',
].join(',');

async function fetchFromOpenFoodFacts(barcode) {
  try {
    const url = `${OFF_API}/${barcode}.json?fields=${OFF_FIELDS}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MacroMirco/1.0 (https://macromirco.com)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const n = p.nutriments || {};

    // Resolve kcal (same logic as process_foods.py)
    let calories = n['energy-kcal_100g'] ?? n['energy-kcal'] ?? null;
    if (calories == null && (n['energy-kj_100g'] ?? n['energy_100g']) != null) {
      calories = (n['energy-kj_100g'] ?? n['energy_100g']) / 4.184;
    }

    const num = (v) => (v != null ? Math.round(parseFloat(v) * 100) / 100 : 0);
    const str = (v) => (v != null ? String(v).trim() : '');

    return {
      id: barcode,
      barcode,
      product_name: str(p.product_name),
      brands: str(p.brands),
      quantity: str(p.quantity),
      image_url: str(p.image_url),
      serving_size: str(p.serving_size),
      ingredients_text: str(p.ingredients_text),
      allergen_tags: str(p.allergens),
      calories: num(calories),
      protein: num(n['proteins_100g']),
      fat: num(n['fat_100g']),
      carbs: num(n['carbohydrates_100g']),
      fiber: num(n['fiber_100g']),
      sugar: num(n['sugars_100g']),
      saturated_fat: num(n['saturated-fat_100g']),
      sodium: num(n['sodium_100g']),
      cholesterol: num(n['cholesterol_100g']),
      potassium: num(n['potassium_100g']),
      calcium: num(n['calcium_100g']),
      iron: num(n['iron_100g']),
      vitamin_a: num(n['vitamin-a_100g']),
      vitamin_c: num(n['vitamin-c_100g']),
      source: 'openfoodfacts',
    };
  } catch {
    return null;
  }
}

async function foodRoutes(fastify) {

  // GET /food/search?q=chicken&page=1&limit=10
  fastify.get('/food/search', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', minLength: 1, maxLength: 200 },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        },
        required: ['q'],
      },
    },
  }, async (request, reply) => {
    const { q, page, limit } = request.query;

    const cacheKey = `food:search:${q.toLowerCase()}:${page}:${limit}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const offset = (page - 1) * limit;
    const results = await foodsIndex.search(q, {
      limit,
      offset,
      attributesToRetrieve: [
        'id', 'barcode', 'product_name', 'brands', 'quantity',
        'calories', 'protein', 'fat', 'carbs',
        'fiber', 'sugar', 'saturated_fat', 'sodium',
        'cholesterol', 'potassium', 'calcium', 'iron',
        'vitamin_a', 'vitamin_c', 'serving_size',
        'image_url', 'ingredients_text', 'allergen_tags',
      ],
    });

    const response = {
      query: q,
      page,
      limit,
      total: results.estimatedTotalHits,
      processingTimeMs: results.processingTimeMs,
      foods: results.hits,
    };

    await redis.set(cacheKey, JSON.stringify(response), 'EX', SEARCH_CACHE_TTL);
    return response;
  });

  // GET /food/barcode/:code
  // Priority: 1) user's private custom food  2) public custom food  3) Meilisearch  4) OpenFoodFacts
  fastify.get('/food/barcode/:code', {
    schema: {
      params: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 20 },
        },
        required: ['code'],
      },
    },
  }, async (request, reply) => {
    const { code } = request.params;

    // Normalize: strip non-digits
    const normalizedCode = code.replace(/\D/g, '');

    // Optional auth — try to identify user but never block unauthenticated requests
    let userId = null;
    try {
      await request.jwtVerify();
      userId = request.user.sub;
    } catch {}

    // 1. User's private custom food (only if authenticated)
    if (userId) {
      const r = await query(
        `SELECT * FROM custom_foods
         WHERE barcode = $1 AND user_id = $2 AND is_public = false
         LIMIT 1`,
        [normalizedCode, userId]
      );
      if (r.rows.length > 0) {
        const cf = r.rows[0];
        return {
          id: cf.id,
          barcode: cf.barcode,
          product_name: cf.product_name,
          brands: cf.brands,
          serving_size: cf.serving_size,
          image_url: cf.image_url || '',
          calories: parseFloat(cf.calories),
          protein: parseFloat(cf.protein),
          fat: parseFloat(cf.fat),
          carbs: parseFloat(cf.carbs),
          fiber: parseFloat(cf.fiber),
          sugar: parseFloat(cf.sugar),
          saturated_fat: parseFloat(cf.saturated_fat),
          sodium: parseFloat(cf.sodium),
          cholesterol: parseFloat(cf.cholesterol),
          potassium: parseFloat(cf.potassium),
          calcium: parseFloat(cf.calcium),
          iron: parseFloat(cf.iron),
          vitamin_a: parseFloat(cf.vitamin_a),
          vitamin_c: parseFloat(cf.vitamin_c),
          source: 'custom',
        };
      }
    }

    // 2. Public custom food
    const rPublic = await query(
      `SELECT * FROM custom_foods
       WHERE barcode = $1 AND is_public = true
       LIMIT 1`,
      [normalizedCode]
    );
    if (rPublic.rows.length > 0) {
      const cf = rPublic.rows[0];
      return {
        id: cf.id,
        barcode: cf.barcode,
        product_name: cf.product_name,
        brands: cf.brands,
        serving_size: cf.serving_size,
        image_url: cf.image_url || '',
        calories: parseFloat(cf.calories),
        protein: parseFloat(cf.protein),
        fat: parseFloat(cf.fat),
        carbs: parseFloat(cf.carbs),
        fiber: parseFloat(cf.fiber),
        sugar: parseFloat(cf.sugar),
        saturated_fat: parseFloat(cf.saturated_fat),
        sodium: parseFloat(cf.sodium),
        cholesterol: parseFloat(cf.cholesterol),
        potassium: parseFloat(cf.potassium),
        calcium: parseFloat(cf.calcium),
        iron: parseFloat(cf.iron),
        vitamin_a: parseFloat(cf.vitamin_a),
        vitamin_c: parseFloat(cf.vitamin_c),
        source: 'custom',
      };
    }

    // 3+4. Meilisearch (OpenFoodFacts index) then live OFF API — use cache for these
    const cacheKey = `food:barcode:${normalizedCode}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      if (cached === 'NOT_FOUND') {
        return reply.code(404).send({ error: 'Product not found' });
      }
      return JSON.parse(cached);
    }

    const tryBarcode = async (bc) => {
      const r = await foodsIndex.search('', {
        filter: `barcode = "${bc}"`,
        limit: 1,
      });
      return r.hits[0] || null;
    };

    let food = await tryBarcode(normalizedCode);

    // UPC-A (12 digits) → try as EAN-13 with leading zero
    if (!food && normalizedCode.length === 12) {
      food = await tryBarcode('0' + normalizedCode);
    }
    // EAN-13 starting with 0 → try as UPC-A (12 digits)
    if (!food && normalizedCode.length === 13 && normalizedCode.startsWith('0')) {
      food = await tryBarcode(normalizedCode.slice(1));
    }

    // Live OpenFoodFacts fallback
    if (!food) {
      food = await fetchFromOpenFoodFacts(normalizedCode);
    }

    if (!food) {
      await redis.set(cacheKey, 'NOT_FOUND', 'EX', BARCODE_CACHE_TTL);
      return reply.code(404).send({ error: 'Product not found' });
    }

    await redis.set(cacheKey, JSON.stringify(food), 'EX', BARCODE_CACHE_TTL);
    return food;
  });
}

module.exports = foodRoutes;
