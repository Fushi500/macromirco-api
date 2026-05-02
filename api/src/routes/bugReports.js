const { query } = require('../db');
const { sendBugReportAlert } = require('../services/email');

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
    const report = result.rows[0];

    // Fire-and-forget email alert to admin
    sendBugReportAlert({
      userId: request.userId,
      title,
      description,
      reportId: report.id,
    }).catch((err) => {
      fastify.log.error(`Failed to send bug report email: ${err.message}`);
    });

    reply.code(201);
    return report;
  });
}

module.exports = bugReportRoutes;
