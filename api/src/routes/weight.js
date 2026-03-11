const { query } = require('../db');

async function weightRoutes(fastify) {

  // GET /weight/today?date=2026-02-28
  fastify.get('/weight/today', {
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
      'SELECT * FROM weight_logs WHERE user_id = $1 AND date = $2',
      [request.userId, date]
    );
    return result.rows[0] || null;
  });

  // POST /weight
  fastify.post('/weight', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        required: ['date', 'weight'],
        properties: {
          date: { type: 'string', format: 'date' },
          weight: { type: 'number', minimum: 0 },
          unit: { type: 'string', enum: ['kg', 'lbs'] },
        },
      },
    },
  }, async (request, reply) => {
    const { date, weight, unit } = request.body;
    const result = await query(
      `INSERT INTO weight_logs (user_id, date, weight, unit)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, date)
       DO UPDATE SET weight = $3, unit = $4
       RETURNING *`,
      [request.userId, date, weight, unit || 'kg']
    );
    reply.code(201);
    return result.rows[0];
  });

  // GET /weight/recent?days=14
  fastify.get('/weight/recent', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365, default: 14 },
        },
      },
    },
  }, async (request) => {
    const { days } = request.query;
    const result = await query(
      `SELECT * FROM weight_logs
       WHERE user_id = $1 AND date >= CURRENT_DATE - $2::integer
       ORDER BY date DESC`,
      [request.userId, days]
    );
    return result.rows;
  });
}

module.exports = weightRoutes;
