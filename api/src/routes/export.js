const { query } = require('../db');

async function exportRoutes(fastify) {

  // GET /export?from=YYYY-MM-DD&to=YYYY-MM-DD
  fastify.get('/export', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string', format: 'date' },
          to:   { type: 'string', format: 'date' },
        },
        required: ['from', 'to'],
      },
    },
  }, async (request) => {
    const { from, to } = request.query;

    const [foodsRes, workoutsRes, measurementsRes] = await Promise.all([
      query(
        `SELECT * FROM daily_foods
         WHERE user_id = $1 AND date BETWEEN $2 AND $3
         ORDER BY date, created_at`,
        [request.userId, from, to]
      ),
      query(
        `SELECT * FROM workout_logs
         WHERE user_id = $1 AND date BETWEEN $2 AND $3
         ORDER BY date, created_at`,
        [request.userId, from, to]
      ),
      query(
        `SELECT id, date::text AS date, chest_cm, waist_cm, hips_cm,
                upper_arm_cm, thigh_cm, notes, created_at
         FROM measurements
         WHERE user_id = $1 AND date BETWEEN $2 AND $3
         ORDER BY date`,
        [request.userId, from, to]
      ),
    ]);

    return {
      foods: foodsRes.rows,
      workouts: workoutsRes.rows,
      measurements: measurementsRes.rows,
    };
  });
}

module.exports = exportRoutes;
