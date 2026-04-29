const { query } = require('../db');

async function measurementRoutes(fastify) {

  // POST /measurements
  fastify.post('/measurements', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['date'],
        properties: {
          date:         { type: 'string', format: 'date' },
          chest_cm:     { type: 'number', minimum: 0, nullable: true },
          waist_cm:     { type: 'number', minimum: 0, nullable: true },
          hips_cm:      { type: 'number', minimum: 0, nullable: true },
          upper_arm_cm: { type: 'number', minimum: 0, nullable: true },
          thigh_cm:     { type: 'number', minimum: 0, nullable: true },
          notes:        { type: 'string', maxLength: 1000, nullable: true },
        },
      },
    },
  }, async (request, reply) => {
    const m = request.body;
    const result = await query(
      `INSERT INTO measurements (user_id, date, chest_cm, waist_cm, hips_cm, upper_arm_cm, thigh_cm, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, date::text AS date, chest_cm, waist_cm, hips_cm, upper_arm_cm, thigh_cm, notes, created_at`,
      [
        request.userId, m.date,
        m.chest_cm ?? null, m.waist_cm ?? null, m.hips_cm ?? null,
        m.upper_arm_cm ?? null, m.thigh_cm ?? null, m.notes ?? null,
      ]
    );
    reply.code(201);
    return result.rows[0];
  });

  // GET /measurements?days=90
  fastify.get('/measurements', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365, default: 90 },
        },
      },
    },
  }, async (request) => {
    const { days } = request.query;
    const result = await query(
      `SELECT id, date::text AS date, chest_cm, waist_cm, hips_cm, upper_arm_cm, thigh_cm, notes, created_at
       FROM measurements
       WHERE user_id = $1
         AND date >= CURRENT_DATE - ($2::integer - 1)
       ORDER BY date ASC`,
      [request.userId, days]
    );
    return result.rows;
  });
}

module.exports = measurementRoutes;
