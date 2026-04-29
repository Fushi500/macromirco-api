const { query } = require('../db');

async function healthConnectRoutes(fastify) {

  // POST /sync/health-connect
  // Body: { date, steps, active_calories, exercise_sessions: [{name, duration_minutes, calories, type, started_at}] }
  // Upserts daily_health_sync row; inserts workout_logs with source='health_connect' (skip duplicates by started_at).
  fastify.post('/sync/health-connect', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['date', 'steps', 'active_calories'],
        properties: {
          date: { type: 'string', format: 'date' },
          steps: { type: 'integer', minimum: 0 },
          active_calories: { type: 'integer', minimum: 0 },
          exercise_sessions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'duration_minutes', 'started_at'],
              properties: {
                name: { type: 'string', maxLength: 300 },
                duration_minutes: { type: 'integer', minimum: 0 },
                calories: { type: 'integer', minimum: 0 },
                type: { type: 'string', maxLength: 100 },
                started_at: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { date, steps, active_calories, exercise_sessions = [] } = request.body;
    const userId = request.userId;

    // Upsert daily_health_sync
    await query(
      `INSERT INTO daily_health_sync (user_id, date, steps, active_calories, last_sync_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, date)
       DO UPDATE SET steps = EXCLUDED.steps,
                     active_calories = EXCLUDED.active_calories,
                     last_sync_at = NOW()`,
      [userId, date, steps, active_calories]
    );

    // Insert workout_logs for each session, skipping exact duplicates (same user+date+started_at)
    let insertedWorkouts = 0;
    for (const session of exercise_sessions) {
      const startedAt = session.started_at;
      const result = await query(
        `INSERT INTO workout_logs
           (user_id, date, exercise_name, category, duration_minutes,
            estimated_calories, source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'health_connect', $7)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          userId,
          date,
          session.name,
          session.type || 'cardio',
          session.duration_minutes,
          session.calories || null,
          startedAt,
        ]
      );
      if (result.rows.length > 0) insertedWorkouts++;
    }

    reply.code(200);
    return { synced: true, inserted_workouts: insertedWorkouts };
  });

  // GET /sync/health-connect/status
  // Returns last sync time + today's steps/active_kcal from daily_health_sync.
  fastify.get('/sync/health-connect/status', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await query(
      `SELECT last_sync_at, steps, active_calories
       FROM daily_health_sync
       WHERE user_id = $1
       ORDER BY last_sync_at DESC
       LIMIT 1`,
      [request.userId]
    );

    if (result.rows.length === 0) {
      return { last_sync: null, today_steps: null, today_active_kcal: null };
    }

    const row = result.rows[0];

    // Also check if the most recent sync was for today
    const todayResult = await query(
      `SELECT steps, active_calories
       FROM daily_health_sync
       WHERE user_id = $1 AND date = $2`,
      [request.userId, today]
    );

    const todayRow = todayResult.rows[0] ?? null;
    return {
      last_sync: row.last_sync_at,
      today_steps: todayRow ? Number(todayRow.steps) : null,
      today_active_kcal: todayRow ? Number(todayRow.active_calories) : null,
    };
  });
}

module.exports = healthConnectRoutes;
