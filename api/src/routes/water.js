const { query } = require('../db');

async function waterRoutes(fastify) {

  // POST /water — upsert: add amount_ml to today's total
  fastify.post('/water', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        required: ['amount_ml', 'date'],
        properties: {
          amount_ml: { type: 'integer', minimum: 1 },
          date: { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request, reply) => {
    const { amount_ml, date } = request.body;
    const result = await query(
      `INSERT INTO water_logs (user_id, date, amount_ml)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date)
       DO UPDATE SET amount_ml = water_logs.amount_ml + $3
       RETURNING *`,
      [request.userId, date, amount_ml]
    );
    reply.code(201);
    return result.rows[0];
  });

  // GET /water/today?date=YYYY-MM-DD
  fastify.get('/water/today', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: { date: { type: 'string', format: 'date' } },
      },
    },
  }, async (request) => {
    const date = request.query.date || new Date().toISOString().split('T')[0];
    const result = await query(
      'SELECT amount_ml FROM water_logs WHERE user_id = $1 AND date = $2',
      [request.userId, date]
    );
    return { amount_ml: result.rows[0]?.amount_ml ?? 0 };
  });

  // GET /water/goal
  fastify.get('/water/goal', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      'SELECT water_goal_ml FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );
    return { water_goal_ml: result.rows[0]?.water_goal_ml ?? 2000 };
  });
  // GET /water/week — water amounts for last 7 days
  fastify.get('/water/week', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      `SELECT date, amount_ml
       FROM water_logs
       WHERE user_id = $1 AND date >= CURRENT_DATE - 6
       ORDER BY date`,
      [request.userId]
    );
    return result.rows.map(r => {
      const d = new Date(r.date);
      return {
        date: r.date,
        dayIndex: (d.getDay() + 6) % 7,
        amountMl: parseInt(r.amount_ml),
      };
    });
  });

  // GET /water/history?days=30 — water amounts for last N days
  fastify.get('/water/history', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: { days: { type: 'integer', minimum: 1, maximum: 365, default: 30 } },
      },
    },
  }, async (request) => {
    const days = request.query.days ?? 30;
    const result = await query(
      `SELECT date, amount_ml
       FROM water_logs
       WHERE user_id = $1 AND date >= CURRENT_DATE - ($2 - 1)
       ORDER BY date DESC`,
      [request.userId, days]
    );
    return result.rows.map(r => ({
      date: r.date,
      amount_ml: parseInt(r.amount_ml),
    }));
  });
}

module.exports = waterRoutes;
