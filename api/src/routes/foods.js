const { query } = require('../db');
const { normalizeMealType, normalizeEntryType } = require('../utils/mealType');

async function foodsRoutes(fastify) {

  // GET /foods/today?date=2026-02-28
  fastify.get('/foods/today', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date' },
        },
        required: ['date'],
      },
    },
  }, async (request) => {
    const { date } = request.query;
    const result = await query(
      'SELECT * FROM daily_foods WHERE user_id = $1 AND date = $2 ORDER BY created_at',
      [request.userId, date]
    );
    return result.rows;
  });

  // POST /foods — add food entry
  fastify.post('/foods', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        required: ['date', 'food_name'],
        properties: {
          date: { type: 'string', format: 'date' },
          food_name: { type: 'string', minLength: 1, maxLength: 500 },
          calories: { type: 'number' },
          carbs: { type: 'number' },
          fats: { type: 'number' },
          protein: { type: 'number' },
          fiber: { type: 'number' },
          sugar: { type: 'number' },
          saturated_fat: { type: 'number' },
          sodium: { type: 'number' },
          cholesterol: { type: 'number' },
          potassium: { type: 'number' },
          calcium: { type: 'number' },
          iron: { type: 'number' },
          vitamin_a: { type: 'number' },
          vitamin_c: { type: 'number' },
          serving_size: { type: 'string', maxLength: 200 },
          quantity_multiplier: { type: 'number', minimum: 0.01, maximum: 99.99 },
          meal_type: { type: 'string', maxLength: 100 },
          entry_type: { type: 'string', maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const f = request.body;
    const mealType = normalizeMealType(f.meal_type);
    const entryType = normalizeEntryType(f.entry_type);
    const result = await query(
      `INSERT INTO daily_foods (
        user_id, date, food_name, calories, carbs, fats, protein,
        fiber, sugar, saturated_fat, sodium, cholesterol, potassium,
        calcium, iron, vitamin_a, vitamin_c, serving_size, quantity_multiplier,
        meal_type, entry_type
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      RETURNING *`,
      [
        request.userId, f.date, f.food_name, f.calories || 0, f.carbs || 0,
        f.fats || 0, f.protein || 0, f.fiber || 0, f.sugar || 0,
        f.saturated_fat || 0, f.sodium || 0, f.cholesterol || 0,
        f.potassium || 0, f.calcium || 0, f.iron || 0,
        f.vitamin_a || 0, f.vitamin_c || 0, f.serving_size || '',
        f.quantity_multiplier ?? 1.0, mealType, entryType,
      ]
    );
    reply.code(201);
    return result.rows[0];
  });

  // POST /foods/batch — insert multiple food entries at once
  fastify.post('/foods/batch', {
    preHandler: [fastify.ensureProfile],
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['entries'],
        properties: {
          entries: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              required: ['date', 'food_name'],
              properties: {
                date: { type: 'string', format: 'date' },
                food_name: { type: 'string', minLength: 1, maxLength: 500 },
                calories: { type: 'number' },
                carbs: { type: 'number' },
                fats: { type: 'number' },
                protein: { type: 'number' },
                fiber: { type: 'number' },
                sugar: { type: 'number' },
                saturated_fat: { type: 'number' },
                sodium: { type: 'number' },
                cholesterol: { type: 'number' },
                potassium: { type: 'number' },
                calcium: { type: 'number' },
                iron: { type: 'number' },
                vitamin_a: { type: 'number' },
                vitamin_c: { type: 'number' },
                serving_size: { type: 'string', maxLength: 200 },
                quantity_multiplier: { type: 'number', minimum: 0.01, maximum: 99.99 },
                meal_type: { type: 'string', maxLength: 100 },
                entry_type: { type: 'string', maxLength: 50 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { entries } = request.body;
    const created = [];
    const failed = [];

    for (const entry of entries) {
      try {
        const mealType = normalizeMealType(entry.meal_type);
        const entryType = normalizeEntryType(entry.entry_type);
        const result = await query(
          `INSERT INTO daily_foods (
            user_id, date, food_name, calories, carbs, fats, protein,
            fiber, sugar, saturated_fat, sodium, cholesterol, potassium,
            calcium, iron, vitamin_a, vitamin_c, serving_size, quantity_multiplier,
            meal_type, entry_type
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          RETURNING *`,
          [
            request.userId, entry.date, entry.food_name, entry.calories || 0, entry.carbs || 0,
            entry.fats || 0, entry.protein || 0, entry.fiber || 0, entry.sugar || 0,
            entry.saturated_fat || 0, entry.sodium || 0, entry.cholesterol || 0,
            entry.potassium || 0, entry.calcium || 0, entry.iron || 0,
            entry.vitamin_a || 0, entry.vitamin_c || 0, entry.serving_size || '',
            entry.quantity_multiplier ?? 1.0, mealType, entryType,
          ]
        );
        created.push(result.rows[0]);
      } catch (err) {
        failed.push({ entry, error: err.message });
      }
    }

    reply.code(201);
    return { created, failed };
  });

  // PUT /foods/:id — update quantity
  fastify.put('/foods/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['quantity'],
        properties: {
          quantity: { type: 'number', minimum: 0.1, maximum: 9999 },
          unit: { type: 'string', maxLength: 20 },
          meal_type: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { quantity, meal_type } = request.body;
    const normalizedMealType = meal_type != null ? normalizeMealType(meal_type) : null;

    const existing = await query(
      'SELECT * FROM daily_foods WHERE id = $1 AND user_id = $2',
      [id, request.userId]
    );
    if (existing.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const entry = existing.rows[0];
    const servingSize = parseFloat(entry.serving_size) || 100;
    const oldMultiplier = parseFloat(entry.quantity_multiplier) || 1.0;
    const newMultiplier = quantity / servingSize;
    const scale = newMultiplier / oldMultiplier;

    const mealTypeClause = normalizedMealType ? `, meal_type = $5` : '';
    const queryParams = [id, request.userId, newMultiplier, scale];
    if (normalizedMealType) queryParams.push(normalizedMealType);

    const result = await query(
      `UPDATE daily_foods SET
        quantity_multiplier = $3,
        calories = calories * $4,
        carbs = carbs * $4,
        fats = fats * $4,
        protein = protein * $4,
        fiber = fiber * $4,
        sugar = sugar * $4,
        saturated_fat = saturated_fat * $4,
        sodium = sodium * $4,
        cholesterol = cholesterol * $4,
        potassium = potassium * $4,
        calcium = calcium * $4,
        iron = iron * $4,
        vitamin_a = vitamin_a * $4,
        vitamin_c = vitamin_c * $4
        ${mealTypeClause}
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
      queryParams
    );
    return result.rows[0];
  });

  // DELETE /foods/:id
  fastify.delete('/foods/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'DELETE FROM daily_foods WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return { deleted: true };
  });

  // POST /foods/copy-from-date
  fastify.post('/foods/copy-from-date', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['from_date', 'to_date'],
        properties: {
          from_date: { type: 'string', format: 'date' },
          to_date:   { type: 'string', format: 'date' },
          meal_type: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const { from_date, to_date, meal_type } = request.body;
    const normalizedMealType = meal_type != null ? normalizeMealType(meal_type) : null;
    const mealFilter = normalizedMealType ? `AND meal_type = $4` : '';
    const params = [request.userId, from_date, to_date];
    if (normalizedMealType) params.push(normalizedMealType);

    const result = await query(
      `INSERT INTO daily_foods (
         user_id, date, food_name, calories, carbs, fats, protein,
         fiber, sugar, saturated_fat, sodium, cholesterol, potassium,
         calcium, iron, vitamin_a, vitamin_c, serving_size,
         quantity_multiplier, meal_type, entry_type
       )
       SELECT $1, $3, food_name, calories, carbs, fats, protein,
              fiber, sugar, saturated_fat, sodium, cholesterol, potassium,
              calcium, iron, vitamin_a, vitamin_c, serving_size,
              quantity_multiplier, meal_type, entry_type
       FROM daily_foods
       WHERE user_id = $1 AND date = $2 ${mealFilter}
       RETURNING id`,
      params
    );
    reply.code(201);
    return { copied: result.rowCount };
  });

  // GET /foods/frequents?limit=20
  fastify.get('/foods/frequents', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { limit } = request.query;
    const result = await query(
      `SELECT
        food_name AS product_name,
        '' AS brands,
        serving_size,
        calories,
        carbs,
        fats AS fat,
        protein,
        fiber,
        sugar,
        saturated_fat,
        sodium,
        cholesterol,
        potassium,
        calcium,
        iron,
        vitamin_a,
        vitamin_c,
        COUNT(*) AS frequency
      FROM daily_foods
      WHERE user_id = $1
        AND date >= CURRENT_DATE - 60
      GROUP BY food_name, serving_size, calories, carbs, fats, protein,
               fiber, sugar, saturated_fat, sodium, cholesterol, potassium,
               calcium, iron, vitamin_a, vitamin_c
      ORDER BY frequency DESC
      LIMIT $2`,
      [request.userId, limit]
    );
    return result.rows.map(r => ({
      product_name: r.product_name,
      brands: r.brands,
      serving_size: r.serving_size,
      nutriments: {
        'energy-kcal': r.calories,
        carbohydrates: r.carbs,
        fat: r.fat,
        proteins: r.protein,
        fiber: r.fiber,
        sugars: r.sugar,
        'saturated-fat': r.saturated_fat,
        sodium: r.sodium,
        cholesterol: r.cholesterol,
        potassium: r.potassium,
        calcium: r.calcium,
        iron: r.iron,
        'vitamin-a': r.vitamin_a,
        'vitamin-c': r.vitamin_c,
      },
      source: 'history',
      source_id: null,
      frequency: parseInt(r.frequency),
    }));
  });

  // GET /foods/history?days=30  (aggregated daily totals — existing)
  fastify.get('/foods/history', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
          from: { type: 'string', format: 'date' },
          to:   { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request) => {
    const { days, from, to } = request.query;

    // Per-entry bulk fetch for export when from+to are provided
    if (from && to) {
      const result = await query(
        `SELECT * FROM daily_foods
         WHERE user_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date DESC, created_at DESC`,
        [request.userId, from, to]
      );
      return result.rows;
    }

    const result = await query(
      `SELECT date,
              SUM(calories) as calories,
              SUM(carbs) as carbs,
              SUM(fats) as fats,
              SUM(protein) as protein,
              SUM(fiber) as fiber,
              SUM(sugar) as sugar,
              SUM(saturated_fat) as saturated_fat,
              SUM(sodium) as sodium,
              SUM(cholesterol) as cholesterol,
              SUM(potassium) as potassium,
              SUM(calcium) as calcium,
              SUM(iron) as iron,
              SUM(vitamin_a) as vitamin_a,
              SUM(vitamin_c) as vitamin_c
       FROM daily_foods
       WHERE user_id = $1 AND date >= CURRENT_DATE - $2::integer
       GROUP BY date
       ORDER BY date DESC`,
      [request.userId, days]
    );
    return result.rows;
  });

  // GET /foods/streak?weeks=4
  fastify.get('/foods/streak', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          weeks: { type: 'integer', minimum: 1, maximum: 52, default: 4 },
        },
      },
    },
  }, async (request) => {
    const { weeks } = request.query;
    const result = await query(
      `SELECT DISTINCT date
       FROM daily_foods
       WHERE user_id = $1 AND date >= CURRENT_DATE - ($2::integer * 7)
       ORDER BY date`,
      [request.userId, weeks]
    );
    // Return day-of-week indices (0 = Monday)
    return result.rows.map(r => {
      const d = new Date(r.date);
      return { date: r.date, dayIndex: (d.getDay() + 6) % 7 };
    });
  });

  // GET /foods/streak-stats
  fastify.get('/foods/streak-stats', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      `WITH dates AS (
        SELECT DISTINCT date::date AS d FROM daily_foods WHERE user_id = $1 ORDER BY d DESC
      ),
      streaks AS (
        SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::integer AS grp FROM dates
      ),
      grouped AS (
        SELECT grp, COUNT(*) AS len, MIN(d) AS start_date, MAX(d) AS end_date
        FROM streaks GROUP BY grp ORDER BY end_date DESC
      )
      SELECT
        (SELECT len FROM grouped LIMIT 1) AS current_streak,
        (SELECT MAX(len) FROM grouped) AS longest_streak`,
      [request.userId]
    );
    const row = result.rows[0] || {};
    return {
      current_streak: parseInt(row.current_streak) || 0,
      longest_streak: parseInt(row.longest_streak) || 0,
    };
  });
  // GET /foods/week-activity — per-day activity data for streak display
  fastify.get('/foods/week-activity', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      `SELECT date,
              COUNT(DISTINCT meal_type) as meal_type_count,
              COUNT(*) as food_count
       FROM daily_foods
       WHERE user_id = $1 AND date >= CURRENT_DATE - 6
       GROUP BY date
       ORDER BY date`,
      [request.userId]
    );
    return result.rows.map(r => {
      const d = new Date(r.date);
      return {
        date: r.date,
        dayIndex: (d.getDay() + 6) % 7,
        mealTypeCount: parseInt(r.meal_type_count),
        foodCount: parseInt(r.food_count),
      };
    });
  });
}

module.exports = foodsRoutes;
