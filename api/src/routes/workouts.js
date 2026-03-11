const { query } = require('../db');

async function workoutRoutes(fastify) {

  // GET /workouts/today?date=2026-02-28
  fastify.get('/workouts/today', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: { date: { type: 'string', format: 'date' } },
        required: ['date'],
      },
    },
  }, async (request) => {
    const result = await query(
      'SELECT * FROM workout_logs WHERE user_id = $1 AND date = $2 ORDER BY created_at',
      [request.userId, request.query.date]
    );
    return result.rows;
  });

  // POST /workouts
  fastify.post('/workouts', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        required: ['date'],
        properties: {
          date: { type: 'string', format: 'date' },
          exercise_slug: { type: 'string', maxLength: 200 },
          exercise_name: { type: 'string', maxLength: 300 },
          category: { type: 'string', maxLength: 100 },
          primary_muscles: { type: 'array', items: { type: 'string' } },
          sets: { type: 'integer', minimum: 0 },
          reps: { type: 'integer', minimum: 0 },
          duration_minutes: { type: 'number', minimum: 0 },
          notes: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const w = request.body;
    const result = await query(
      `INSERT INTO workout_logs (
        user_id, date, exercise_slug, exercise_name, category,
        primary_muscles, sets, reps, duration_minutes, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        request.userId, w.date, w.exercise_slug, w.exercise_name,
        w.category, w.primary_muscles || [], w.sets || 0, w.reps || 0,
        w.duration_minutes || 0, w.notes || '',
      ]
    );
    reply.code(201);
    return result.rows[0];
  });

  // DELETE /workouts/:id
  fastify.delete('/workouts/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'DELETE FROM workout_logs WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return { deleted: true };
  });

  // GET /workouts/streak?weeks=4
  fastify.get('/workouts/streak', {
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
       FROM workout_logs
       WHERE user_id = $1 AND date >= CURRENT_DATE - ($2::integer * 7)
       ORDER BY date`,
      [request.userId, weeks]
    );
    return result.rows.map(r => {
      const d = new Date(r.date);
      return { date: r.date, dayIndex: (d.getDay() + 6) % 7 };
    });
  });
}

module.exports = workoutRoutes;
