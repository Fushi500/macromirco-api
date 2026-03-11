const { query } = require('../db');

async function customExerciseRoutes(fastify) {

  // GET /custom-exercises — list user's own
  fastify.get('/custom-exercises', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200 },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { q, page, limit } = request.query;
    const offset = (page - 1) * limit;

    let result;
    if (q && q.trim()) {
      result = await query(
        `SELECT *, COUNT(*) OVER() AS total FROM custom_exercises
         WHERE user_id = $1 AND name ILIKE $2
         ORDER BY name
         LIMIT $3 OFFSET $4`,
        [request.userId, `%${q.trim()}%`, limit, offset]
      );
    } else {
      result = await query(
        `SELECT *, COUNT(*) OVER() AS total FROM custom_exercises
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [request.userId, limit, offset]
      );
    }

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total) : 0;
    const exercises = result.rows.map(r => { delete r.total; return r; });
    return { page, limit, total, exercises };
  });

  // GET /public-exercises — all users' public exercises
  fastify.get('/public-exercises', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200 },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { q, page, limit } = request.query;
    const offset = (page - 1) * limit;

    let result;
    if (q && q.trim()) {
      result = await query(
        `SELECT *, COUNT(*) OVER() AS total FROM custom_exercises
         WHERE is_public = true AND name ILIKE $1
         ORDER BY name
         LIMIT $2 OFFSET $3`,
        [`%${q.trim()}%`, limit, offset]
      );
    } else {
      result = await query(
        `SELECT *, COUNT(*) OVER() AS total FROM custom_exercises
         WHERE is_public = true
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
    }

    const total = result.rows.length > 0 ? parseInt(result.rows[0].total) : 0;
    const exercises = result.rows.map(r => { delete r.total; return r; });
    return { page, limit, total, exercises };
  });

  // GET /custom-exercises/:id
  fastify.get('/custom-exercises/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'SELECT * FROM custom_exercises WHERE id = $1 AND (user_id = $2 OR is_public = true)',
      [request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return result.rows[0];
  });

  // POST /custom-exercises
  fastify.post('/custom-exercises', {
    preHandler: [fastify.ensureProfile],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          category: { type: 'string', maxLength: 100 },
          force: { type: 'string', maxLength: 50 },
          level: { type: 'string', maxLength: 50 },
          mechanic: { type: 'string', maxLength: 50 },
          equipment: { type: 'string', maxLength: 100 },
          primary_muscles: { type: 'array', items: { type: 'string' } },
          secondary_muscles: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'array', items: { type: 'string' } },
          image_url: { type: 'string', maxLength: 1000 },
          is_public: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const e = request.body;
    const result = await query(
      `INSERT INTO custom_exercises (
        user_id, name, category, force, level, mechanic, equipment,
        primary_muscles, secondary_muscles, instructions, image_url, is_public
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        request.userId, e.name, e.category || '', e.force || '', e.level || '',
        e.mechanic || '', e.equipment || '',
        e.primary_muscles || [], e.secondary_muscles || [],
        e.instructions || [], e.image_url || '', e.is_public || false,
      ]
    );
    reply.code(201);
    return result.rows[0];
  });

  // PUT /custom-exercises/:id
  fastify.put('/custom-exercises/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 300 },
          category: { type: 'string', maxLength: 100 },
          force: { type: 'string', maxLength: 50 },
          level: { type: 'string', maxLength: 50 },
          mechanic: { type: 'string', maxLength: 50 },
          equipment: { type: 'string', maxLength: 100 },
          primary_muscles: { type: 'array', items: { type: 'string' } },
          secondary_muscles: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'array', items: { type: 'string' } },
          image_url: { type: 'string', maxLength: 1000 },
          is_public: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const check = await query(
      'SELECT id FROM custom_exercises WHERE id = $1 AND user_id = $2',
      [request.params.id, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const fields = request.body;
    const setClauses = [];
    const values = [];
    let p = 1;

    for (const [key, value] of Object.entries(fields)) {
      setClauses.push(`${key} = $${p++}`);
      values.push(value);
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    values.push(request.params.id);
    const result = await query(
      `UPDATE custom_exercises SET ${setClauses.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    return result.rows[0];
  });

  // DELETE /custom-exercises/:id
  fastify.delete('/custom-exercises/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      'DELETE FROM custom_exercises WHERE id = $1 AND user_id = $2 RETURNING id',
      [request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return { deleted: true };
  });
}

module.exports = customExerciseRoutes;
