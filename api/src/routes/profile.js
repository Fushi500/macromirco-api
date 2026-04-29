const { query, getClient } = require('../db');

async function profileRoutes(fastify) {

  // GET /profile — get own profile
  fastify.get('/profile', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    return result.rows[0];
  });

  // POST /profile — create or update profile
  fastify.post('/profile', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 200 },
          age: { type: 'integer', minimum: 1, maximum: 150 },
          gender: { type: 'string', enum: ['male', 'female', 'other'] },
          weight: { type: 'number', minimum: 0 },
          height: { type: 'number', minimum: 0 },
          weight_unit: { type: 'string', enum: ['kg', 'lbs'] },
          unit_system: { type: 'string', enum: ['metric', 'imperial'] },
          activity_level: { type: 'string', maxLength: 50 },
          goal: { type: 'string', maxLength: 100 },
          goal_rate: { type: 'string', maxLength: 50 },
          tdee: { type: 'number' },
          target_calories: { type: 'number' },
          water_goal_ml: { type: 'integer', minimum: 0 },
          nutrient_prefs: {
            type: 'object',
            properties: {
              visible_nutrients: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['visible_nutrients'],
          },
        },
      },
    },
  }, async (request, reply) => {
    const fields = request.body;

    if (fields.user_id !== undefined) {
      return reply.code(400).send({ error: 'user_id must not be sent in request body' });
    }

    const setClauses = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(fields)) {
      setClauses.push(`${key} = $${paramCount}`);
      values.push(key === 'nutrient_prefs' ? JSON.stringify(value) : value);
      paramCount++;
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    values.push(request.userId);
    const result = await query(
      `UPDATE user_profiles SET ${setClauses.join(', ')} WHERE user_id = $${paramCount} RETURNING *`,
      values
    );

    return result.rows[0];
  });

  // DELETE /account — delete all user app data (no auth.users cleanup)
  fastify.delete('/account', {
    preHandler: [fastify.requireAuth],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const userId = request.userId;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Delete in dependency order to avoid FK violations
      await client.query('DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM recipes WHERE user_id = $1)', [userId]);
      await client.query('DELETE FROM recipes WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM workout_plan_exercises WHERE plan_id IN (SELECT id FROM workout_plans WHERE user_id = $1)', [userId]);
      await client.query('DELETE FROM workout_plans WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM food_collection_items WHERE collection_id IN (SELECT id FROM food_collections WHERE user_id = $1)', [userId]);
      await client.query('DELETE FROM food_collections WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM daily_foods WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM workout_logs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM weight_logs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM water_logs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM custom_foods WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM custom_exercises WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM measurements WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM training_split WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM daily_health_sync WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM food_recognition_feedback WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_profiles WHERE user_id = $1', [userId]);

      await client.query('COMMIT');
      reply.code(204).send();
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /user/meal-periods
  fastify.get('/user/meal-periods', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'SELECT meal_periods FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Profile not found' });
    }
    return { meal_periods: result.rows[0].meal_periods };
  });

  // PUT /user/meal-periods
  fastify.put('/user/meal-periods', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['meal_periods'],
        properties: {
          meal_periods: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'name'],
              properties: {
                id: { type: 'string', maxLength: 50 },
                name: { type: 'string', maxLength: 100 },
                start: { type: ['string', 'null'], maxLength: 10 },
                end: { type: ['string', 'null'], maxLength: 10 },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const { meal_periods } = request.body;
    const result = await query(
      'UPDATE user_profiles SET meal_periods = $1 WHERE user_id = $2 RETURNING meal_periods',
      [JSON.stringify(meal_periods), request.userId]
    );
    return { meal_periods: result.rows[0].meal_periods };
  });
  // GET /profile/training-split
  fastify.get('/profile/training-split', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      `SELECT weekday, label, calorie_delta, carb_delta_g, fat_delta_g, protein_delta_g
       FROM training_split
       WHERE user_id = $1
       ORDER BY weekday`,
      [request.userId]
    );
    return result.rows.map(r => ({
      weekday: r.weekday,
      label: r.label,
      calorie_delta: r.calorie_delta,
      carb_delta_g: parseFloat(r.carb_delta_g),
      fat_delta_g: parseFloat(r.fat_delta_g),
      protein_delta_g: parseFloat(r.protein_delta_g),
    }));
  });

  // PUT /profile/training-split
  fastify.put('/profile/training-split', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['split'],
        properties: {
          split: {
            type: 'array',
            items: {
              type: 'object',
              required: ['weekday', 'label', 'calorie_delta', 'carb_delta_g', 'fat_delta_g', 'protein_delta_g'],
              properties: {
                weekday: { type: 'integer', minimum: 1, maximum: 7 },
                label: { type: 'string', minLength: 1, maxLength: 100 },
                calorie_delta: { type: 'integer' },
                carb_delta_g: { type: 'number' },
                fat_delta_g: { type: 'number' },
                protein_delta_g: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    const { split } = request.body;

    // Delete existing rows, then insert new ones in a transaction
    await query('DELETE FROM training_split WHERE user_id = $1', [request.userId]);

    if (split.length > 0) {
      const valuePlaceholders = split.map((_, i) => {
        const base = i * 7;
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
      }).join(',');
      const values = split.flatMap(d => [
        request.userId, d.weekday, d.label,
        d.calorie_delta, d.carb_delta_g, d.fat_delta_g, d.protein_delta_g,
      ]);
      await query(
        `INSERT INTO training_split (user_id, weekday, label, calorie_delta, carb_delta_g, fat_delta_g, protein_delta_g)
         VALUES ${valuePlaceholders}`,
        values
      );
    }

    return { saved: true };
  });
}

module.exports = profileRoutes;
