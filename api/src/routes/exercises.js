const { meili } = require('../meili');
const { redis } = require('../redis');

const exercisesIndex = meili.index('exercises');
const CACHE_TTL = 86400; // 24 hours — exercises don't change often

async function exerciseRoutes(fastify) {

  // GET /exercises/search?q=bench&limit=20
  fastify.get('/exercises/search', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 200, default: '' },
          category: { type: 'string' },
          muscle: { type: 'string' },
          equipment: { type: 'string' },
          level: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, async (request) => {
    const { q, category, muscle, equipment, level, page, limit } = request.query;

    const cacheKey = `ex:search:${q}:${category||''}:${muscle||''}:${equipment||''}:${level||''}:${page}:${limit}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Build filters
    const filters = [];
    if (category) filters.push(`category = "${category}"`);
    if (muscle) filters.push(`primaryMuscles = "${muscle}"`);
    if (equipment) filters.push(`equipment = "${equipment}"`);
    if (level) filters.push(`level = "${level}"`);

    const offset = (page - 1) * limit;
    const results = await exercisesIndex.search(q || '', {
      limit,
      offset,
      filter: filters.length > 0 ? filters.join(' AND ') : undefined,
      sort: q ? undefined : ['name:asc'],
    });

    const response = {
      query: q,
      page,
      limit,
      total: results.estimatedTotalHits,
      exercises: results.hits,
    };

    await redis.set(cacheKey, JSON.stringify(response), 'EX', CACHE_TTL);
    return response;
  });

  // GET /exercises/:id — single exercise
  fastify.get('/exercises/:id', async (request, reply) => {
    const { id } = request.params;

    const cacheKey = `ex:id:${id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      if (cached === 'NOT_FOUND') return reply.code(404).send({ error: 'Exercise not found' });
      return JSON.parse(cached);
    }

    const results = await exercisesIndex.search('', {
      filter: `id = "${id}"`,
      limit: 1,
    });

    if (results.hits.length === 0) {
      await redis.set(cacheKey, 'NOT_FOUND', 'EX', CACHE_TTL);
      return reply.code(404).send({ error: 'Exercise not found' });
    }

    await redis.set(cacheKey, JSON.stringify(results.hits[0]), 'EX', CACHE_TTL);
    return results.hits[0];
  });

  // GET /exercises/categories — list all categories
  fastify.get('/exercises/categories', async () => {
    const cacheKey = 'ex:categories';
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const results = await exercisesIndex.search('', { limit: 0, facets: ['category'] });
    const categories = Object.keys(results.facetDistribution?.category || {});

    await redis.set(cacheKey, JSON.stringify(categories), 'EX', CACHE_TTL);
    return categories;
  });

  // GET /exercises/muscles — list all muscles
  fastify.get('/exercises/muscles', async () => {
    const cacheKey = 'ex:muscles';
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const results = await exercisesIndex.search('', { limit: 0, facets: ['primaryMuscles'] });
    const muscles = Object.keys(results.facetDistribution?.primaryMuscles || {});

    await redis.set(cacheKey, JSON.stringify(muscles), 'EX', CACHE_TTL);
    return muscles;
  });

  // GET /exercises/equipment — list all equipment
  fastify.get('/exercises/equipment', async () => {
    const cacheKey = 'ex:equipment';
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const results = await exercisesIndex.search('', { limit: 0, facets: ['equipment'] });
    const equipment = Object.keys(results.facetDistribution?.equipment || {});

    await redis.set(cacheKey, JSON.stringify(equipment), 'EX', CACHE_TTL);
    return equipment;
  });
}

module.exports = exerciseRoutes;
