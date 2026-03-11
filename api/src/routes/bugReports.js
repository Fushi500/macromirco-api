const { query } = require('../db');

async function bugReportRoutes(fastify) {

  // POST /bug-reports
  fastify.post('/bug-reports', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 300 },
          description: { type: 'string', maxLength: 5000 },
        },
      },
    },
  }, async (request, reply) => {
    const { title, description } = request.body;
    const result = await query(
      'INSERT INTO bug_reports (user_id, title, description) VALUES ($1, $2, $3) RETURNING *',
      [request.userId, title, description || '']
    );
    reply.code(201);
    return result.rows[0];
  });
}

module.exports = bugReportRoutes;
