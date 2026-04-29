const { redis } = require('../redis');

async function setupRateLimit(fastify) {
  await fastify.register(require('@fastify/rate-limit'), {
    max: 300,
    timeWindow: '1 minute',
    redis: redis,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise fall back to IP
      return req.userId || req.ip;
    },
    errorResponseBuilder: (req, context) => {
      return {
        error: 'Too many requests',
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
  });
}

module.exports = { setupRateLimit };
