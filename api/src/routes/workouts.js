const { query, getClient } = require('../db');

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
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } },
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
          estimated_calories: { type: 'number', minimum: 0, nullable: true },
          intensity_level: { type: 'integer', minimum: 1, maximum: 10, nullable: true },
          weight_kg: { type: 'number', minimum: 0, nullable: true },
          client_session_id: { type: 'string', maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    const w = request.body;

    const insertValues = [
      request.userId, w.date, w.exercise_slug, w.exercise_name,
      w.category, w.primary_muscles || [], w.sets || 0, w.reps || 0,
      w.duration_minutes || 0, w.notes || '',
      w.estimated_calories ?? null, w.intensity_level ?? null,
      w.weight_kg ?? null, w.client_session_id || null,
    ];

    if (w.client_session_id) {
      const result = await query(
        `INSERT INTO workout_logs (
          user_id, date, exercise_slug, exercise_name, category,
          primary_muscles, sets, reps, duration_minutes, notes,
          estimated_calories, intensity_level, weight_kg, client_session_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (user_id, client_session_id) DO NOTHING
        RETURNING *`,
        insertValues
      );
      if (result.rows.length === 0) {
        // Duplicate — return existing record
        const existing = await query(
          'SELECT * FROM workout_logs WHERE user_id = $1 AND client_session_id = $2',
          [request.userId, w.client_session_id]
        );
        return existing.rows[0];
      }
      reply.code(201);
      return result.rows[0];
    }

    const result = await query(
      `INSERT INTO workout_logs (
        user_id, date, exercise_slug, exercise_name, category,
        primary_muscles, sets, reps, duration_minutes, notes,
        estimated_calories, intensity_level, weight_kg, client_session_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      insertValues
    );
    reply.code(201);
    return result.rows[0];
  });

  // POST /workouts/batch — atomic insert of multiple workout entries
  fastify.post('/workouts/batch', {
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
                estimated_calories: { type: 'number', minimum: 0, nullable: true },
                intensity_level: { type: 'integer', minimum: 1, maximum: 10, nullable: true },
                weight_kg: { type: 'number', minimum: 0, nullable: true },
                client_session_id: { type: 'string', maxLength: 100 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { entries } = request.body;
    const client = await getClient();

    try {
      await client.query('BEGIN');
      const created = [];

      for (const w of entries) {
        const result = await client.query(
          `INSERT INTO workout_logs (
            user_id, date, exercise_slug, exercise_name, category,
            primary_muscles, sets, reps, duration_minutes, notes,
            estimated_calories, intensity_level, weight_kg, client_session_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (user_id, client_session_id) DO NOTHING
          RETURNING *`,
          [
            request.userId, w.date, w.exercise_slug, w.exercise_name,
            w.category, w.primary_muscles || [], w.sets || 0, w.reps || 0,
            w.duration_minutes || 0, w.notes || '',
            w.estimated_calories ?? null, w.intensity_level ?? null,
            w.weight_kg ?? null, w.client_session_id || null,
          ]
        );
        created.push(result.rows[0] || null);
      }

      await client.query('COMMIT');
      reply.code(201);
      return { created, failed: [] };
    } catch (err) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ created: [], failed: [{ error: err.message }] });
    } finally {
      client.release();
    }
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

  // GET /workouts/history?days=7
  fastify.get('/workouts/history', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 90, default: 7 },
        },
      },
    },
  }, async (request) => {
    const { days } = request.query;
    const result = await query(
      `SELECT date::text, SUM(COALESCE(estimated_calories, 0))::integer AS total_calories
       FROM workout_logs
       WHERE user_id = $1
         AND date >= CURRENT_DATE - ($2::integer - 1)
       GROUP BY date
       HAVING SUM(COALESCE(estimated_calories, 0)) > 0
       ORDER BY date ASC`,
      [request.userId, days]
    );
    return result.rows;
  });

  // GET /workouts/prs
  fastify.get('/workouts/prs', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      `SELECT DISTINCT ON (exercise_slug)
         exercise_slug,
         exercise_name,
         weight_kg AS best_weight,
         reps AS best_reps,
         date::text AS achieved_at
       FROM workout_logs
       WHERE user_id = $1
         AND exercise_slug IS NOT NULL
         AND (weight_kg IS NOT NULL OR reps IS NOT NULL)
       ORDER BY exercise_slug, weight_kg DESC NULLS LAST, reps DESC NULLS LAST`,
      [request.userId]
    );
    return result.rows;
  });

  // GET /workouts/exercise/:slug?limit=20
  fastify.get('/workouts/exercise/:slug', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        },
      },
    },
  }, async (request) => {
    const result = await query(
      `SELECT * FROM workout_logs
       WHERE user_id = $1 AND exercise_slug = $2
       ORDER BY date DESC, created_at DESC
       LIMIT $3`,
      [request.userId, request.params.slug, request.query.limit]
    );
    return result.rows;
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
  // GET /workouts/week — all workouts from Monday of current week through today
  fastify.get('/workouts/week', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sun, 1 = Mon, ...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
    const mondayStr = monday.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    const result = await query(
      'SELECT * FROM workout_logs WHERE user_id = $1 AND date >= $2 AND date <= $3 ORDER BY date, created_at',
      [request.userId, mondayStr, todayStr]
    );
    return result.rows;
  });

}

module.exports = workoutRoutes;
