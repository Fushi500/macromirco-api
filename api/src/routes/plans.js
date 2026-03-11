const { query, getClient } = require('../db');

async function planRoutes(fastify) {

  // GET /plans — all user plans with exercises
  fastify.get('/plans', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const plans = await query(
      'SELECT * FROM workout_plans WHERE user_id = $1 ORDER BY created_at DESC',
      [request.userId]
    );

    // Fetch exercises for each plan
    for (const plan of plans.rows) {
      const exercises = await query(
        'SELECT * FROM workout_plan_exercises WHERE plan_id = $1 ORDER BY sort_order',
        [plan.id]
      );
      plan.exercises = exercises.rows;
    }

    return plans.rows;
  });

  // POST /plans — create plan with exercises
  fastify.post('/plans', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                exercise_slug: { type: 'string' },
                exercise_name: { type: 'string', maxLength: 300 },
                category: { type: 'string' },
                primary_muscles: { type: 'array', items: { type: 'string' } },
                sets: { type: 'integer' },
                reps: { type: 'integer' },
                duration_minutes: { type: 'number' },
                rest_seconds: { type: 'integer' },
                notes: { type: 'string', maxLength: 1000 },
                sort_order: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { name, description, exercises } = request.body;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const planResult = await client.query(
        'INSERT INTO workout_plans (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
        [request.userId, name, description || '']
      );
      const plan = planResult.rows[0];

      if (exercises && exercises.length > 0) {
        for (let i = 0; i < exercises.length; i++) {
          const e = exercises[i];
          await client.query(
            `INSERT INTO workout_plan_exercises (
              plan_id, exercise_slug, exercise_name, category,
              primary_muscles, sets, reps, duration_minutes,
              rest_seconds, notes, sort_order
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              plan.id, e.exercise_slug, e.exercise_name, e.category,
              e.primary_muscles || [], e.sets || 0, e.reps || 0,
              e.duration_minutes || 0, e.rest_seconds || 0,
              e.notes || '', e.sort_order ?? i,
            ]
          );
        }
      }

      await client.query('COMMIT');

      // Fetch full plan with exercises
      const exResult = await query(
        'SELECT * FROM workout_plan_exercises WHERE plan_id = $1 ORDER BY sort_order',
        [plan.id]
      );
      plan.exercises = exResult.rows;

      reply.code(201);
      return plan;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // PUT /plans/:id — update plan
  fastify.put('/plans/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 2000 },
          exercises: { type: 'array' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, description, exercises } = request.body;
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Verify ownership
      const check = await client.query(
        'SELECT id FROM workout_plans WHERE id = $1 AND user_id = $2',
        [request.params.id, request.userId]
      );
      if (check.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Not found' });
      }

      // Update plan fields
      if (name || description !== undefined) {
        const setClauses = [];
        const vals = [];
        let p = 1;
        if (name) { setClauses.push(`name = $${p++}`); vals.push(name); }
        if (description !== undefined) { setClauses.push(`description = $${p++}`); vals.push(description); }
        vals.push(request.params.id);
        await client.query(
          `UPDATE workout_plans SET ${setClauses.join(', ')} WHERE id = $${p}`,
          vals
        );
      }

      // Replace exercises if provided
      if (exercises) {
        await client.query(
          'DELETE FROM workout_plan_exercises WHERE plan_id = $1',
          [request.params.id]
        );
        for (let i = 0; i < exercises.length; i++) {
          const e = exercises[i];
          await client.query(
            `INSERT INTO workout_plan_exercises (
              plan_id, exercise_slug, exercise_name, category,
              primary_muscles, sets, reps, duration_minutes,
              rest_seconds, notes, sort_order
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              request.params.id, e.exercise_slug, e.exercise_name, e.category,
              e.primary_muscles || [], e.sets || 0, e.reps || 0,
              e.duration_minutes || 0, e.rest_seconds || 0,
              e.notes || '', e.sort_order ?? i,
            ]
          );
        }
      }

      await client.query('COMMIT');

      // Return updated plan
      const plan = await query('SELECT * FROM workout_plans WHERE id = $1', [request.params.id]);
      const exResult = await query(
        'SELECT * FROM workout_plan_exercises WHERE plan_id = $1 ORDER BY sort_order',
        [request.params.id]
      );
      plan.rows[0].exercises = exResult.rows;
      return plan.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // DELETE /plans/:id
  fastify.delete('/plans/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'DELETE FROM workout_plans WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return { deleted: true };
  });
}

module.exports = planRoutes;
