const { query, getClient } = require('../db');

// ─── Exercise calorie estimation (moved from Flutter) ────────────────────────

const CATEGORY_MET = {
  'strength': 3.5,
  'cardio': 7.0,
  'stretching': 2.5,
  'plyometrics': 8.0,
  'strongman': 6.0,
  'calisthenics': 4.5,
  'olympic-weightlifting': 6.0,
  'crossfit': 8.0,
};

const QUICK_MET = {
  'quick_running': 9.8,
  'quick_walking': 3.5,
  'quick_cycling': 7.5,
  'quick_swimming': 8.0,
  'quick_yoga': 2.5,
  'quick_hiit': 10.0,
  'quick_calisthenics': 4.5,
  'quick_sports': 6.0,
  'quick_other': 5.0,
};

const ZONE_MET = {
  'z1': 3.0,
  'z2': 5.5,
  'z3': 8.0,
  'z4': 10.5,
  'z5': 13.0,
};

function isQuickActivity(slug) {
  return slug?.startsWith('quick_');
}

function slugMet(slug, category) {
  if (isQuickActivity(slug) && QUICK_MET[slug]) {
    return QUICK_MET[slug];
  }
  return CATEGORY_MET[category] || 5.0;
}

function intensityMultiplier(intensity) {
  const clamped = Math.max(1, Math.min(10, intensity || 5));
  return 0.6 + (clamped - 1) * (1.0 / 9.0);
}

