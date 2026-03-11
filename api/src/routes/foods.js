const { query } = require('../db');

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
        },
      },
    },
  }, async (request, reply) => {
    const f = request.body;
    const result = await query(
      `INSERT INTO daily_foods (
        user_id, date, food_name, calories, carbs, fats, protein,
        fiber, sugar, saturated_fat, sodium, cholesterol, potassium,
        calcium, iron, vitamin_a, vitamin_c, serving_size
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        request.userId, f.date, f.food_name, f.calories || 0, f.carbs || 0,
        f.fats || 0, f.protein || 0, f.fiber || 0, f.sugar || 0,
        f.saturated_fat || 0, f.sodium || 0, f.cholesterol || 0,
        f.potassium || 0, f.calcium || 0, f.iron || 0,
        f.vitamin_a || 0, f.vitamin_c || 0, f.serving_size || '',
      ]
    );
    reply.code(201);
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

  // GET /foods/history?days=30
  fastify.get('/foods/history', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
        },
      },
    },
  }, async (request) => {
    const { days } = request.query;
    const result = await query(
      `SELECT date,
              SUM(calories) as calories,
              SUM(carbs) as carbs,
              SUM(fats) as fats,
              SUM(protein) as protein
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
}

module.exports = foodsRoutes;
