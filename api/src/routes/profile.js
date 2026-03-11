const { query } = require('../db');

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
}

module.exports = profileRoutes;
