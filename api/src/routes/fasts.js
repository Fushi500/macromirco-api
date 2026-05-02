const { query } = require('../db');

async function fastRoutes(fastify) {

  // GET /fasts
  fastify.get('/fasts', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
    },
  }, async (request) => {
    const { limit } = request.query;
    const result = await query(
      `SELECT id, started_at, ended_at, planned_duration_hours, goal_met
       FROM fasts
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [request.userId, limit]
    );
    return result.rows;
  });

  // POST /fasts
  fastify.post('/fasts', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['started_at', 'planned_duration_hours'],
        properties: {
          started_at: { type: 'string', format: 'date-time' },
          planned_duration_hours: { type: 'integer', minimum: 1, maximum: 168 },
        },
      },
    },
  }, async (request, reply) => {
    const { started_at, planned_duration_hours } = request.body;
    const result = await query(
      `INSERT INTO fasts (user_id, started_at, planned_duration_hours)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [request.userId, started_at, planned_duration_hours]
    );
    reply.code(201);
    return result.rows[0];
  });

  // PUT /fasts/:id — auto-computes goal_met from ended_at when provided
  fastify.put('/fasts/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          ended_at: { type: 'string', format: 'date-time' },
          goal_met: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    let { ended_at, goal_met } = request.body;

    // Fetch existing fast to compute goal_met if ended_at is provided
    if (ended_at !== undefined && goal_met === undefined) {
      const existingRes = await query(
        'SELECT started_at, planned_duration_hours FROM fasts WHERE id = $1 AND user_id = $2',
        [id, request.userId]
      );
      if (existingRes.rows.length > 0) {
        const fast = existingRes.rows[0];
        const started = new Date(fast.started_at);
        const ended = new Date(ended_at);
        const elapsedMinutes = (ended - started) / (1000 * 60);
        goal_met = elapsedMinutes >= parseInt(fast.planned_duration_hours) * 60;
      }
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (ended_at !== undefined) {
      updates.push(`ended_at = $${paramCount}`);
      values.push(ended_at);
      paramCount++;
    }
    if (goal_met !== undefined) {
      updates.push(`goal_met = $${paramCount}`);
      values.push(goal_met);
      paramCount++;
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    values.push(id, request.userId);
    const result = await query(
      `UPDATE fasts SET ${updates.join(', ')} WHERE id = $${paramCount} AND user_id = $${paramCount + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return result.rows[0];
  });

}

module.exports = fastRoutes;
