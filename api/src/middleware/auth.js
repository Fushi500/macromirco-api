const { query } = require('../db');

// Register @fastify/jwt on the fastify instance
async function setupAuth(fastify) {
  await fastify.register(require('@fastify/jwt'), {
    secret: process.env.SUPABASE_JWT_SECRET,
    // Explicitly set HS256 to prevent algorithm confusion attacks.
    // Supabase uses HS256 by default. Without this, an attacker could
    // craft an RS256 token and bypass validation.
    verify: { algorithms: ['HS256'] },
  });

  // Decorator: attach to any route that needs authentication
  fastify.decorate('requireAuth', async function (request, reply) {
    try {
      await request.jwtVerify();
      // request.user.sub is the Supabase user UUID
      request.userId = request.user.sub;
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // Decorator: ensures user has a profile (auto-creates on first request)
  fastify.decorate('ensureProfile', async function (request, reply) {
    // First verify the JWT
    try {
      await request.jwtVerify();
      request.userId = request.user.sub;
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Check if profile exists, create if not
    const result = await query(
      'SELECT user_id FROM user_profiles WHERE user_id = $1',
      [request.userId]
    );

    if (result.rows.length === 0) {
      await query(
        'INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [request.userId]
      );
    }
  });
}

module.exports = { setupAuth };
