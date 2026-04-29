const { query, getClient } = require('../db');

async function collectionRoutes(fastify) {

  // ─── Collections CRUD ───

  // GET /collections — list all collections with item counts
  fastify.get('/collections', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    // Ensure system collections exist
    await getOrCreateFavorites(request.userId);

    const result = await query(
      `SELECT c.id, c.name, c.icon, c.is_system, c.position, c.created_at, c.updated_at,
              COUNT(ci.id)::int AS item_count
       FROM food_collections c
       LEFT JOIN food_collection_items ci ON ci.collection_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.position, c.created_at`,
      [request.userId]
    );
    return result.rows;
  });

  // POST /collections — create a new collection
  fastify.post('/collections', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          icon: { type: 'string', maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const { name, icon } = request.body;

    // Get next position
    const posResult = await query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM food_collections WHERE user_id = $1',
      [request.userId]
    );
    const position = posResult.rows[0].next_pos;

    const result = await query(
      `INSERT INTO food_collections (user_id, name, icon, position)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [request.userId, name, icon || null, position]
    );
    reply.code(201);
    return result.rows[0];
  });

  // PUT /collections/:id — rename or change icon
  fastify.put('/collections/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          icon: { type: 'string', maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const check = await query(
      'SELECT id, is_system FROM food_collections WHERE id = $1 AND user_id = $2',
      [request.params.id, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Collection not found' });
    }

    const fields = request.body;
    const setClauses = [];
    const values = [];
    let p = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (key === 'name' || key === 'icon') {
        setClauses.push(`${key} = $${p++}`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    setClauses.push(`updated_at = now()`);
    values.push(request.params.id);

    const result = await query(
      `UPDATE food_collections SET ${setClauses.join(', ')} WHERE id = $${p} RETURNING *`,
      values
    );
    return result.rows[0];
  });

  // DELETE /collections/:id — cannot delete system collections
  fastify.delete('/collections/:id', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const check = await query(
      'SELECT id, is_system FROM food_collections WHERE id = $1 AND user_id = $2',
      [request.params.id, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Collection not found' });
    }
    if (check.rows[0].is_system) {
      return reply.code(400).send({ error: 'Cannot delete system collections' });
    }

    await query('DELETE FROM food_collections WHERE id = $1', [request.params.id]);
    reply.code(204).send();
  });

  // ─── Collection Items ───

  // GET /collections/:id/items
  fastify.get('/collections/:id/items', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    // Verify ownership
    const check = await query(
      'SELECT id FROM food_collections WHERE id = $1 AND user_id = $2',
      [request.params.id, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Collection not found' });
    }

    const result = await query(
      `SELECT * FROM food_collection_items
       WHERE collection_id = $1
       ORDER BY position, created_at DESC`,
      [request.params.id]
    );
    return result.rows;
  });

  // POST /collections/:id/items — add a food to a collection
  fastify.post('/collections/:id/items', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['food_source', 'food_source_id', 'food_name'],
        properties: {
          food_source:      { type: 'string', enum: ['off', 'usda', 'custom', 'Recipe'] },
          food_source_id:   { type: 'string', minLength: 1, maxLength: 500 },
          food_name:        { type: 'string', minLength: 1, maxLength: 500 },
          brands:           { type: 'string', maxLength: 200 },
          image_url:        { type: 'string', maxLength: 1000 },
          calories:         { type: 'number' },
          protein:          { type: 'number' },
          carbs:            { type: 'number' },
          fat:              { type: 'number' },
          nutriments:       { type: 'object' },
          serving_quantity:  { type: 'number' },
          serving_size:     { type: 'string', maxLength: 200 },
          ingredients_text: { type: 'string', maxLength: 5000 },
        },
      },
    },
  }, async (request, reply) => {
    const collectionId = request.params.id;

    // Verify ownership
    const check = await query(
      'SELECT id FROM food_collections WHERE id = $1 AND user_id = $2',
      [collectionId, request.userId]
    );
    if (check.rows.length === 0) {
      return reply.code(404).send({ error: 'Collection not found' });
    }

    const b = request.body;

    // Get next position
    const posResult = await query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM food_collection_items WHERE collection_id = $1',
      [collectionId]
    );
    const position = posResult.rows[0].next_pos;

    const result = await query(
      `INSERT INTO food_collection_items (
        collection_id, user_id, food_source, food_source_id, food_name,
        brands, image_url, calories, protein, carbs, fat,
        nutriments, serving_quantity, serving_size, ingredients_text, position
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (collection_id, food_source, food_source_id) DO NOTHING
      RETURNING *`,
      [
        collectionId, request.userId, b.food_source, b.food_source_id, b.food_name,
        b.brands || null, b.image_url || null,
        b.calories || 0, b.protein || 0, b.carbs || 0, b.fat || 0,
        b.nutriments ? JSON.stringify(b.nutriments) : null,
        b.serving_quantity || null, b.serving_size || null,
        b.ingredients_text || null, position,
      ]
    );

    if (result.rows.length === 0) {
      // Already exists in this collection
      const existing = await query(
        `SELECT * FROM food_collection_items
         WHERE collection_id = $1 AND food_source = $2 AND food_source_id = $3`,
        [collectionId, b.food_source, b.food_source_id]
      );
      return existing.rows[0];
    }

    reply.code(201);
    return result.rows[0];
  });

  // DELETE /collections/:id/items/:itemId
  fastify.delete('/collections/:id/items/:itemId', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    const result = await query(
      `DELETE FROM food_collection_items
       WHERE id = $1 AND collection_id = $2 AND user_id = $3
       RETURNING id`,
      [request.params.itemId, request.params.id, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Item not found' });
    }
    reply.code(204).send();
  });

  // ─── Favorites convenience endpoints ───

  // Helper: get or create the "Favorites" system collection for a user
  async function getOrCreateFavorites(userId) {
    // Try to find existing
    let result = await query(
      `SELECT id FROM food_collections
       WHERE user_id = $1 AND name = 'Favorites' AND is_system = TRUE`,
      [userId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    // Create it
    result = await query(
      `INSERT INTO food_collections (user_id, name, icon, is_system, position)
       VALUES ($1, 'Favorites', 'heart', TRUE, 0)
       ON CONFLICT (user_id, name) WHERE is_system = TRUE DO NOTHING
       RETURNING id`,
      [userId]
    );
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    // Race condition: another request created it first
    result = await query(
      `SELECT id FROM food_collections
       WHERE user_id = $1 AND name = 'Favorites' AND is_system = TRUE`,
      [userId]
    );
    return result.rows[0].id;
  }

  // GET /favorites/check?source=off&source_id=123
  fastify.get('/favorites/check', {
    preHandler: [fastify.requireAuth],
    schema: {
      querystring: {
        type: 'object',
        required: ['source', 'source_id'],
        properties: {
          source:    { type: 'string' },
          source_id: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { source, source_id } = request.query;

    const result = await query(
      `SELECT ci.id FROM food_collection_items ci
       JOIN food_collections c ON c.id = ci.collection_id
       WHERE c.user_id = $1 AND c.name = 'Favorites' AND c.is_system = TRUE
         AND ci.food_source = $2 AND ci.food_source_id = $3`,
      [request.userId, source, source_id]
    );

    if (result.rows.length > 0) {
      return { is_favorite: true, item_id: result.rows[0].id };
    }
    return { is_favorite: false };
  });

  // POST /favorites — add a food to favorites (auto-creates Favorites collection)
  fastify.post('/favorites', {
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['food_source', 'food_source_id', 'food_name'],
        properties: {
          food_source:      { type: 'string', enum: ['off', 'usda', 'custom', 'Recipe'] },
          food_source_id:   { type: 'string', minLength: 1, maxLength: 500 },
          food_name:        { type: 'string', minLength: 1, maxLength: 500 },
          brands:           { type: 'string', maxLength: 200 },
          image_url:        { type: 'string', maxLength: 1000 },
          calories:         { type: 'number' },
          protein:          { type: 'number' },
          carbs:            { type: 'number' },
          fat:              { type: 'number' },
          nutriments:       { type: 'object' },
          serving_quantity:  { type: 'number' },
          serving_size:     { type: 'string', maxLength: 200 },
          ingredients_text: { type: 'string', maxLength: 5000 },
        },
      },
    },
  }, async (request, reply) => {
    const favId = await getOrCreateFavorites(request.userId);
    const b = request.body;

    const posResult = await query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM food_collection_items WHERE collection_id = $1',
      [favId]
    );
    const position = posResult.rows[0].next_pos;

    const result = await query(
      `INSERT INTO food_collection_items (
        collection_id, user_id, food_source, food_source_id, food_name,
        brands, image_url, calories, protein, carbs, fat,
        nutriments, serving_quantity, serving_size, ingredients_text, position
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (collection_id, food_source, food_source_id) DO NOTHING
      RETURNING *`,
      [
        favId, request.userId, b.food_source, b.food_source_id, b.food_name,
        b.brands || null, b.image_url || null,
        b.calories || 0, b.protein || 0, b.carbs || 0, b.fat || 0,
        b.nutriments ? JSON.stringify(b.nutriments) : null,
        b.serving_quantity || null, b.serving_size || null,
        b.ingredients_text || null, position,
      ]
    );

    if (result.rows.length === 0) {
      // Already favorited
      const existing = await query(
        `SELECT * FROM food_collection_items
         WHERE collection_id = $1 AND food_source = $2 AND food_source_id = $3`,
        [favId, b.food_source, b.food_source_id]
      );
      return existing.rows[0];
    }

    reply.code(201);
    return result.rows[0];
  });

  // DELETE /favorites/:itemId
  fastify.delete('/favorites/:itemId', {
    preHandler: [fastify.requireAuth],
  }, async (request, reply) => {
    // Only delete from the user's Favorites collection
    const result = await query(
      `DELETE FROM food_collection_items ci
       USING food_collections c
       WHERE ci.id = $1
         AND ci.collection_id = c.id
         AND c.user_id = $2
         AND c.name = 'Favorites'
         AND c.is_system = TRUE
       RETURNING ci.id`,
      [request.params.itemId, request.userId]
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Favorite not found' });
    }
    reply.code(204).send();
  });

  // GET /favorites — list all favorites
  fastify.get('/favorites', {
    preHandler: [fastify.requireAuth],
  }, async (request) => {
    const result = await query(
      `SELECT ci.* FROM food_collection_items ci
       JOIN food_collections c ON c.id = ci.collection_id
       WHERE c.user_id = $1 AND c.name = 'Favorites' AND c.is_system = TRUE
       ORDER BY ci.position, ci.created_at DESC`,
      [request.userId]
    );
    return result.rows;
  });
}

module.exports = collectionRoutes;