function estimateCaloriesBurned({
  weightKg,
  category,
  slug,
  durationMinutes,
  sets,
  reps,
  intensity = 5,
  zones,
}) {
  if (!weightKg || weightKg <= 0) return null;

  // Zone-weighted path
  if (zones && Object.keys(zones).length > 0) {
    let kcal = 0;
    for (const [zone, seconds] of Object.entries(zones)) {
      const hours = seconds / 3600;
      kcal += (ZONE_MET[zone] || 5.0) * weightKg * hours;
    }
    return kcal > 0 ? kcal : null;
  }

  let effectiveDuration = durationMinutes;

  // Fallback: estimate duration from sets
  if (!effectiveDuration && sets && sets > 0) {
    effectiveDuration = Math.max(1, Math.min(120, sets * 3)); // 3 min/set, max 2h
  }

  if (!effectiveDuration || effectiveDuration <= 0) return null;

  const met = slugMet(slug, category) * intensityMultiplier(intensity);
  return (met * weightKg * effectiveDuration) / 60;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

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
          zone_breakdown_sec: {
            type: 'object',
            nullable: true,
            properties: {
              z1: { type: 'integer', minimum: 0 },
              z2: { type: 'integer', minimum: 0 },
              z3: { type: 'integer', minimum: 0 },
              z4: { type: 'integer', minimum: 0 },
              z5: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const w = request.body;

    // Compute calories server-side if not provided
    let estimatedCalories = w.estimated_calories ?? null;
    if (estimatedCalories == null) {
      const profileRes = await query(
        'SELECT weight FROM user_profiles WHERE user_id = $1',
        [request.userId]
      );
      const userWeight = parseFloat(profileRes.rows[0]?.weight) || 70;
      estimatedCalories = estimateCaloriesBurned({
        weightKg: userWeight,
        category: w.category,
        slug: w.exercise_slug,
        durationMinutes: w.duration_minutes,
        sets: w.sets,
        reps: w.reps,
        intensity: w.intensity_level || 5,
        zones: w.zone_breakdown_sec,
      });
    }

    const insertValues = [
      request.userId, w.date, w.exercise_slug, w.exercise_name,
      w.category, w.primary_muscles || [], w.sets || 0, w.reps || 0,
      w.duration_minutes || 0, w.notes || '',
      estimatedCalories, w.intensity_level ?? null,
      w.weight_kg ?? null, w.client_session_id || null,
      w.zone_breakdown_sec ? JSON.stringify(w.zone_breakdown_sec) : null,
    ];

    if (w.client_session_id) {
      const result = await query(
        `INSERT INTO workout_logs (
          user_id, date, exercise_slug, exercise_name, category,
          primary_muscles, sets, reps, duration_minutes, notes,
          estimated_calories, intensity_level, weight_kg, client_session_id,
          zone_breakdown_sec
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        ON CONFLICT (user_id, client_session_id) DO NOTHING
        RETURNING *`,
        insertValues
      );
      if (result.rows.length === 0) {
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
        estimated_calories, intensity_level, weight_kg, client_session_id,
        zone_breakdown_sec
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
                zone_breakdown_sec: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    z1: { type: 'integer', minimum: 0 },
                    z2: { type: 'integer', minimum: 0 },
                    z3: { type: 'integer', minimum: 0 },
                    z4: { type: 'integer', minimum: 0 },
                    z5: { type: 'integer', minimum: 0 },
                  },
                },
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

      // Fetch user weight once for batch
      const profileRes = await client.query(
        'SELECT weight FROM user_profiles WHERE user_id = $1',
        [request.userId]
      );
      const userWeight = parseFloat(profileRes.rows[0]?.weight) || 70;

      for (const w of entries) {
        let estimatedCalories = w.estimated_calories ?? null;
        if (estimatedCalories == null) {
          estimatedCalories = estimateCaloriesBurned({
            weightKg: userWeight,
            category: w.category,
            slug: w.exercise_slug,
            durationMinutes: w.duration_minutes,
            sets: w.sets,
            reps: w.reps,
            intensity: w.intensity_level || 5,
            zones: w.zone_breakdown_sec,
          });
        }

        const result = await client.query(
          `INSERT INTO workout_logs (
            user_id, date, exercise_slug, exercise_name, category,
            primary_muscles, sets, reps, duration_minutes, notes,
            estimated_calories, intensity_level, weight_kg, client_session_id,
            zone_breakdown_sec
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          ON CONFLICT (user_id, client_session_id) DO NOTHING
          RETURNING *`,
          [
            request.userId, w.date, w.exercise_slug, w.exercise_name,
            w.category, w.primary_muscles || [], w.sets || 0, w.reps || 0,
            w.duration_minutes || 0, w.notes || '',
            estimatedCalories, w.intensity_level ?? null,
            w.weight_kg ?? null, w.client_session_id || null,
            w.zone_breakdown_sec ? JSON.stringify(w.zone_breakdown_sec) : null,
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

  // GET /workouts/prs?window=all|90d|30d
  fastify.get('/workouts/prs', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          window: { type: 'string', enum: ['all', '90d', '30d'], default: 'all' },
        },
      },
    },
  }, async (request) => {
    const { window } = request.query;
    let dateFilter = '';
    if (window === '90d') {
      dateFilter = `AND date >= CURRENT_DATE - 90`;
    } else if (window === '30d') {
      dateFilter = `AND date >= CURRENT_DATE - 30`;
    }

    const result = await query(
      `WITH ranked AS (
        SELECT
          exercise_slug,
          exercise_name,
          weight_kg,
          reps,
          date::text AS achieved_at,
          CASE WHEN weight_kg IS NOT NULL AND reps IS NOT NULL AND reps > 0
               THEN weight_kg * (1 + reps::numeric / 30)
               ELSE NULL
          END AS estimated_1rm,
          CASE WHEN reps = 3 THEN weight_kg ELSE NULL END AS rm3,
          CASE WHEN reps = 5 THEN weight_kg ELSE NULL END AS rm5,
          CASE WHEN weight_kg IS NOT NULL AND reps IS NOT NULL AND sets IS NOT NULL
               THEN sets * reps * weight_kg
               ELSE NULL
          END AS entry_volume
        FROM workout_logs
        WHERE user_id = $1
          AND exercise_slug IS NOT NULL
          AND (weight_kg IS NOT NULL OR reps IS NOT NULL)
          ${dateFilter}
      ),
      best_1rm AS (
        SELECT DISTINCT ON (exercise_slug)
          exercise_slug,
          estimated_1rm AS best_1rm,
          achieved_at AS best_1rm_at
        FROM ranked
        WHERE estimated_1rm IS NOT NULL
        ORDER BY exercise_slug, estimated_1rm DESC
      ),
      best_3rm AS (
        SELECT DISTINCT ON (exercise_slug)
          exercise_slug,
          rm3 AS best_3rm
        FROM ranked
        WHERE rm3 IS NOT NULL
        ORDER BY exercise_slug, rm3 DESC
      ),
      best_5rm AS (
        SELECT DISTINCT ON (exercise_slug)
          exercise_slug,
          rm5 AS best_5rm
        FROM ranked
        WHERE rm5 IS NOT NULL
        ORDER BY exercise_slug, rm5 DESC
      ),
      best_volume AS (
        SELECT DISTINCT ON (exercise_slug)
          exercise_slug,
          entry_volume AS best_volume
        FROM ranked
        WHERE entry_volume IS NOT NULL
        ORDER BY exercise_slug, entry_volume DESC
      ),
      best_weight_reps AS (
        SELECT DISTINCT ON (exercise_slug)
          exercise_slug,
          weight_kg AS best_weight,
          reps AS best_reps,
          achieved_at
        FROM ranked
        WHERE weight_kg IS NOT NULL
        ORDER BY exercise_slug, weight_kg DESC NULLS LAST, reps DESC NULLS LAST
      )
      SELECT
        w.exercise_slug,
        w.exercise_name,
        bwr.best_weight,
        bwr.best_reps,
        b1.best_1rm,
        b3.best_3rm,
        b5.best_5rm,
        bv.best_volume,
        b1.best_1rm_at AS achieved_at
      FROM (SELECT DISTINCT exercise_slug, exercise_name FROM ranked) w
      LEFT JOIN best_weight_reps bwr ON w.exercise_slug = bwr.exercise_slug
      LEFT JOIN best_1rm b1 ON w.exercise_slug = b1.exercise_slug
      LEFT JOIN best_3rm b3 ON w.exercise_slug = b3.exercise_slug
      LEFT JOIN best_5rm b5 ON w.exercise_slug = b5.exercise_slug
      LEFT JOIN best_volume bv ON w.exercise_slug = bv.exercise_slug
      ORDER BY w.exercise_slug`,
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

  // GET /workouts/streak-stats
  fastify.get('/workouts/streak-stats', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      `WITH dates AS (
        SELECT DISTINCT date::date AS d FROM workout_logs WHERE user_id = $1 ORDER BY d DESC
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
